/* Corps en blocs typés et plan Hn dérivé (TODO « la structure Hn ne sert à rien »,
   tranché le 2026-09-17). Ces tests tiennent l'invariant central : le plan et le
   texte sont la même donnée, lue de deux endroits.

   Lancer : npm test    (node:test, aucune dépendance, pas de base requise) */

import test from "node:test";
import assert from "node:assert/strict";

import {
  asBlocks, isHeading, outlineOf, foldOutlineIntoBody, bodyHtml, plainText, H2_REQUIRED_ABOVE_SIGNS,
} from "../shared/model.js";
import { analyze, wordsOf, seoComplete } from "../shared/scoring.js";
import { finalizeGenerated } from "../src/generate/finalize.js";
import * as mock from "../src/llm/mock.js";

const SEO_OK = {
  metaTitle: "Un titre de balise",
  metaDescription: "d".repeat(100),
  slug: "slug-valide",   // sans mot vide : la grille applique slugRuleOk (M3-113)
  keywords: ["a", "b", "c"],
};

test("asBlocks accepte l'ancien format sans le perdre", () => {
  const b = asBlocks(["un", "deux"]);
  assert.equal(b.length, 2);
  assert.ok(b.every((x) => x.type === "p" && x.id && x.text));
});

test("asBlocks conserve les blocs vides — « Ajouter un paragraphe » en crée un", () => {
  assert.equal(asBlocks([{ type: "p", text: "" }]).length, 1);
});

test("asBlocks ramène un type inconnu à p", () => {
  assert.equal(asBlocks([{ type: "script", text: "x" }])[0].type, "p");
});

test("asBlocks préserve les identifiants existants", () => {
  assert.equal(asBlocks([{ id: "bZZ", type: "h2", text: "T" }])[0].id, "bZZ");
});

test("foldOutlineIntoBody répartit les intertitres sans toucher aux paragraphes", () => {
  const paras = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const out = foldOutlineIntoBody(paras, [
    { t: "H1", x: "Titre" }, { t: "H2", x: "A" }, { t: "H2", x: "B" },
  ]);
  assert.equal(out.filter(isHeading).length, 2, "les deux H2 sont placés");
  assert.ok(!out.some((b) => b.text === "Titre"), "le H1 n'entre pas dans le corps");
  assert.deepEqual(out.filter((b) => !isHeading(b)).map((b) => b.text), paras);
  assert.ok(!isHeading(out[0]), "jamais d'intertitre en tête");
  assert.ok(!isHeading(out.at(-1)), "jamais d'intertitre en queue");
});

test("foldOutlineIntoBody ne crée pas d'intertitre orphelin", () => {
  const plan = [{ t: "H2", x: "A" }, { t: "H2", x: "B" }];
  assert.equal(foldOutlineIntoBody(["seul"], plan).filter(isHeading).length, 0);
  assert.equal(foldOutlineIntoBody(["a", "b"], plan).filter(isHeading).length, 1);
});

test("foldOutlineIntoBody laisse intact un corps déjà structuré", () => {
  const body = [{ type: "h2", text: "X" }, { type: "p", text: "y" }];
  assert.equal(foldOutlineIntoBody(body, [{ t: "H2", x: "Z" }]).length, 2);
});

test("outlineOf : le H1 est le titre, et il n'y en a qu'un", () => {
  const a = { title: "Mon titre", body: asBlocks([{ type: "h2", text: "A" }, { type: "p", text: "x" }]) };
  const ol = outlineOf(a);
  assert.equal(ol.filter((o) => o.t === "H1").length, 1);
  assert.deepEqual({ t: ol[0].t, x: ol[0].x, ref: ol[0].ref }, { t: "H1", x: "Mon titre", ref: "title" });
  assert.equal(ol[1].ref, a.body[0].id, "la ligne du plan désigne le bloc qu'elle édite");
});

test("bodyHtml rend les Hn et échappe le texte", () => {
  const html = bodyHtml({ body: [{ type: "h2", text: "A & <b>" }, { type: "p", text: "texte" }] });
  assert.equal(html, "<h2>A &amp; &lt;b&gt;</h2>\n<p>texte</p>");
});

test("plainText remplace body.join sur les deux formats", () => {
  assert.equal(plainText({ body: ["a", "b"] }), "a\nb");
  assert.equal(plainText({ body: [{ type: "h2", text: "a" }, { type: "p", text: "b" }] }), "a\nb");
});

test("le critère SEO exige désormais un H2 — c'était tout l'objet du TODO", () => {
  const a = {
    title: "T", ranking: 70, source: { type: "site", url: "u" }, illustration: { url: "i", credit: "©" },
    seo: SEO_OK, body: asBlocks([{ type: "p", text: "x".repeat(2000) }]),
  };
  assert.equal(analyze(a).passed, 4);
  assert.equal(seoComplete(a).olOK, false);

  a.body.push({ id: "bh", type: "h2", text: "Un intertitre" });
  a.body.push({ id: "bp", type: "p", text: "suite" });
  assert.equal(analyze(a).passed, 5);
  assert.equal(seoComplete(a).olOK, true);
});

test("outline_h2_min à 0 désactive le contrôle sans toucher au code", () => {
  const a = { title: "T", seo: SEO_OK, body: asBlocks(["x".repeat(2000)]) };
  assert.equal(seoComplete(a, { ...SEO_LIMITS, outline_h2_min: 0 }).olOK, true);
  assert.equal(seoComplete(a, { ...SEO_LIMITS, outline_h2_min: 1 }).olOK, false);
});

const SEO_LIMITS = { meta_title_max: 60, meta_desc_min: 70, meta_desc_max: 160, keywords_min: 3 };

/* Décidé le 2026-10-12 : le prompt demande une brève sans intertitre quand la
   source est mince, et la grille exigeait un H2 partout — 17 brèves sur 18 de la
   première run gpt-6-luna échouaient au SEO pour cette seule raison. */
test("une brève n'a pas à porter de H2 ; un article long, si", () => {
  const breve = { title: "T", seo: SEO_OK, body: asBlocks(["x".repeat(H2_REQUIRED_ABOVE_SIGNS)]) };
  assert.equal(seoComplete(breve, { ...SEO_LIMITS, outline_h2_min: 1 }).olOK, true, "pile au seuil : encore une brève");
  assert.equal(seoComplete(breve).h2Min, 0, "l'exigence affichée suit la règle appliquée");

  const long = { title: "T", seo: SEO_OK, body: asBlocks(["x".repeat(H2_REQUIRED_ABOVE_SIGNS + 1)]) };
  assert.equal(seoComplete(long, { ...SEO_LIMITS, outline_h2_min: 1 }).olOK, false, "un signe de plus : H2 exigé");
  long.body.push({ id: "bh", type: "h2", text: "Un intertitre" }, { id: "bp", type: "p", text: "suite" });
  assert.equal(seoComplete(long, { ...SEO_LIMITS, outline_h2_min: 1 }).olOK, true);
});

/* Le H1 unique ne dépend pas de la longueur : c'est le titre, une brève en a un. */
test("une brève sans titre échoue toujours au plan Hn", () => {
  const breve = { title: "", seo: SEO_OK, body: asBlocks(["x".repeat(800)]) };
  assert.equal(seoComplete(breve).olOK, false);
});

/* M3-113 (décision 1) : signs_min est supprimé. Sans fenêtre checks.length, la
   grille retombe sur breve_signs_min (600), le plancher de la génération : une
   brève de 800 signes, fidèle à sa consigne, est conforme sur la longueur. Le
   désaccord voulu avec le prompt (1 500 signes, preREADME) est levé. */
test("une brève de 800 signes est conforme sur la longueur", () => {
  const breve = {
    title: "T", ranking: 70, source: { type: "site", url: "u" }, illustration: { url: "i", credit: "©" },
    seo: SEO_OK, body: asBlocks(["x".repeat(800)]),
  };
  const r = analyze(breve);
  assert.equal(r.seoOK, true, "le SEO ne la pénalise plus");
  assert.equal(r.lengthOK, true);
  assert.equal(r.passed, 5);
});

/* Le prompt et la grille lisent le même seuil : s'il change, les deux suivent. */
test("le prompt cite le seuil appliqué par la grille", async () => {
  const { userPrompt } = await import("../src/llm/prompts/generate.js");
  const p = userPrompt({}, {});
  const formatted = String(H2_REQUIRED_ABOVE_SIGNS).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  assert.ok(p.includes(`Au-delà de ${formatted} signes, place au moins un h2`));
  assert.ok(p.includes(`600 à ${formatted} signes (1 à 2 paragraphes)`));
});

test("les intertitres comptent dans le nombre de signes", () => {
  const a = { body: [{ type: "p", text: "x".repeat(10) }, { type: "h2", text: "abc" }] };
  assert.equal(wordsOf(a), 10 + 1 + 3);
});

test("le mock produit la même forme que le vrai moteur", async () => {
  const gen = await mock.generateArticle(RICH_EXTRACT, { mode: "source", region: "Nouvelle-Aquitaine" });
  assert.ok(gen.body.every((b) => b && typeof b === "object" && b.type), "des blocs, pas des chaînes");
  assert.ok(gen.body.some(isHeading), "au moins un intertitre sur un sujet fourni");
  assert.equal(gen.seo.outline, undefined, "plus de plan séparé");
});

test("finalize retire les intertitres orphelins et garde les blocs", async () => {
  const gen = await mock.generateArticle(RICH_EXTRACT, { mode: "source", region: "Nouvelle-Aquitaine" });
  gen.body.push({ type: "h2", text: "Intertitre final sans section" });
  finalizeGenerated(gen, { rawText: "source", settings: { region: "Nouvelle-Aquitaine" } });

  assert.ok(gen.body.every((b) => b && b.type), "toujours des blocs après finalize");
  assert.ok(
    !gen.body.some((b, i) => isHeading(b) && (!gen.body[i + 1] || isHeading(gen.body[i + 1]))),
    "aucun intertitre sans paragraphe sous lui"
  );
  assert.ok(outlineOf(gen).length >= 2, "le plan dérivé n'est pas vide");
});

const RICH_EXTRACT = {
  facts: [
    "Le conseil a voté une enveloppe de 4 millions d'euros pour la rénovation.",
    "Les travaux commenceront au printemps prochain sur trois sites.",
    "La commune prendra en charge un tiers du financement total.",
    "Une concertation publique est prévue avant le dépôt du permis.",
    "Les associations locales demandent des garanties sur le calendrier.",
  ],
  quotes: [], entities: [], locality: "La Rochelle",
  title_hint: "Rénovation des écoles votée", suggested_category: "Société", substance: "riche",
};
