/* M3-86 — longueur visée bornée : minimum fixe, pourcentage de la source,
   maximum fixe. Ce qui compte :
   - les trois régimes de la borne ;
   - le prompt cite la cible et la fenêtre que le contrôle vérifie ensuite ;
   - le contrôle relit la cible du prompt, il ne la recalcule pas autrement ;
   - 0 % rend la consigne d'avant, mot pour mot. */

import test from "node:test";
import assert from "node:assert/strict";

import { lengthTarget, withinTarget, LENGTH_DEFAULTS, LENGTH_TOLERANCE } from "../src/llm/lengthTarget.js";
import { rulesOf } from "../src/llm/rules.js";
import { userPrompt } from "../src/llm/prompts/generate.js";
import { lengthCheck } from "../src/generate/finalize.js";
import { sourceSignsOf } from "../src/generate/quality.js";
import { SETTING_SPECS } from "../src/lib/yamlStore.js";

const R = rulesOf({ breve_signs_min: 600, signs_max: 7000, length_source_pct: 50 });
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

test("source trop petite : le minimum fixe", () => {
  const t = lengthTarget(R, 800);           // 50 % = 400 < 600
  assert.equal(t.bound, "min");
  assert.equal(t.target, 600);
  assert.equal(t.min, 600, "la fenêtre ne descend jamais sous le minimum");
  assert.equal(t.max, 720);
});

test("entre les bornes : le pourcentage de la source", () => {
  const t = lengthTarget(R, 5000);          // 50 % = 2500
  assert.equal(t.bound, "pct");
  assert.equal(t.target, 2500);
  assert.equal(t.min, 2500 * (1 - LENGTH_TOLERANCE));
  assert.equal(t.max, 2500 * (1 + LENGTH_TOLERANCE));
});

test("source trop grande : le maximum fixe", () => {
  const t = lengthTarget(R, 40000);         // 50 % = 20 000 > 7 000
  assert.equal(t.bound, "max");
  assert.equal(t.target, 7000);
  assert.equal(t.max, 7000, "la fenêtre ne dépasse jamais le maximum");
});

test("la fenêtre tient toujours dans [minimum, maximum]", () => {
  for (const pct of [1, 10, 50, 100, 300, 1000]) {
    for (const n of [1, 100, 599, 600, 1000, 3333, 7000, 7001, 50000]) {
      const t = lengthTarget({ ...R, length_source_pct: pct }, n);
      assert.ok(t.min >= 600 && t.max <= 7000 && t.min <= t.target && t.target <= t.max, `${pct} % de ${n}`);
    }
  }
});

test("0 % ou source inconnue : pas de cible", () => {
  assert.equal(lengthTarget({ ...R, length_source_pct: 0 }, 5000), null);
  assert.equal(lengthTarget(R, 0), null);
  assert.equal(lengthTarget(R, undefined), null);
});

test("le réglage existe, avec le défaut du module", () => {
  assert.equal(SETTING_SPECS.length_source_pct.default, LENGTH_DEFAULTS.length_source_pct);
  assert.equal(SETTING_SPECS.length_source_pct.min, 0, "0 désactive la règle");
});

test("le prompt cite la cible et la fenêtre exactes de lengthTarget", () => {
  const t = lengthTarget(R, 5000);
  const p = userPrompt({}, { rules: R, sourceSigns: 5000 });
  assert.ok(p.includes(`environ\n  ${fmt(t.target)} signes`), "cible");
  assert.ok(p.includes(`JAMAIS moins de ${fmt(t.min)} ni plus de ${fmt(t.max)} signes`), "fenêtre");
  assert.ok(p.includes("50 % de la matière utile de la source (5 000 signes)"));
  assert.ok(!p.includes("Longueur PROPORTIONNÉE"), "l'ancienne consigne disparaît");
});

test("cible de brève : le prompt le dit", () => {
  const p = userPrompt({}, { rules: R, sourceSigns: 800 });
  assert.match(p, /le minimum fixé, la source étant courte/);
  assert.match(p, /C'est une BRÈVE/);
});

test("la mesure peut venir des éléments extraits, et ne part pas au modèle", () => {
  const p = userPrompt({ facts: ["x"], source_signs: 5000 }, { rules: R });
  assert.ok(p.includes("JAMAIS moins de 2 000 ni plus de 3 000 signes"));
  assert.ok(!p.includes("source_signs"), "donnée pour le code, pas pour le modèle");
});

test("0 % : la consigne d'avant M3-86, mot pour mot", () => {
  const p = userPrompt({}, { rules: { length_source_pct: 0 }, sourceSigns: 5000 });
  assert.ok(p.includes("600 à 1 500 signes (1 à 2 paragraphes). Sinon, 600 à 7 000 signes."));
});

test("le contrôle relit la cible du prompt, pas une autre", () => {
  const target = lengthTarget(R, 5000);
  const body = [{ type: "p", text: "x".repeat(2600) }];
  const c = lengthCheck({ body, lengthTarget: target }, { rawText: "", settings: { length_source_pct: 10 } });
  assert.equal(c.target, 2500, "la cible du prompt, malgré des réglages différents");
  assert.equal(c.signs, 2600);
  assert.equal(c.ok, true);
  const court = lengthCheck({ body: [{ type: "p", text: "x".repeat(1000) }], lengthTarget: target });
  assert.equal(court.ok, false);
  assert.equal(withinTarget(target, 3001), false);
  assert.equal(lengthCheck({ body, lengthTarget: null }), null, "pas de cible, pas de contrôle");
});

test("signes utiles de la source : le boilerplate ne compte pas", () => {
  const info = "La commune ouvre une nouvelle médiathèque au centre-ville ce samedi matin.";
  const legal = "Ce communiqué peut contenir des déclarations prospectives qui ne sont pas des garanties.";
  assert.equal(sourceSignsOf(`${info} ${legal}`), info.length);
});

/* --- titres et méta-description (M3-86) --- */

import { fieldTargets, fieldRule, withinField } from "../src/llm/lengthTarget.js";
import { checkRules } from "../src/llm/rules.js";
import { sourceFieldMeasuresOf } from "../src/generate/quality.js";

const FR = rulesOf({ title_max: 90, title_min: 30, meta_title_max: 60, meta_title_min: 30, meta_desc_min: 70, meta_desc_max: 160, title_source_pct: 100, meta_source_pct: 80 });

test("champs : null si le pourcentage est 0 (défaut) ou la mesure absente", () => {
  assert.deepEqual(fieldTargets(rulesOf({}), { sourceTitleChars: 70, sourceLeadChars: 200 }), { title: null, metaTitle: null, metaDesc: null });
  assert.deepEqual(fieldTargets(FR, {}), { title: null, metaTitle: null, metaDesc: null });
  assert.equal(fieldTargets(FR, { sourceTitleChars: 0, sourceLeadChars: 0 }).title, null);
  assert.equal(LENGTH_DEFAULTS.title_source_pct, 0);
  assert.equal(LENGTH_DEFAULTS.meta_source_pct, 0);
  assert.equal(LENGTH_DEFAULTS.title_min, 30);
  assert.equal(LENGTH_DEFAULTS.meta_title_min, 30);
});

test("champs : pct × source, fenêtre ±20 %, bornée par min et max", () => {
  const f = fieldTargets(FR, { sourceTitleChars: 70, sourceLeadChars: 150 });
  assert.deepEqual(f.title, { target: 70, min: 56, max: 84, bound: "pct", pct: 100, sourceChars: 70 });
  /* La balise titre suit le même titre source, mais plafonnée à 60. */
  assert.deepEqual(f.metaTitle, { target: 60, min: 48, max: 60, bound: "max", pct: 100, sourceChars: 70 });
  assert.deepEqual(f.metaDesc, { target: 120, min: 96, max: 144, bound: "pct", pct: 80, sourceChars: 150 });
});

test("champs : minimum fixe pour une source courte, maximum pour une longue", () => {
  const f = fieldTargets(FR, { sourceTitleChars: 10, sourceLeadChars: 500 });
  assert.equal(f.title.bound, "min");
  assert.deepEqual([f.title.target, f.title.min, f.title.max], [30, 30, 36]);
  assert.equal(f.metaDesc.bound, "max");
  assert.deepEqual([f.metaDesc.target, f.metaDesc.min, f.metaDesc.max], [160, 128, 160]);
});

test("champs : bornes incohérentes → null", () => {
  assert.equal(fieldTargets({ ...FR, title_min: 100, title_max: 90 }, { sourceTitleChars: 70 }).title, null);
});

test("withinField : sans cible, vrai ; avec cible, la fenêtre", () => {
  assert.equal(withinField(null, 5), true);
  const t = fieldTargets(FR, { sourceTitleChars: 70 }).title;
  assert.equal(withinField(t, 56), true);
  assert.equal(withinField(t, 55), false);
  assert.equal(withinField(t, 85), false);
});

test("fieldRule : sans cible, le texte d'avant ; avec cible, la fenêtre et sa raison", () => {
  const R0 = rulesOf({});
  assert.equal(fieldRule("title", R0, null), "≤ 90 caractères");
  assert.equal(fieldRule("metaTitle", R0, null), "≤ 60 caractères");
  assert.equal(fieldRule("metaDesc", R0, null), "entre 70 et 160 caractères");
  const f = fieldTargets(FR, { sourceTitleChars: 70, sourceLeadChars: 150 });
  assert.equal(fieldRule("title", FR, f.title), "environ 70 caractères, jamais moins de 56 ni plus de 84 — 100 % du titre de la source (70 caractères)");
  assert.match(fieldRule("metaDesc", FR, f.metaDesc), /80 % du chapô de la source \(150 caractères\)$/);
  assert.match(fieldRule("metaTitle", FR, f.metaTitle), /le maximum fixé/);
});

test("checkRules : fenêtres du titre, de la balise titre et de la méta-description", () => {
  const f = fieldTargets(FR, { sourceTitleChars: 70, sourceLeadChars: 150 });
  const base = () => ({
    title: "t".repeat(70), chapo: "c", body: [{ type: "p", text: "a".repeat(900) }],
    seo: { metaTitle: "m".repeat(55), metaDescription: "d".repeat(120), slug: "slug-ok", keywords: ["a", "b", "c"] },
  });
  assert.deepEqual(checkRules(base(), FR, null, f), []);
  const g = base();
  g.title = "t".repeat(40);                 // < 56
  g.seo.metaTitle = "m".repeat(40);          // < 48
  g.seo.metaDescription = "d".repeat(150);   // > 144
  const v = checkRules(g, FR, null, f);
  assert.deepEqual(v.map((x) => x.rule).sort(), ["meta_description", "meta_title", "title"]);
  assert.match(v.find((x) => x.rule === "title").detail, /entre 56 et 84/);
  assert.equal(v.find((x) => x.rule === "meta_title").retry, true, "trop courte : le modèle doit l'allonger");
  g.seo.metaTitle = "m".repeat(61);
  assert.equal(checkRules(g, FR, null, f).find((x) => x.rule === "meta_title").retry, false, "trop longue : finalize raccourcit");
});

test("non-régression : sans cible de champ, checkRules garde la règle d'avant", () => {
  const g = { title: "t".repeat(40), chapo: "c", body: [{ type: "p", text: "a".repeat(900) }], seo: { metaTitle: "m".repeat(40), metaDescription: "d".repeat(100), slug: "slug-ok", keywords: ["a", "b", "c"] } };
  const R0 = rulesOf({});
  assert.deepEqual(checkRules(g, R0), []);
  assert.deepEqual(checkRules(g, R0, null, { title: null, metaTitle: null, metaDesc: null }), []);
  g.title = "t".repeat(91);
  assert.match(checkRules(g, R0)[0].detail, /91 caractères, 90 au plus/);
});

test("sourceFieldMeasuresOf : titre et chapô de la source", () => {
  const text = "Menu\n\nLa mairie de Rochefort annonce l'ouverture d'une médiathèque en centre-ville. Elle ouvrira ses portes en janvier prochain.\n\nSecond paragraphe de la source, assez long pour compter ici.";
  const m = sourceFieldMeasuresOf({ title: "  Une   médiathèque à Rochefort ", text });
  assert.equal(m.source_title_chars, "Une médiathèque à Rochefort".length);
  assert.equal(m.source_lead_chars, "La mairie de Rochefort annonce l'ouverture d'une médiathèque en centre-ville. Elle ouvrira ses portes en janvier prochain.".length);
  assert.deepEqual(sourceFieldMeasuresOf({}), { source_title_chars: 0, source_lead_chars: 0 });
});
