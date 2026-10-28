/* M3-85 — prompt recentré et contenus de partenaire. Cas de départ : l'article
   VINCI / Nice-Matin (Var, Alpes-Maritimes) régénéré par Mistral Medium 3.5 le
   13/10 — fidèle, mais classé 80/100, sans attribution, sans la citation de la
   source, sans date, et conclu par une généralité. */

import test from "node:test";
import assert from "node:assert/strict";
import { userPrompt, SYSTEM } from "../src/llm/prompts/generate.js";
import { partnerContent, partnerFlag, isAdvert } from "../src/generate/quality.js";
import { unsourcedPlaces } from "../src/generate/geo.js";
import { finalizeGenerated, stripMarkdown, alteredQuotes } from "../src/generate/finalize.js";
import { DEFAULT_ZONES } from "../shared/zones.js";

/* Deuxième essai du 13/10 : le prompt recentré a fait écrire « notamment en
   Nouvelle-Aquitaine » dans un article sur un supplément VINCI / La Provence, et
   repris le titre du supplément comme parole d'« un porte-parole ». */
const SRC_PROVENCE = "VINCI Autoroutes et le quotidien La Provence publient un supplément de 8 pages, « Mobilité : vers des trajets plus propres, plus collectifs ». Décarbonation des déplacements, mobilités partagées, électrification des usages et adaptation des infrastructures au changement climatique y sont abordés, avec les regards d'élus, de représentants de l'État, d'acteurs du tourisme et d'universitaires des Bouches-du-Rhône et du Vaucluse.";

test("prompt : la zone couverte sert à juger, jamais à écrire ; pas de Markdown ; un titre n'est pas une citation", () => {
  const p = userPrompt({}, {});
  assert.match(p, /Elle sert UNIQUEMENT à juger l'intérêt\s+local/);
  assert.match(p, /N'écris JAMAIS que le sujet concerne cette zone/);
  assert.match(p, /ne fabrique\s+pas de lien local/);
  assert.match(p, /TEXTE BRUT : aucune mise en forme Markdown/);
  assert.match(p, /le titre d'un document, d'un dossier ou d'un slogan n'est pas une citation/);
});

test("lieu de la zone inventé : repéré ; lieu sourcé ou région d'un lieu sourcé : non", () => {
  const gen = "Ce document met en avant les transformations en cours, notamment en Nouvelle-Aquitaine.";
  assert.deepEqual(unsourcedPlaces(gen, SRC_PROVENCE, DEFAULT_ZONES), ["Nouvelle-Aquitaine"]);
  const src = "Le conseil municipal de La Rochelle a voté le budget des écoles pour 2027, avec une hausse de 4 %.";
  assert.deepEqual(unsourcedPlaces("À La Rochelle, en Charente-Maritime (Nouvelle-Aquitaine), le budget est voté.", src, DEFAULT_ZONES), []);
  assert.deepEqual(unsourcedPlaces("Le budget de Niort est voté.", src, DEFAULT_ZONES), ["Niort"]);
});

test("finalize : l'invention est signalée et la zone se lit dans la source, pas dans le texte inventé", () => {
  const gen = {
    title: "VINCI Autoroutes et La Provence explorent l'avenir des mobilités",
    chapo: "Un supplément de 8 pages aborde la décarbonation.",
    body: [{ type: "p", text: "VINCI Autoroutes et le quotidien *La Provence* publient un supplément qui met en avant les transformations, notamment en Nouvelle-Aquitaine." }],
    category: "Société", seo: {},
  };
  const fin = finalizeGenerated(gen, { rawText: SRC_PROVENCE, settings: { zones_covered: DEFAULT_ZONES.join(",") } });
  const h = fin.flags.find((f) => f.type === "hallucination");
  assert.ok(h, "signalement posé");
  assert.match(h.detail, /Nouvelle-Aquitaine/);
  assert.equal(fin.zoneClass, "nonhab", "la source parle des Bouches-du-Rhône et du Vaucluse : hors zone");
  assert.ok(!gen.body[0].text.includes("*"), "Markdown retiré");
});

/* Troisième essai du 13/10 : Croix-Rouge, centre Richelieu de La Rochelle. Bon
   article, mais une citation remaniée sur sept, et « 19 septembre 2024 » au lieu
   du 19 septembre « dernier » d'un texte publié le 24 septembre 2026. Extraits
   exacts de la source. */
const SRC_RICHELIEU = `« Ce nom nous a été inspiré par le livre de Gustave Flaubert, L'Éducation sentimentale, un nom qui souligne une évidence. Artistes et soignants font précisément le même métier : ils réparent les vies et un peu de ce monde », précise Mohamed El Khatib. En 2024, avec de nombreux autres artistes, ils lancent un projet expérimental : « Cela consiste à imaginer ensemble - artistes, patients et soignants - une autre façon de faire de la rééducation en sortant des routines du soin et en effectuant un pas de côté », expose Jean-Charles Erny. « On ne vient pas apporter la bonne parole ; on est dans l'expérience d'une rencontre et d'un échange », assure Olivia Grandville, directrice de Mille Plateaux. Karine Brunelli abonde : « Dans le milieu de la santé, il y a beaucoup de protocoles. Les artistes nous proposent un regard décalé sur nos pratiques, ils font bouger les lignes et réduisent la distance entre patients et soignants... ».`;

test("citations : la retouchée est repérée, les fidèles (même coupées ou en fragment) passent", () => {
  const gen = `L'idée est d'« imaginer ensemble – artistes, patients et soignants – une autre façon de faire de la rééducation en sortant des routines du soin et en effectuant un pas de côté ».
Olivia Grandville souligne que l'objectif n'est pas d'« apporter la bonne parole, mais de vivre une expérience de rencontre et d'échange ».
Karine Brunelli : « Dans le milieu de la santé, il y a beaucoup de protocoles. Les artistes nous proposent un regard décalé sur nos pratiques, ils font bouger les lignes et réduisent la distance entre patients et soignants. »
Mohamed El Khatib rappelle que « artistes et soignants font précisément le même métier : ils réparent les vies et un peu de ce monde ».
Une girouette « surf ». « Ce nom nous a été inspiré (…) un nom qui souligne une évidence. »`;
  const altered = alteredQuotes(gen, SRC_RICHELIEU);
  assert.equal(altered.length, 1);
  assert.match(altered[0], /^apporter la bonne parole, mais de vivre/);
});

test("finalize : citation retouchée signalée, balise titre trop longue raccourcie", () => {
  const gen = {
    title: "L'art soigne les corps au centre Richelieu de La Rochelle",
    chapo: "Un centre alliant art et rééducation a été inauguré à La Rochelle.",
    body: [{ type: "p", text: "À La Rochelle, Olivia Grandville souligne que l'objectif n'est pas d'« apporter la bonne parole, mais de vivre une expérience de rencontre et d'échange »." }],
    category: "Société",
    seo: { metaTitle: "L'art et le soin s'unissent au centre Richelieu de La Rochelle pour les patients", slug: "x" },
  };
  const fin = finalizeGenerated(gen, { rawText: SRC_RICHELIEU, settings: {} });
  assert.ok(fin.flags.some((f) => f.type === "citation_a_verifier"));
  assert.ok(gen.seo.metaTitle.length <= 60, gen.seo.metaTitle);
  assert.ok(!/\s$/.test(gen.seo.metaTitle) && gen.seo.metaTitle.startsWith("L'art et le soin"));
});

test("prompt : dates relatives comptées depuis la publication, jamais l'année d'une autre phrase", () => {
  assert.match(userPrompt({}, {}), /ne prends JAMAIS l'année d'une autre phrase/);
});

test("stripMarkdown : paires retirées, astérisque isolé gardé", () => {
  assert.equal(stripMarkdown("le quotidien *La Provence* publie"), "le quotidien La Provence publie");
  assert.equal(stripMarkdown("un **point** clé et __un autre__"), "un point clé et un autre");
  assert.equal(stripMarkdown("tarif * sous conditions"), "tarif * sous conditions");
  assert.equal(stripMarkdown("## Intertitre"), "Intertitre");
});

test("le prompt porte la grille de ranking, l'attribution, la citation, la date et la fin", () => {
  const p = userPrompt({}, {});
  assert.match(p, /RANKING .*l'intérêt pour un lecteur de la zone couverte, PAS la\s+qualité de ton texte/s);
  assert.match(p, /0-19\s+: sujet hors de la zone couverte/);
  assert.match(p, /ATTRIBUTION : dès le premier ou le deuxième paragraphe, nomme l'émetteur/);
  assert.match(p, /CITATIONS : .*MOT POUR MOT/s);
  assert.match(p, /DATE : situe l'événement par une date explicite/);
  assert.match(p, /FIN : termine sur un fait concret/);
  assert.match(p, /le premier\s+paragraphe ne le répète pas/);
  assert.match(SYSTEM, /Tu dis toujours qui parle/);
});

test("date de publication et nature de la source arrivent au modèle, seulement si connues", () => {
  const p = userPrompt({}, { publishedAt: "2026-09-29T08:00:00Z", partner: true });
  assert.ok(p.includes("Source publiée le 29 septembre 2026."));
  assert.ok(p.includes("Nature de la source : contenu de partenariat"));
  const q = userPrompt({}, {});
  assert.ok(!q.includes("Source publiée le"));
  assert.ok(!q.includes("Nature de la source"));
});

const VINCI = "Découvrez le supplément de Nice-Matin en partenariat avec VINCI Autoroutes. A l'occasion de la récente Semaine européenne de la mobilité, VINCI Autoroutes et le Groupe Nice-Matin ont publié deux suppléments dédiés aux mobilités dans les Alpes-Maritimes et dans le Var.";

test("contenu de partenaire : le supplément VINCI / Nice-Matin est reconnu et signalé, pas écarté", () => {
  const p = partnerContent(VINCI);
  assert.equal(p.partner, true);
  assert.ok(p.hits.includes("en partenariat avec"));
  assert.equal(partnerFlag(p).type, "contenu_partenaire");
  assert.equal(isAdvert(VINCI).advert, false, "le filtre publicité ne l'écarte pas");
});

test("« en partenariat avec » seul reste de l'information légitime", () => {
  const mairie = "La mairie de La Rochelle, en partenariat avec l'ADEME, lance un appel à projets pour la rénovation énergétique des écoles.";
  assert.equal(partnerContent(mairie).partner, false);
  assert.equal(partnerFlag(partnerContent(mairie)), null);
  assert.equal(partnerContent("Un contenu de marque proposé par l'enseigne.").partner, true);
});
