/* Générer → finaliser → anti-plagiat → relire → relancer (M3-55).

   Une seule suite pour les deux chemins qui produisent un texte : la run de
   génération (src/generate/pipeline.js) et la régénération à la demande depuis
   la console (src/api/articles.js). Ils l'écrivaient chacun de leur côté ; ce
   qui les distingue (extraction en cache ou non, altPrompt, partenaire, date de
   parution, anti-plagiat, ce qu'on garde de l'ancienne version) reste chez eux
   et arrive ici en paramètres.

   Relance : quand la relecture automatique (M3-89) trouve une HALLUCINATION, le
   texte est redemandé à un AUTRE moteur, avec le verdict en recadrage, au plus
   `llm_regen_max` fois, aux moteurs de `llm_regen_engines` pris dans l'ordre.
   Chaque relance repasse toute la suite. Réglage vide, 0 relance ou relecture
   désactivée : rien de plus qu'avant — mêmes appels, mêmes drapeaux. */

import { generateArticle, checkPlagiarism, reviewArticle, describeEngine, llmStats } from "../llm/index.js";
import { sameEngine } from "../llm/fallback.js";
import { recadragePrompt } from "../llm/prompts/review.js";
import { finalizeGenerated } from "./finalize.js";
import { plainText } from "../../shared/model.js";

/* Règle de déclenchement : une relecture FAITE qui rend « rejet », ou qui liste
   au moins une hallucination. normalizeReview impose déjà « rejet » dès qu'une
   hallucination est listée ; la seconde condition protège d'un relecteur (mock
   compris) qui ne passerait pas par là. « rejet » sans hallucination listée est
   un contresens : c'est aussi une infidélité à la source, on relance.
   « à corriger » (fautes, imprécisions mineures) ne relance PAS : un autre
   moteur ne corrigerait pas mieux une faute qu'une relecture humaine, et
   paierait une génération entière. Relecture absente, indisponible, au
   plafond ou en échec : aucun verdict, aucune relance. */
export function declencheRelance(review) {
  return review?.status === "fait" && (review.verdict === "rejet" || (review.hallucinations?.length || 0) > 0);
}

/* Réglages → plan de relance. Liste « moteur:modèle, moteur » (virgule, point-
   virgule ou retour à la ligne) ; seul le premier « : » sépare le modèle. */
export function planRelance(settings = {}) {
  const max = Math.max(0, Math.min(3, Math.round(Number(settings.llm_regen_max) || 0)));
  const engines = String(settings.llm_regen_engines ?? "")
    .split(/[,;\n]/).map((t) => t.trim()).filter(Boolean)
    .map((t) => {
      const i = t.indexOf(":");
      const id = (i < 0 ? t : t.slice(0, i)).trim();
      const model = i < 0 ? "" : t.slice(i + 1).trim();
      return { id, model: model || null };
    })
    .filter((e) => e.id);
  return { max, engines };
}

/* Drapeau de la relecture (M3-89), le même texte qu'avant ; une hallucination
   persistante après relances le dit en plus. */
export function relectureFlag(review, regen = null) {
  if (!(review?.status === "fait" && review.verdict === "rejet")) return null;
  const h = review.hallucinations.map((x) => `« ${x.extrait} »`).join(", ");
  const persist = regen?.issue === "hallucination_persistante"
    ? ` Persistant après ${regen.tentatives.filter((t) => t.relance && !t.motif).length} relance(s).` : "";
  return { type: "relecture_llm", detail: `Relecture automatique (${review.engine}) : à rejeter${h ? ` — ${h}` : ""}. ${review.resume}${persist}`.trim(), at: new Date().toISOString() };
}

/* Notification d'une hallucination persistante : la source (nom, lien), l'article
   et les motifs, pour que le relecteur sache quoi vérifier sans ouvrir la run. */
export function notificationHallucination({ articleId, sourceId = null, sourceName = null, url = null, regen, review }) {
  const relances = regen.tentatives.filter((t) => t.relance && !t.motif);
  const moteurs = relances.map((t) => `${t.moteur}${t.modele ? ` · ${t.modele}` : ""}`).join(", ");
  const kept = regen.tentatives[regen.retenue] || {};
  const h = (review?.hallucinations || []).slice(0, 3).map((x) => `« ${x.extrait} »${x.explication ? ` (${x.explication})` : ""}`).join(" ; ");
  return {
    id: `n-${Date.now()}-${articleId}-hallucination`, type: "llm_hallucination", severity: "warning",
    sourceId, sourceName, url, articleId,
    detail: `Article ${articleId} — source « ${sourceName || "?"} »${url ? ` (${url})` : ""} : hallucination persistante après ${relances.length} relance(s)${moteurs ? ` (${moteurs})` : ""}. `
      + `Version gardée : n° ${regen.retenue + 1} sur ${regen.tentatives.length} (${kept.moteur || "?"}${kept.modele ? ` · ${kept.modele}` : ""}), ${kept.hallucinations ?? "?"} hallucination(s)${h ? ` : ${h}` : ""}. `
      + `${review?.resume ? `${review.resume} ` : ""}Article gardé dans la file, signalé.`,
    at: new Date().toISOString(), read: false,
  };
}

/* Une version : finalisée, contrôlée (plagiat si demandé), relue. */
async function passer(gen, ctx) {
  const fin = finalizeGenerated(gen, ctx.finalizeCtx);
  let plagiarism = null;
  let plagFlag = null;
  if (ctx.plagiarism) {
    try {
      plagiarism = await checkPlagiarism(ctx.rawText, plainText(gen));
      if (plagiarism.verdict === "risque") {
        plagFlag = { type: "plagiat", detail: `Proximité ${Math.round(plagiarism.score * 100)} % avec la source.`, at: new Date().toISOString() };
      }
    } catch { /* si le check échoue, on ne bloque pas */ }
  }
  const review = await reviewArticle(ctx.rawText, { title: gen.title, chapo: gen.chapo, body: gen.body });
  return { gen, fin, plagiarism, plagFlag, review };
}

const producerOf = (gen) => (gen?.prompt ? { id: gen.prompt.provider, defaultModel: gen.prompt.model } : null);
const nbHallu = (review) => review?.hallucinations?.length ?? 0;

function regenStats() {
  /* llmStats.regen est remis à zéro à chaque run (resetLlmStats). */
  if (!llmStats.regen) llmStats.regen = { articles: 0, relances: 0, reussies: 0, persistantes: 0, sautes: 0, arrets: 0, suggestions: [], diagnostics: [] };
  return llmStats.regen;
}

/* ctx :
   - extracted, rawText : l'extraction et le texte source ;
   - genOpts : options de generateArticle, reprises telles quelles par les relances ;
   - finalizeCtx : second argument de finalizeGenerated ;
   - plagiarism : contrôle anti-plagiat (le pipeline, en mode presse) ;
   - settings : llm_regen_max, llm_regen_engines ;
   - source : { name, url } pour le journal ;
   - first : première génération déjà faite (le pipeline la fait sous son
     propre try, qui distingue arrêt au plafond et échec) ; absente : faite ici.

   → { gen, fin, plagiarism, review, flags, regen, moteur }
   - flags : drapeaux de la suite, dans l'ordre d'avant (plagiat, relecture),
     à ajouter APRÈS ceux de fin et du partenaire ;
   - regen : trace des relances (checks.regen), null si aucune n'a été engagée ;
   - moteur : { id, model } du moteur de relance qui a écrit la version
     retenue, null si c'est la première. */
export async function genererEtRelire(ctx) {
  const gen0 = ctx.first || await generateArticle(ctx.extracted, ctx.genOpts);
  const t0 = await passer(gen0, ctx);
  const plan = planRelance(ctx.settings);
  if (!declencheRelance(t0.review) || plan.max <= 0 || !plan.engines.length) return resultat(t0, null, null);

  const R = regenStats();
  const src = ctx.source?.name || ctx.source?.url || "source";
  const p0 = producerOf(gen0);
  const tentatives = [{ moteur: p0?.id || "mock", modele: p0?.defaultModel || null, relance: false, verdict: t0.review.verdict, hallucinations: nbHallu(t0.review), motif: null }];
  const versions = [{ t: t0, index: 0, moteur: null }];
  let prev = t0;
  let ok = null;
  let faites = 0;

  for (const spec of plan.engines) {
    if (faites >= plan.max) break;
    const d = await describeEngine(spec);
    let issue = d.issue;
    if (!issue && sameEngine({ id: d.id, defaultModel: d.model }, producerOf(prev.gen))) issue = "même moteur et même modèle que la version rejetée";
    if (issue) {
      R.sautes++;
      tentatives.push({ moteur: d.id, modele: d.model, relance: true, verdict: null, hallucinations: null, motif: `sauté : ${issue}` });
      console.warn(`[llm] relance de « ${src} » : moteur ${d.id}${d.model ? ` · ${d.model}` : ""} sauté (${issue})`);
      continue;
    }
    noteDiagnostic(R, src, d, prev.review);
    console.warn(`[llm] relance ${faites + 1}/${plan.max} de « ${src} » sur ${d.label} · ${d.model} — relecture précédente : ${prev.review.verdict}, ${nbHallu(prev.review)} hallucination(s) — ${prev.review.resume}${prev.review.suggestionPrompt ? ` · suggestion : ${prev.review.suggestionPrompt}` : ""}`);
    let gen;
    try {
      gen = await generateArticle(ctx.extracted, { ...ctx.genOpts, engine: { id: d.id, model: d.model }, recadrage: recadragePrompt(prev.review) });
    } catch (err) {
      const cap = err.code === "LLM_CAP";
      tentatives.push({ moteur: d.id, modele: d.model, relance: true, verdict: null, hallucinations: null, motif: `${cap ? "plafond" : "échec"} : ${err.message}` });
      /* Plafond de dépense : arrêt propre, la meilleure version déjà payée reste. */
      if (cap) { R.arrets++; break; }
      /* Appel parti et tombé : il compte parmi les n relances. */
      faites++;
      R.relances++;
      continue;
    }
    faites++;
    R.relances++;
    const t = await passer(gen, ctx);
    const fait = t.review?.status === "fait";
    tentatives.push({ moteur: d.id, modele: d.model, relance: true, verdict: fait ? t.review.verdict : null, hallucinations: fait ? nbHallu(t.review) : null, motif: fait ? null : `relecture ${t.review?.status || "absente"}${t.review?.detail ? ` : ${t.review.detail}` : ""}` });
    /* Relecture manquée (plafond, panne) : version non jugée, jamais retenue
       contre une version jugée ; plus rien ne permet de juger les suivantes. */
    if (!fait) { R.arrets++; break; }
    versions.push({ t, index: tentatives.length - 1, moteur: { id: d.id, model: d.model } });
    if (!declencheRelance(t.review)) { ok = versions[versions.length - 1]; break; }
    prev = t;
  }

  /* Aucune ne passe : la version qui a le moins d'hallucinations, la plus
     récente à égalité (elle a vu le plus de recadrage). */
  const kept = ok || versions.reduce((best, v) => (nbHallu(v.t.review) <= nbHallu(best.t.review) ? v : best));
  const issue = ok ? "ok" : faites ? "hallucination_persistante" : "aucune_relance";
  if (faites) R.articles++;
  if (ok) R.reussies++;
  if (issue === "hallucination_persistante") R.persistantes++;
  if (issue !== "ok") console.warn(`[llm] « ${src} » : ${issue === "aucune_relance" ? "aucune relance possible" : `hallucination persistante après ${faites} relance(s)`} → version n° ${kept.index + 1} gardée, article signalé`);
  const regen = { tentatives, retenue: kept.index, issue };
  return resultat(kept.t, regen, kept.moteur);
}

function noteDiagnostic(R, source, d, review) {
  if (review.suggestionPrompt && R.suggestions.length < 5 && !R.suggestions.includes(review.suggestionPrompt)) R.suggestions.push(review.suggestionPrompt);
  if (R.diagnostics.length < 20) {
    R.diagnostics.push({ source, vers: d.id, modele: d.model, verdict: review.verdict, hallucinations: nbHallu(review), resume: review.resume || "", suggestion: review.suggestionPrompt || "" });
  }
}

function resultat(t, regen, moteur) {
  const flags = [];
  if (t.plagFlag) flags.push(t.plagFlag);
  const rf = relectureFlag(t.review, regen);
  if (rf) flags.push(rf);
  return { gen: t.gen, fin: t.fin, plagiarism: t.plagiarism, review: t.review, flags, regen, moteur };
}
