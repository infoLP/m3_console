/* M3-87 — les règles des Paramètres sont tenues, pas seulement citées :
   contrôle après génération, nouvelle demande au modèle avec la liste des
   écarts, signalement si l'écart persiste. Aucun appel réseau : le « modèle »
   est une fonction de test. */

import test from "node:test";
import assert from "node:assert/strict";

import { checkRules, evaluateRules, REGLES_CONTROLEES, enforceRules, correctionPrompt, blocking, rulesOf } from "../src/llm/rules.js";
import { lengthTarget } from "../src/llm/lengthTarget.js";
import { finalizeGenerated, rulesCheck } from "../src/generate/finalize.js";
import { userPrompt } from "../src/llm/prompts/generate.js";

const S = rulesOf({ title_max: 60, h2_title_max: 40, breve_signs_min: 300, h2_above_signs: 1500, signs_max: 7000, outline_h2_min: 1, meta_desc_min: 70, meta_desc_max: 160, keywords_min: 3, meta_title_max: 60 });

const para = (n) => ({ type: "p", text: "a".repeat(n) });
const good = () => ({
  title: "La mairie de Rochefort ouvre une médiathèque",
  chapo: "Chapô.",
  body: [para(400), { type: "h2", text: "Un équipement attendu" }, para(400)],
  seo: { metaTitle: "Rochefort ouvre une médiathèque", metaDescription: "m".repeat(100), slug: "rochefort-ouvre-mediatheque", keywords: ["a", "b", "c"] },
});

test("un article conforme ne lève aucun écart", () => {
  assert.deepEqual(checkRules(good(), S), []);
});

test("chaque règle réglée est contrôlée", () => {
  const g = good();
  g.title = "t".repeat(61);
  g.body = [{ type: "h1", text: "Titre" }, para(900), { type: "h2", text: "i".repeat(41) }, para(900)];
  g.seo = { metaTitle: "x".repeat(61), metaDescription: "court", slug: "Pas Bon", keywords: ["a"] };
  const rules = checkRules(g, S).map((v) => v.rule).sort();
  assert.deepEqual(rules, ["h1", "h2_title", "keywords", "meta_description", "meta_title", "slug", "title"].sort());
});

test("longueur : la cible du prompt si elle existe, sinon les bornes fixes", () => {
  const t = lengthTarget(S, 2000);              // 100 % → 2 000, fenêtre 1 600–2 400
  const g = good();                              // ~820 signes
  assert.match(checkRules(g, S, t).find((v) => v.rule === "length").detail, /entre 1 600 et 2 400/);
  assert.equal(checkRules(g, S, null).find((v) => v.rule === "length"), undefined, "820 tient dans 300–7 000");
});

test("au-delà du seuil des intertitres, le minimum de h2 est exigé", () => {
  const g = good();
  g.body = [para(1600)];
  assert.ok(checkRules(g, S).some((v) => v.rule === "h2_count"));
  assert.ok(!checkRules(g, { ...S, outline_h2_min: 0 }).some((v) => v.rule === "h2_count"));
});

test("balise titre et slug : listés, mais pas de relance (finalize les corrige)", () => {
  const g = good();
  g.seo.slug = "Accentué é";
  g.seo.metaTitle = "x".repeat(80);
  const v = checkRules(g, S);
  assert.equal(v.length, 2);
  assert.equal(blocking(v).length, 0);
});

test("enforceRules : règle manquée → nouvelle demande avec la liste des écarts", async () => {
  const prompts = [];
  const answers = [{ ...good(), title: "t".repeat(80) }, good()];
  const r = await enforceRules({
    produce: async (feedback) => { prompts.push(feedback); return answers.shift(); },
    check: (g) => checkRules(g, S),
    maxRetries: 1,
  });
  assert.equal(r.attempts, 2);
  assert.deepEqual(r.violations, []);
  assert.equal(prompts[0], null);
  assert.match(prompts[1], /REJETÉE/);
  assert.match(prompts[1], /titre de 80 caractères, 60 au plus/);
  assert.match(prompts[1], /tttttttt/, "la réponse à corriger est jointe");
});

test("enforceRules : relances bornées, meilleure réponse gardée", async () => {
  let n = 0;
  const r = await enforceRules({
    produce: async () => { n++; return { ...good(), title: "t".repeat(n === 2 ? 61 : 80), seo: { ...good().seo, keywords: n === 2 ? ["a", "b", "c"] : [] } }; },
    check: (g) => checkRules(g, S),
    maxRetries: 2,
  });
  assert.equal(n, 3, "1 + 2 relances, pas plus");
  assert.equal(r.attempts, 3);
  assert.equal(r.violations.length, 1, "la 2e réponse (un seul écart) est gardée");
});

test("enforceRules : 0 relance → contrôle seul", async () => {
  let n = 0;
  const r = await enforceRules({ produce: async () => { n++; return { ...good(), title: "" }; }, check: (g) => checkRules(g, S), maxRetries: 0 });
  assert.equal(n, 1);
  assert.equal(r.violations[0].rule, "title");
});

test("enforceRules : plafond de dépense → pas de relance", async () => {
  let n = 0;
  const r = await enforceRules({ produce: async () => { n++; return { ...good(), title: "" }; }, check: (g) => checkRules(g, S), maxRetries: 3, canRetry: async () => false });
  assert.equal(n, 1);
  assert.equal(r.stopped, "plafond");
});

test("enforceRules : relance en échec → la réponse payée est gardée ; premier appel en échec → l'erreur remonte", async () => {
  let n = 0;
  const r = await enforceRules({
    produce: async () => { if (n++) throw new Error("HTTP 503"); return { ...good(), title: "" }; },
    check: (g) => checkRules(g, S), maxRetries: 2,
  });
  assert.equal(r.gen.chapo, "Chapô.");
  assert.match(r.stopped, /503/);
  await assert.rejects(enforceRules({ produce: async () => { throw new Error("HTTP 500"); }, check: () => [], maxRetries: 2 }), /500/);
});

test("correctionPrompt n'envoie pas les métadonnées internes", () => {
  const p = correctionPrompt([{ detail: "x", retry: true }], { ...good(), ruleCheck: { attempts: 1 }, lengthTarget: { target: 1 } });
  assert.ok(!p.includes("ruleCheck") && !p.includes("lengthTarget"));
});

test("le prompt annonce le contrôle", () => {
  assert.match(userPrompt({}, {}), /IMPÉRATIVES : ta réponse est contrôlée/);
});

test("finalize : écart persistant → signalement « regles_non_tenues », slug remis au format", () => {
  const gen = { ...good(), title: "t".repeat(70) + " titre", category: "Société", ruleCheck: { attempts: 2, violations: [] }, lengthTarget: null };
  gen.seo.slug = "Mauvais Slug";
  const fin = finalizeGenerated(gen, { rawText: "", settings: S });
  assert.match(gen.seo.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const f = fin.flags.find((x) => x.type === "regles_non_tenues");
  assert.ok(f, "signalé");
  assert.match(f.detail, /après 2 demande\(s\)/);
  assert.equal(fin.checks.rules.attempts, 2);
  assert.ok(!fin.checks.rules.violations.some((v) => v.rule === "slug"), "le slug corrigé ne compte plus");
});

/* M3-113 : avant, le mock n'avait pas de checks.rules (null). Désormais ses
   règles sont mesurées (checked), sans relance (attempts 0) ni signalement. */
test("finalize : article du mock (sans ruleCheck) → mesuré, sans relance ni signalement", () => {
  const gen = { ...good(), title: "t".repeat(90), category: "Société" };
  const fin = finalizeGenerated(gen, { rawText: "", settings: S });
  assert.equal(fin.checks.rules.attempts, 0);
  assert.equal(fin.checks.rules.stopped, null);
  assert.deepEqual(fin.checks.rules.checked.map((x) => x.cle), REGLES_CONTROLEES.map((x) => x.cle));
  assert.equal(fin.checks.rules.checked.find((x) => x.cle === "titre").ok, false);
  assert.ok(fin.checks.rules.violations.some((v) => v.rule === "title"));
  assert.ok(!fin.flags.some((x) => x.type === "regles_non_tenues"));
  assert.equal(rulesCheck(null), null);
});

/* --- M3-113 : checks.rules.checked ------------------------------------- */

const byKey = (checked) => Object.fromEntries(checked.map((x) => [x.cle, x]));

test("evaluateRules : une évaluation par règle, dans l'ordre de REGLES_CONTROLEES, au format du contrat", () => {
  const { violations, checked } = evaluateRules(good(), S);
  assert.deepEqual(violations, checkRules(good(), S));
  assert.deepEqual(checked.map((x) => x.cle), ["titre", "intertitre", "h1", "balise_titre", "meta", "mots_cles", "slug", "plan_hn"]);
  for (const c of checked) {
    assert.equal(typeof c.attendu.texte, "string");
    assert.equal(typeof c.obtenu.texte, "string");
    assert.ok(c.ok === true || c.ok === false || c.ok === null);
    assert.equal(typeof c.retry, "boolean");
  }
  assert.ok(checked.every((c) => c.ok === true), "article conforme : tout tenu");
  assert.deepEqual(REGLES_CONTROLEES.map((x) => x.cle).slice(0, 8), checked.map((x) => x.cle));
  assert.ok(REGLES_CONTROLEES.every((x) => x.libelle));
});

test("checked : règles tenues, attendu et obtenu chiffrés", () => {
  const c = byKey(evaluateRules(good(), S).checked);
  assert.deepEqual(c.titre, { cle: "titre", attendu: { max: 60, texte: "≤ 60 caractères" }, obtenu: { valeur: 44, texte: "44 caractères" }, ok: true, retry: true });
  assert.deepEqual(c.intertitre.obtenu, { valeur: 21, texte: "plus long : 21 caractères" });
  assert.equal(c.h1.ok, true);
  assert.deepEqual(c.balise_titre.attendu, { max: 60, texte: "≤ 60 caractères" });
  assert.equal(c.balise_titre.retry, false);
  assert.deepEqual(c.meta.attendu, { min: 70, max: 160, texte: "70–160 caractères" });
  assert.deepEqual(c.meta.obtenu, { valeur: 100, texte: "100 caractères" });
  assert.deepEqual(c.mots_cles.obtenu, { valeur: 3, texte: "3 mots-clés" });
  assert.deepEqual(c.slug.attendu, { max: 6, texte: "≤ 6 mots, sans mot vide ni date" });
  assert.equal(c.slug.obtenu.valeur, "rochefort-ouvre-mediatheque");
  assert.equal(c.slug.retry, false);
  assert.equal(c.plan_hn.ok, true);
  assert.equal(c.plan_hn.obtenu.valeur, 1);
});

test("checked : chaque règle en écart, ok = false, et les mêmes écarts que checkRules", () => {
  const g = good();
  g.title = "t".repeat(61);
  g.body = [{ type: "h1", text: "Titre" }, para(900), { type: "h2", text: "i".repeat(41) }, para(900)];
  g.seo = { metaTitle: "x".repeat(61), metaDescription: "court", slug: "fete-de-la-ville", keywords: ["a", ""] };
  const { violations, checked } = evaluateRules(g, S);
  const c = byKey(checked);
  for (const k of ["titre", "intertitre", "h1", "balise_titre", "meta", "mots_cles", "slug", "plan_hn"]) assert.equal(c[k].ok, false, k);
  assert.equal(c.mots_cles.obtenu.valeur, 1, "le mot-clé vide ne compte pas");
  assert.match(c.slug.obtenu.texte, /mot vide/);
  assert.deepEqual(violations.map((v) => v.rule).sort(), ["h1", "h2_title", "keywords", "meta_description", "meta_title", "slug", "title"].sort());
});

test("checked : plan Hn en écart au-delà du seuil, non mesuré sans intertitre", () => {
  const g = good();
  g.body = [para(1600)];
  const c = byKey(evaluateRules(g, S).checked);
  assert.equal(c.plan_hn.ok, false);
  assert.deepEqual(c.plan_hn.attendu, { min: 1, seuil: 1500, texte: "1 H1 · ≥ 1 H2 au-delà de 1 500 signes" });
  assert.equal(c.intertitre.ok, null);
  assert.equal(c.intertitre.motif, "aucun intertitre à mesurer");
});

test("checked : fenêtres M3-86 figées dans l'attendu ; balise trop courte → relance", () => {
  const F = { title: { min: 30, max: 50 }, metaTitle: { min: 40, max: 55 }, metaDesc: { min: 90, max: 120 } };
  const c = byKey(evaluateRules(good(), S, null, F).checked);
  assert.deepEqual(c.titre.attendu, { min: 30, max: 50, texte: "30–50 caractères" });
  assert.equal(c.balise_titre.ok, false);
  assert.equal(c.balise_titre.retry, true, "trop courte : seul le modèle peut l'allonger");
  assert.deepEqual(c.meta.attendu, { min: 90, max: 120, texte: "90–120 caractères" });
});

test("finalize : checked stocké avec les preuves de finalize, retry figé", () => {
  const gen = { ...good(), category: "Société", ruleCheck: { attempts: 1, violations: [] }, lengthTarget: null };
  const fin = finalizeGenerated(gen, { rawText: "", settings: S });
  assert.deepEqual(fin.checks.rules.checked.map((x) => x.cle), REGLES_CONTROLEES.map((x) => x.cle));
  const c = byKey(fin.checks.rules.checked);
  for (const k of ["attribution", "citations", "lieux", "rubrique"]) assert.equal(c[k].retry, false, k);
  assert.equal(c.attribution.ok, null);
  assert.equal(c.citations.motif, "aucun texte source");
});
