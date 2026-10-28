/* Pipeline de génération : dernier harvest → articles.
   harvest item → anti-doublon → extraction → périmètre → génération → scoring → anti-plagiat (press) → statut. */

import { randomUUID } from "node:crypto";
import { readSettings } from "../lib/yamlStore.js";
import { readJson, writeJson, dataPath, writeArticle, readArticle, listArticleIds, readIndex, pushCollection, generatedItemKeys } from "../lib/store.js";
import { isMain } from "../lib/main.js";
import { providerName, providerLabel, extractFromSource, generateArticle, llmStats, resetLlmStats, llmLimits } from "../llm/index.js";
import { checkDuplicate } from "./dedup.js";
import { assessItem, substantiveSentences, sourceSignsOf, partnerContent, partnerFlag } from "./quality.js";
import { genererEtRelire, notificationHallucination } from "./relance.js";
import { scopeBeforeGeneration } from "./geo.js";
import { dateGate } from "./dates.js";
import { coveredOf, coverageLabel, mainRegionName } from "../../shared/zones.js";
import { scoreSummary } from "../../shared/scoring.js";

function slugFallback(title) {
  return String(title).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "article";
}

async function existingSubjects() {
  const ids = await listArticleIds();
  const out = [];
  for (const id of ids) {
    const a = await readArticle(id);
    // un article purgé (M3-79) ne doit pas faire écarter sa propre régénération comme doublon
    if (a && a.status !== "archive" && a.status !== "purge") out.push({ id: a.id, title: a.title, chapo: a.chapo });
  }
  return out;
}

export async function runGeneration({ limit = 0, harvestDate = null, altPrompt = null } = {}) {
  /* Début du run (frise des durées par étape, B1) : `at` n'en donne que la fin. */
  const startedAt = new Date().toISOString();
  const settings = await readSettings();
  const covered = coveredOf(settings);
  const harvest = await readJson(dataPath("harvest", harvestDate ? `${harvestDate}.json` : "latest.json"));
  if (!harvest) throw Object.assign(new Error("aucun harvest disponible — lancez d'abord la récupération"), { status: 409 });

  let queue = harvest.items.filter((it) => !it.processed);
  if (limit > 0) queue = queue.slice(0, limit);

  const created = [];
  const skipped = [];
  const subjects = await existingSubjects();
  /* Anti-régénération (T14) : contenus récoltés qui ont déjà donné un article,
     vivant, purgé ou effacé. Réarmer la récolte ne les fait plus régénérer, sauf
     purge avec « autoriser la régénération ». Lu une fois pour toute la file. */
  const dejaGeneres = await generatedItemKeys(queue.map((it) => it.id));
  await resetLlmStats();

  for (const item of queue) {
    item.processed = true;
    const flags = [];

    if (dejaGeneres.has(item.id)) {
      skipped.push({ item: item.id, reason: "deja_genere", detail: "contenu source déjà généré (anti-régénération) : purger avec « autoriser la régénération » pour le régénérer" });
      continue;
    }

    const q = assessItem(item);
    if (!q.ok) {
      skipped.push({ item: item.id, reason: q.reason, detail: q.detail });
      if (q.reason === "publicite") {
        await pushCollection("notifications", {
          id: `n-${Date.now()}-${item.id}`, type: "publicite", severity: "info",
          sourceId: item.sourceId, sourceName: item.sourceName, url: item.url,
          detail: `Écarté avant génération (économie d'un appel LLM) — ${q.detail}.`,
          at: new Date().toISOString(), read: false,
        });
      }
      continue;
    }

    /* Hors fenêtre de récupération → pas d'appel au modèle (M3-115, piste 2) :
       même motif que le drapeau date_suspecte de la finalisation, qui reste en
       place pour les dates qu'on ne peut pas juger ici. */
    const dg = dateGate({ title: item.title, rawText: item.rawText, publishedAt: item.publishedAt, windowHours: settings.window_hours || 72 });
    if (dg) {
      skipped.push({ item: item.id, reason: "date_suspecte", detail: dg.detail });
      await pushCollection("notifications", {
        id: `n-${Date.now()}-${item.id}`, type: "date_suspecte", severity: "info",
        sourceId: item.sourceId, sourceName: item.sourceName, url: item.url,
        detail: `Écarté avant génération (économie d'un appel LLM) — ${dg.detail}`,
        at: new Date().toISOString(), read: false,
      });
      continue;
    }

    // source sans matière réelle (que du boilerplate) → pas d'article
    if (substantiveSentences(item.rawText).length === 0) {
      skipped.push({ item: item.id, reason: "source_trop_mince", detail: "aucune information hors mentions légales / boilerplate" });
      await pushCollection("notifications", {
        id: `n-${Date.now()}-${item.id}`, type: "source_trop_mince", severity: "info",
        sourceId: item.sourceId, sourceName: item.sourceName, url: item.url,
        detail: "Contenu limité aux mentions légales / au cadre réglementaire : pas d'article généré.",
        at: new Date().toISOString(), read: false,
      });
      continue;
    }

    const dup = checkDuplicate(item, subjects, settings.dedup_threshold);
    if (dup.isDuplicate) {
      skipped.push({ item: item.id, reason: "doublon", score: dup.score });
      await pushCollection("notifications", {
        id: `n-${Date.now()}-${item.id}`, type: "doublon", severity: "info",
        sourceId: item.sourceId, sourceName: item.sourceName, url: item.url,
        detail: `Sujet proche d'un article existant (${Math.round(dup.score * 100)} %).`,
        at: new Date().toISOString(), read: false,
      });
      continue;
    }

    let extracted, gen, scope;
    const fb0 = llmStats.fallbacks;
    const sc0 = llmStats.secoursCalls || 0;
    // contenu de partenaire (M3-85) : signalé et dit au modèle, pas écarté
    const partner = partnerContent(item.rawText);
    try {
      extracted = await extractFromSource(item.rawText, { sourceType: item.sourceType, sourceTitle: item.title });
      /* Hors zone manifeste → pas d'appel de génération (M3-73), sauf si
         l'administrateur a choisi de générer hors zone : l'article est alors
         rédigé et signalé « non habilité » après génération (finalizeGenerated). */
      scope = settings.generate_out_of_zone === "oui"
        ? { outside: false }
        : scopeBeforeGeneration(extracted, item.rawText, {
          region: mainRegionName(covered), sourceDept: item.sourceDept || item.zone?.dept || null, covered,
        });
      if (!scope.outside) {
        gen = await generateArticle(extracted, genOpts(item, covered, altPrompt, settings, partner));
      }
    } catch (err) {
      /* Plafond de dépense atteint, action « stop » (M3-62) : on n'appelle plus le
         LLM. Le candidat courant et les suivants restent non traités, la run
         suivante les reprendra — c'est ce qui distingue un arrêt d'un échec. */
      if (err.code === "LLM_CAP") {
        item.processed = false;
        break;
      }
      skipped.push({ item: item.id, reason: "echec_generation", error: err.message });
      await pushCollection("notifications", {
        id: `n-${Date.now()}-${item.id}`, type: "echec_generation", severity: "error",
        sourceId: item.sourceId, sourceName: item.sourceName, url: item.url,
        detail: err.message, at: new Date().toISOString(), read: false,
      });
      continue;
    }

    /* Écarté sans article, mais pas sans trace : la notification porte le lien de la
       source, et le relecteur qui n'est pas d'accord sait où reprendre le sujet. */
    if (scope.outside) {
      const where = extracted.locality && !/^(inconnu|national)$/i.test(extracted.locality) ? ` (localité : « ${extracted.locality} »)` : "";
      skipped.push({ item: item.id, reason: "hors_sujet", detail: scope.places.join(", ") });
      await pushCollection("notifications", {
        id: `n-${Date.now()}-${item.id}`, type: "hors_sujet", severity: "info",
        sourceId: item.sourceId, sourceName: item.sourceName, url: item.url,
        detail: `Écarté avant génération (économie d'un appel LLM) — sujet hors des zones couvertes${where}, lieux cités : ${scope.places.join(", ")}, aucun lieu couvert dans la source.`,
        at: new Date().toISOString(), read: false,
      });
      continue;
    }

    /* Post-traitement commun (dates, géo-tag, rubrique, longueur, règles),
       anti-plagiat (mode presse uniquement), relecture automatique (M3-89) et,
       sur hallucination, relances sur d'autres moteurs (M3-55) : une seule
       suite, partagée avec la régénération à la demande (src/generate/relance.js).
       Seul un « rejet » de la relecture signale l'article ; « à corriger »
       reste dans checks.review, sans changer son statut. */
    const r = await genererEtRelire({
      first: gen, extracted, rawText: item.rawText,
      genOpts: genOpts(item, covered, altPrompt, settings, partner),
      finalizeCtx: {
        rawText: item.rawText,
        publishedAt: item.publishedAt,
        sourceZone: item.zone || {},
        sourceDept: item.sourceDept || null,
        sourceRegion: item.sourceRegion || null,
        extractedLocality: extracted.locality,
        titleHint: extracted.title_hint,
        // état de la source (M3-107, C1) : nom pour « émetteur nommé », URL, repli d'extraction
        sourceName: item.sourceName, sourceUrl: item.url, extracted,
        settings,
      },
      plagiarism: item.mode === "press",
      settings,
      source: { name: item.sourceName, url: item.url },
    });
    gen = r.gen;
    const { fin, plagiarism, review } = r;
    flags.push(...fin.flags);
    const pf = partnerFlag(partner);
    if (pf) flags.push(pf);
    flags.push(...r.flags);

    const degraded = llmStats.fallbacks > fb0;
    const id = `art-${harvest.date}-${created.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const article = {
      id, uuid: randomUUID(), createdAt: now, updatedAt: now,
      mode: item.mode,
      status: flags.length ? "signale" : "a_revoir",
      flags,
      cat: gen.category,
      zone: fin.zone,
      zoneClass: fin.zoneClass,
      title: gen.title,
      chapo: gen.chapo,
      signature: "La Rédaction",
      body: gen.body,
      ranking: clamp(gen.suggested_ranking, 0, 100),
      rankingReason: gen.ranking_reason || "",
      source: { type: item.sourceType === "pdf" ? "pdf" : "site", kind: item.sourceKind || "public", label: item.sourceName, url: item.url },
      illustration: null,
      seo: {
        metaTitle: gen.seo.metaTitle || gen.title.slice(0, 60),
        metaDescription: gen.seo.metaDescription || gen.chapo.slice(0, 158),
        slug: gen.seo.slug || slugFallback(gen.title),
        keywords: gen.seo.keywords && gen.seo.keywords.length ? gen.seo.keywords : ["local", "charente-maritime", "actualité"],
        /* `outline` n'est plus stocké : le plan Hn se lit dans le corps
           (shared/model.js → outlineOf). Deux champs pour une même vérité,
           c'est exactement ce qui a produit le plan fantôme du 2026-09-16. */
      },
      origin: {
        sourceId: item.sourceId, harvestItemId: item.id, sourceUrl: item.url,
        rawText: item.rawText, extracted,
        // date de récupération, affichée dans l'Historique (M3-79)
        harvestedAt: item.harvestedAt || null,
        // date de parution de la source : relue à la régénération, citée au modèle (M3-85)
        publishedAt: item.publishedAt || null,
      },
      checks: {
        plagiarism,
        dedup: { score: dup.score, against: dup.against },
        date: fin.checks.date,
        geo: fin.checks.geo,
        category: fin.checks.category,
        // longueur visée et mesurée (M3-86) : la cible même que le prompt a reçue
        length: fin.checks.length,
        // règles des Paramètres tenues ou non, après relances (M3-87)
        rules: fin.checks.rules,
        // état de la source : lue / illisible, émetteur nommé, citations n/m (M3-107, C1)
        sources: fin.checks.sources,
        // relecture automatique par un second modèle (M3-89), ou null
        review: review || null,
        // prompt de génération qui a servi (M3-56) : portée, version, moteur, modèle ; null en mock
        prompt: gen.prompt || null,
        // relances sur hallucination (M3-55) : seulement si l'une a été engagée
        ...(r.regen ? { regen: r.regen } : {}),
      },
      reviewer: null,
      publication: null,
      /* Le moteur qui a réellement rédigé : relance (M3-55), mock (repli), secours (M3-88) ou principal. */
      provider: r.moteur ? r.moteur.id : degraded ? "mock" : (llmStats.secoursCalls || 0) > sc0 && llmStats.switch ? llmStats.switch.to.id : providerName(),
      providerConfigured: llmStats.configured,
    };
    article.scores = scoreSummary(article, settings);
    await writeArticle(article);
    /* Hallucination persistante après relances (M3-55) : l'article reste dans la
       file, signalé, et la notification dit lequel, d'où, et pourquoi. */
    if (r.regen?.issue === "hallucination_persistante") {
      await pushCollection("notifications", notificationHallucination({
        articleId: id, sourceId: item.sourceId, sourceName: item.sourceName, url: item.url, regen: r.regen, review,
      }));
    }
    subjects.push({ id, title: article.title, chapo: article.chapo });
    created.push(id);
  }

  // persister l'état "processed"
  await writeJson(dataPath("harvest", `${harvest.date}.json`), harvest);
  if (harvestDate == null) await writeJson(dataPath("harvest", "latest.json"), harvest);

  // le provider configuré a-t-il réellement produit le contenu ?
  const providerUsed = llmStats.fallbacks > 0
    ? (llmStats.configured === "mock" ? "mock" : "mock (repli)")
    : llmStats.secoursCalls > 0 && llmStats.switch ? `${llmStats.switch.to.id} (secours)` : providerName();
  /* Bascule sur le moteur de secours (M3-88) : jamais silencieuse. */
  if (llmStats.switch) {
    const sw = llmStats.switch;
    await pushCollection("notifications", {
      id: `n-${Date.now()}-secours`, type: "llm_secours", severity: "warning",
      /* Les deux modèles sont nommés : principal et secours peuvent être le même moteur. */
      detail: `${sw.from.label}${sw.from.model ? ` (${sw.from.model})` : ""} indisponible (${sw.error}) : bascule sur le secours ${sw.to.label}${sw.to.model ? ` (${sw.to.model})` : ""}, ${llmStats.secoursCalls} appel(s) servis par lui.`,
      at: new Date().toISOString(), read: false,
    });
  }
  /* Les replis dus au plafond ne sont pas une panne du fournisseur : ils ont
     leur propre notification, juste en dessous. */
  const failures = llmStats.fallbacks - llmStats.capped;
  if (failures > 0 && llmStats.configured !== "mock") {
    await pushCollection("notifications", {
      id: `n-${Date.now()}-llm`, type: "llm_degraded", severity: "warning",
      detail: `${providerLabel()} indisponible (${llmStats.lastError}). ${failures} appel(s) LLM repliés sur le mock déterministe.`,
      at: new Date().toISOString(), read: false,
    });
  }
  const pending = queue.filter((it) => !it.processed).length;
  if (llmStats.capHit) {
    await pushCollection("notifications", {
      id: `n-${Date.now()}-cap`, type: "llm_plafond", severity: "warning",
      detail: llmStats.capped > 0
        ? `${capitalize(llmStats.capHit.detail)}. ${llmStats.capped} appel(s) LLM repliés sur le mock : les articles concernés sont factices.`
        : `${capitalize(llmStats.capHit.detail)}. Génération interrompue, ${pending} candidat(s) reportés à la prochaine run.`,
      at: new Date().toISOString(), read: false,
    });
  }

  /* Consommation de la run (M3-61). Le mock ne consomme rien : l'inclure ferait
     croire à un relevé à zéro alors qu'aucun appel n'a été facturé.
     `billedCalls` compte les réponses 2xx du fournisseur, pas les appels métier —
     une réponse illisible est rejouée, et les deux ont été payées. */
  const usage = llmStats.usage.billedCalls > 0 ? { ...llmStats.usage, limits: llmLimits() } : null;

  await pushCollection("runs", {
    id: `run-${Date.now()}`, kind: "generation", at: new Date().toISOString(),
    stats: {
      startedAt,
      candidates: queue.length, created: created.length, skipped: skipped.length,
      provider: providerUsed, fallbacks: llmStats.fallbacks, llmError: llmStats.lastError,
      usage, cap: llmStats.capHit, pending,
      // M3-87 : relances pour règles non tenues, et articles rendus avec un écart
      rules: { retries: llmStats.ruleRetries || 0, misses: llmStats.ruleMisses || 0 },
      // M3-88 : bascule sur le moteur de secours, ou null
      secours: llmStats.switch ? { ...llmStats.switch, calls: llmStats.secoursCalls } : null,
      // M3-56 : prompts de génération utilisés pendant la run, avec leur nombre d'articles
      prompts: llmStats.prompts && llmStats.prompts.length ? llmStats.prompts : null,
      // M3-89 : verdicts des relectures et suggestions de consigne, ou null si aucune
      review: llmStats.reviews && (llmStats.reviews.done || llmStats.reviews.failed || llmStats.reviews.skipped) ? llmStats.reviews : null,
      // M3-55 : relances sur hallucination (articles, relances, persistantes, diagnostics), ou null
      regen: llmStats.regen && (llmStats.regen.articles || llmStats.regen.sautes || llmStats.regen.arrets) ? llmStats.regen : null,
    },
  });

  return {
    created, skipped, candidates: queue.length,
    provider: providerUsed, fallbacks: llmStats.fallbacks, llmError: llmStats.lastError,
    usage, cap: llmStats.capHit, pending,
  };
}

/* Options de génération d'un candidat : la première génération et ses relances
   (M3-55) partent des mêmes. */
function genOpts(item, covered, altPrompt, settings, partner) {
  return {
    mode: item.mode, region: coverageLabel(covered), altPrompt, rules: settings,
    publishedAt: item.publishedAt || null, partner: partner.partner,
    sourceSigns: sourceSignsOf(item.rawText),
  };
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function clamp(n, lo, hi) { n = Number(n); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo; }

if (isMain(import.meta.url)) {
  try { process.loadEnvFile(); } catch {}
  runGeneration({ limit: Number(process.env.M3_GEN_LIMIT) || 0 })
    .then((r) => {
      console.log(`✓ génération (${r.provider}) : ${r.created.length} articles créés, ${r.skipped.length} ignorés sur ${r.candidates} candidats`);
      r.skipped.forEach((s) => console.log(`  – ${s.item} : ${s.reason}${s.score ? " (" + s.score + ")" : ""}`));
      if (r.cap) console.log(`⚠ ${r.cap.detail}${r.pending ? ` — ${r.pending} candidat(s) reportés` : ""}`);
    })
    .catch((e) => { console.error("✗ " + (e.stack || e.message)); process.exit(1); });
}
