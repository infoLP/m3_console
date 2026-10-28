// M3-113 — Preuves, miroir des règles M3 : quatre états (etatPreuve), une
// preuve par règle en « attendu → obtenu », les faux verts corrigés, l'article
// ancien sans `checks.rules.checked`, l'ordre de lecture et la ligne des non
// mesurés. Plus un rendu statique de Preuves.tsx (pas de JSX ici : createElement).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  etatPreuve, etatSourceDe, lecturePreuves, MOTIF_RELECTURE_AUTO, NON_CONSERVE, pireEtat, preuvesDe, SOURCE_LISIBLE_MIN, verdictPreuves,
  type Article, type Preuve,
} from "./relireArticles.regles";
import { SOURCE_LISIBLE_MIN as SEUIL_CHAINE } from "../generate/finalize.js";
import { Preuves } from "../app/(console)/console/Preuves";

const SOURCE = "La mairie de Rochefort ouvrira une nouvelle médiathèque au printemps prochain. ".repeat(6);
const para = (n: number) => ({ id: `b${n}`, type: "p", text: "Rochefort aura sa médiathèque près de la gare. ".repeat(n) });

/* Article tel que la chaîne l'écrit depuis M3-113, conforme partout. */
const complet = (p: Partial<Article> = {}, checks: Record<string, unknown> = {}): Article => ({
  id: "a1", title: "La mairie de Rochefort ouvre une médiathèque", chapo: "Chapô.", cat: "Culture", ranking: 80, rankingReason: "Sujet local fort.",
  status: "a_revoir", zone: { num: "17" }, mode: "public", provider: "openai",
  body: [{ id: "h", type: "h2", text: "Le projet" }, para(40)],
  source: { type: "site", label: "Ville de Rochefort", url: "https://rochefort.fr/a" },
  illustration: { url: "https://img/x.jpg", credit: "© Ville de Rochefort" },
  seo: { metaTitle: "Rochefort : médiathèque", metaDescription: "x".repeat(100), slug: "rochefort-mediatheque", keywords: ["a", "b", "c"] },
  flags: [],
  origin: { rawText: SOURCE, sourceUrl: "https://rochefort.fr/a", extracted: { facts: [] } },
  checks: {
    length: { min: 1500, max: 2500, target: 2000, pct: 100, sourceSigns: 2000, signs: 1880, ok: true },
    date: { detected: "2026-10-10T10:00:00.000Z", source: "label", ok: true, reason: null, windowHours: 72 },
    geo: { num: "17", commune: "Rochefort", regionOnly: false, outsideNA: false, locality: "Rochefort", origin: "content" },
    category: { from: "Culture", auto: "Culture", overridden: false },
    rules: { attempts: 1, stopped: null, violations: [], checked: [
      { cle: "lieux", attendu: { texte: "lieux de la zone présents dans la source" }, obtenu: { valeur: 1, texte: "1/1 présent dans la source", lieux: ["Rochefort"], absents: [] }, ok: true, retry: false },
    ] },
    review: { status: "fait", verdict: "ok", hallucinations: [], fautes: [], resume: "Fidèle.", engine: "openai" },
    sources: [{ url: "https://rochefort.fr/a", etat: "lue", signes: 480, emetteurNomme: true, citations: { trouvees: 2, total: 2 } }],
    dedup: { score: 0.2, against: null },
    ...checks,
  },
  ...p,
});
const de = (ps: Preuve[], cle: string) => {
  const p = ps.find((x) => x.cle === cle);
  assert.ok(p, `preuve ${cle} absente`);
  return p!;
};
const etats = (ps: Preuve[]) => Object.fromEntries(ps.map((p) => [p.cle, p.etat]));

describe("etatPreuve : quatre états, une seule fonction", () => {
  it("conforme, non conforme ([P]), à vérifier (autre règle), non mesuré", () => {
    assert.equal(etatPreuve("R2", true), "conforme");
    for (const r of ["R1", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R12", "R22"]) assert.equal(etatPreuve(r, false), "non_conforme", r);
    for (const r of ["R2", "R3", "R13", "R14", "R15", "R16", "R17", "R18", "R19", "R21", "R23"]) assert.equal(etatPreuve(r, false), "a_verifier", r);
    assert.equal(etatPreuve("R1", null), "non_mesure");
    assert.equal(etatPreuve("R10", undefined), "non_mesure");
  });
  it("pireEtat : la pire ligne l'emporte, jamais un vert par défaut sur un écart", () => {
    assert.equal(pireEtat(["conforme", "a_verifier", "non_conforme"]), "non_conforme");
    assert.equal(pireEtat(["conforme", "non_mesure"]), "non_mesure");
    assert.equal(pireEtat(["conforme"]), "conforme");
  });
});

describe("preuvesDe : article complet", () => {
  const ps = preuvesDe(complet());
  it("une preuve par règle, clés uniques ; les cinq critères gardent leur ancre", () => {
    assert.equal(new Set(ps.map((p) => p.cle)).size, ps.length);
    assert.deepEqual(ps.filter((p) => p.critere).map((p) => p.critere).sort(), ["illustration", "longueur", "ranking", "seo", "source"]);
    assert.deepEqual(de(ps, "seo").lignes!.map((l) => l.regle), ["R5", "R6", "R7", "R8", "R9"]);
    for (const cle of ["etat-source", "regles", "relances"]) assert.equal(ps.find((p) => p.cle === cle), undefined, cle);
  });
  it("tout est conforme, sauf les consignes : relecture sans verdict par consigne → non mesuré", () => {
    for (const p of ps) if (p.cle !== "consignes") assert.equal(p.etat, "conforme", p.cle);
    const c = de(ps, "consignes");
    assert.equal(c.etat, "non_mesure");
    assert.equal(c.motif, `${MOTIF_RELECTURE_AUTO} ; relecture sans verdict par consigne`);
  });
  it("attendu → obtenu, avec les vraies valeurs", () => {
    assert.match(de(ps, "longueur").attendu, /^1\s500–2\s500 signes \(cible 2\s000 = 100 % de 2\s000 signes de la source\)$/);
    assert.equal(de(ps, "ranking").attendu, "≥ 60 (Paramètres)");
    assert.match(de(ps, "ranking").obtenu, /^80 · Fort alignement$/);
    assert.equal(de(ps, "ranking").detail, "Motif du modèle : Sujet local fort.");
    assert.equal(de(ps, "illustration").obtenu, "image fournie · © Ville de Rochefort");
    assert.equal(de(ps, "citations").obtenu, "2/2 retrouvées telles quelles");
    assert.match(de(ps, "date").attendu, /il y a 10 j au plus/);
  });
});

describe("faux verts corrigés : non mesuré, jamais conforme", () => {
  it("relecture nulle (désactivée)", () => {
    const p = de(preuvesDe(complet({}, { review: null })), "relecture");
    assert.equal(p.etat, "non_mesure");
    assert.match(p.motif!, /désactivée/);
  });
  it("relecture au plafond, ou en échec", () => {
    const p = de(preuvesDe(complet({}, { review: { status: "plafond", detail: "Budget atteint." } })), "relecture");
    assert.equal(p.etat, "non_mesure");
    assert.match(p.motif!, /plafond de dépense atteint : Budget atteint\./);
    assert.equal(de(preuvesDe(complet({}, { review: { status: "echec" } })), "relecture").etat, "non_mesure");
  });
  it("aucune date : non mesuré, et la preuve s'appelle « Fraîcheur de la source »", () => {
    const p = de(preuvesDe(complet({}, { date: { detected: null, source: null, ok: true, reason: null, windowHours: 72 } })), "date");
    assert.equal(p.etat, "non_mesure");
    assert.equal(p.libelle, "Fraîcheur de la source");
    assert.match(p.motif!, /aucune date/);
  });
  it("aucun lieu reconnu", () => {
    const p = de(preuvesDe(complet({}, { geo: { num: null, commune: null, regionOnly: false, outsideNA: false, locality: null, origin: "content" } })), "geo");
    assert.equal(p.etat, "non_mesure");
    assert.equal(p.motif, "aucun lieu reconnu");
  });
  it("0 citation : rien à vérifier", () => {
    const p = de(preuvesDe(complet({}, { sources: [{ url: "https://rochefort.fr/a", etat: "lue", signes: 480, emetteurNomme: true, citations: { trouvees: 0, total: 0 } }] })), "citations");
    assert.equal(p.etat, "non_mesure");
    assert.equal(p.motif, "aucune citation à vérifier");
  });
  it("source trop mince : l'état de la source motive le non mesuré, il n'est plus un critère", () => {
    const ps = preuvesDe(complet({}, { sources: [{ url: null, etat: "illisible", motif: "texte_mince", signes: 140, emetteurNomme: null, citations: null }], rules: { attempts: 1, violations: [] } }));
    assert.match(de(ps, "citations").motif!, /^source de 140 signes/);
    assert.match(de(ps, "lieux").motif!, /^source de 140 signes/);
    assert.equal(de(ps, "attribution").etat, "non_mesure");
  });
});

describe("écarts : non conforme ou à vérifier", () => {
  it("longueur hors fenêtre : non conforme, écart chiffré", () => {
    const p = de(preuvesDe(complet({ body: [para(2)] })), "longueur");
    assert.equal(p.etat, "non_conforme");
    assert.match(p.obtenu, /de moins\)$/);
  });
  it("illustration sans crédit : non conforme ; sous la FEAT « sans illustration » : à vérifier", () => {
    const a = complet({ illustration: { url: "https://img/x.jpg" } });
    assert.equal(de(preuvesDe(a), "illustration").obtenu, "image fournie, crédit manquant");
    assert.equal(de(preuvesDe(a), "illustration").etat, "non_conforme");
    assert.equal(de(preuvesDe(complet({ illustration: null }), null, { sansIllustration: true }), "illustration").etat, "a_verifier");
  });

  it("M3-66 : adresse d'illustration invalide ou non-image → à vérifier, message lisible, parution non bloquée", () => {
    const p = de(preuvesDe(complet({ illustration: { url: "https://img/doc.pdf", credit: "© X" } })), "illustration");
    assert.equal(p.etat, "a_verifier");
    assert.match(p.detail || "", /ne pointe pas vers une image \(fichier \.pdf\).*partira sans image/);
    const q = de(preuvesDe(complet({ illustration: { url: "pas une url", credit: "© X" } })), "illustration");
    assert.match(q.detail || "", /pas une URL valide/);
    assert.equal(de(preuvesDe(complet()), "illustration").detail, undefined, "adresse plausible : rien à dire");
    /* Les deux messages se cumulent : celui de la FEAT n'est pas écrasé. */
    const r = de(preuvesDe(complet({ illustration: { url: "https://img/doc.pdf" } }), null, { sansIllustration: true }), "illustration");
    assert.match(r.detail || "", /fichier \.pdf.*Votre rôle peut publier sans illustration/);
  });
  it("texte du mock : non conforme (R22)", () => {
    assert.equal(de(preuvesDe(complet({ provider: "mock" })), "moteur").etat, "non_conforme");
  });
  it("SEO : une ligne par règle, écart de génération rangé sous sa règle", () => {
    const p = de(preuvesDe(complet({ seo: { metaTitle: "T".repeat(70), metaDescription: "x".repeat(100), slug: "la-mairie-de-rochefort", keywords: ["a", "b", "c"] } },
      { rules: { attempts: 2, violations: [{ rule: "slug", detail: "slug avec un mot vide (le, de, à…)" }] } })), "seo");
    assert.equal(p.etat, "non_conforme");
    const l = Object.fromEntries(p.lignes!.map((x) => [x.cle, x]));
    assert.equal(l.balise_titre.etat, "non_conforme");
    assert.equal(l.slug.etat, "non_conforme");
    assert.match(l.slug.obtenu, /mot vide/);
    assert.deepEqual(l.slug.aLaGeneration, ["slug avec un mot vide (le, de, à…)"]);
    assert.equal(l.meta.etat, "conforme");
    assert.equal(p.pied, "Après 2 demandes au modèle.");
  });
  it("citations retouchées : à vérifier, passages tirés du drapeau", () => {
    const p = de(preuvesDe(complet({ flags: [{ type: "citation_a_verifier", detail: "Absente telle quelle de la source : « Il faut agir vite pour tous » ; « Nous serons prêts en mai prochain ». Rétablir." }] })), "citations");
    assert.equal(p.etat, "a_verifier");
    assert.deepEqual(p.passages!.map((x) => x.texte), ["Il faut agir vite pour tous", "Nous serons prêts en mai prochain"]);
  });
  it("relecture à rejeter : passages, et la ligne des relances en pied", () => {
    const p = de(preuvesDe(complet({}, {
      review: { status: "fait", verdict: "rejet", engine: "anthropic", resume: "Deux inventions.", hallucinations: [{ extrait: "800 places", explication: "la source dit 300" }], fautes: [] },
      regen: { tentatives: [{ moteur: "openai", relance: false, hallucinations: 2 }, { moteur: "anthropic", modele: "m", relance: true, hallucinations: 1 }], retenue: 1, issue: "hallucination_persistante" },
    })), "relecture");
    assert.equal(p.etat, "a_verifier");
    assert.match(p.obtenu, /^À rejeter · 1 hallucination$/);
    assert.equal(p.passages![0].etiquette, "Hallucination : la source dit 300");
    assert.match(p.pied!, /^Relances : hallucination persistante ; 1 relance\(s\) ; version gardée n° 2 sur 2/);
  });
  it("consignes jugées par la relecture : une preuve chacune, faux → à vérifier avec l'extrait (lot D)", () => {
    const consignes = [
      { cle: "style_phrases_creuses", ok: true }, { cle: "chapo_factuel", ok: false, extrait: "Le chapô répète le titre." },
      { cle: "fin_concrete", ok: true }, { cle: "angle", ok: true }, { cle: "communique_non_explique", ok: true },
      { cle: "date_redigee", ok: null }, { cle: "partenaire_signale", ok: null },
    ];
    const ps = preuvesDe(complet({}, { review: { status: "fait", verdict: "ok", hallucinations: [], fautes: [], consignes } }));
    assert.equal(ps.find((p) => p.cle === "consignes"), undefined, "la ligne non mesurée est remplacée");
    const cp = de(ps, "consigne_chapo_factuel");
    assert.equal(cp.etat, "a_verifier");
    assert.equal(cp.famille, "generation");
    assert.equal(cp.passages![0].texte, "Le chapô répète le titre.");
    assert.equal(de(ps, "consigne_style_phrases_creuses").etat, "conforme");
    assert.equal(de(ps, "consigne_date_redigee").etat, "non_mesure");
    assert.equal(de(ps, "consigne_date_redigee").obtenu, "sans objet", "ok null = sans objet, pas « non mesuré »");
    assert.match(de(ps, "consigne_date_redigee").motif!, /sans objet/);
    assert.equal(ps.filter((p) => p.cle.startsWith("consigne_")).length, 6);
    assert.equal(ps.find((p) => p.cle === "partenaire"), undefined, "null, sans drapeau : pas de ligne partenaire");
  });
  it("consignes sans relecture : la ligne non mesurée reste, avec son motif", () => {
    assert.equal(de(preuvesDe(complet({}, { review: null })), "consignes").motif, `${MOTIF_RELECTURE_AUTO} ; relecture désactivée ou non lancée`);
    assert.match(de(preuvesDe(complet({}, { review: { status: "plafond" } })), "consignes").motif!, /plafond de dépense atteint$/);
  });
  it("partenaire : le verdict de la relecture tranche le drapeau", () => {
    const flags = [{ type: "contenu_partenaire", detail: "Publi-information." }];
    const rev = (ok: boolean, extrait?: string) => ({ review: { status: "fait", verdict: "ok", consignes: [{ cle: "partenaire_signale", ok, ...(extrait ? { extrait } : {}) }] } });
    assert.equal(de(preuvesDe(complet({ flags }, rev(true))), "partenaire").etat, "conforme");
    const p = de(preuvesDe(complet({ flags }, rev(false, "Une enseigne locale lance…"))), "partenaire");
    assert.equal(p.etat, "a_verifier");
    assert.equal(p.passages![0].texte, "Une enseigne locale lance…");
    assert.equal(de(preuvesDe(complet({ flags })), "partenaire").obtenu, "source de partenaire détectée : à lire");
  });
  it("rubrique : seule une correction (overridden) est à vérifier", () => {
    assert.equal(de(preuvesDe(complet()), "rubrique").etat, "conforme");
    const p = de(preuvesDe(complet({}, { category: { from: "Culture", auto: "Sport", overridden: true, evidence: 3 } })), "rubrique");
    assert.equal(p.etat, "a_verifier");
    assert.match(p.obtenu, /« Culture » remplacée par « Sport » \(3 indice/);
  });
  it("zone hors couverture, doublon, date hors fenêtre : à vérifier", () => {
    const ps = preuvesDe(complet({}, {
      geo: { num: "83", commune: "Toulon", outsideNA: true, locality: "Toulon", origin: "source" },
      dedup: { score: 0.8, against: "x1" },
      date: { detected: "2027-05-15T10:00:00.000Z", source: "label", ok: false, reason: "future", windowHours: 72 },
    }));
    assert.deepEqual([de(ps, "geo").etat, de(ps, "doublon").etat, de(ps, "date").etat], ["a_verifier", "a_verifier", "a_verifier"]);
    assert.match(de(ps, "date").obtenu, /date annoncée dans le futur/);
  });
  it("article du mock : attempts 0, pas de « 0 demande »", () => {
    const ps = preuvesDe(complet({ provider: "mock" }, { rules: { attempts: 0, checked: [] } }));
    for (const p of ps) assert.doesNotMatch(String(p.pied || ""), /demande/);
  });
});

describe("attendu : figé à la génération, ou Paramètres actuels", () => {
  it("article ancien sans checked : attendu des Paramètres, et il le dit", () => {
    const ps = preuvesDe(complet(), { title_max: 50 });
    assert.equal(de(ps, "titre").parametresActuels, true);
    assert.equal(de(ps, "titre").attendu, "≤ 50 caractères");
    assert.ok(de(ps, "seo").lignes!.every((l) => l.parametresActuels));
  });
  it("checked présent : l'attendu stocké prime, l'obtenu est mesuré maintenant", () => {
    const checked = [
      { cle: "titre", attendu: { max: 40, texte: "≤ 40 caractères" }, obtenu: { valeur: 38, texte: "38 caractères" }, ok: true, retry: true },
      { cle: "balise_titre", attendu: { min: 30, max: 60, texte: "30–60 caractères" }, obtenu: { valeur: 23, texte: "23 caractères" }, ok: false, retry: true },
      { cle: "attribution", attendu: { texte: "émetteur nommé tôt" }, obtenu: { texte: "non" }, ok: false, retry: false },
      { cle: "citations", attendu: { texte: "mot pour mot" }, obtenu: { valeur: 1, texte: "1/2 mot pour mot", absentes: ["Nous ouvrirons demain"] }, ok: false, retry: false },
      { cle: "lieux", attendu: { texte: "dans la source" }, obtenu: { valeur: 0, texte: "aucun lieu cité", lieux: [], absents: [] }, ok: null, motif: "aucun lieu de la zone cité", retry: false },
    ];
    const ps = preuvesDe(complet({}, { rules: { attempts: 1, violations: [], checked } }), { title_max: 200 });
    const t = de(ps, "titre");
    assert.equal(t.attendu, "≤ 40 caractères");
    assert.equal(t.parametresActuels, undefined);
    assert.equal(t.etat, "a_verifier");            // 44 caractères maintenant
    assert.equal(t.obtenu, "44 caractères");
    assert.equal(de(ps, "attribution").etat, "a_verifier");
    assert.deepEqual(de(ps, "citations").passages!.map((x) => x.texte), ["Nous ouvrirons demain"]);
    assert.equal(de(ps, "lieux").motif, "aucun lieu de la zone cité");
  });
  it("seuil du ranking : celui des Paramètres passés", () => {
    const p = de(preuvesDe(complet({ ranking: 70 }), { ranking_threshold: 75 }), "ranking");
    assert.equal(p.attendu, "≥ 75 (Paramètres)");
    assert.equal(p.etat, "non_conforme");
  });
});

describe("lecturePreuves : l'ordre de lecture", () => {
  const ps = preuvesDe(complet({ illustration: null, flags: [{ type: "doublon", detail: "d" }] }, { review: null }));
  const L = lecturePreuves(ps);
  it("verdict, non conformes, à vérifier, familles (conformes seulement), non mesurés", () => {
    assert.deepEqual(L.nonConformes.map((p) => p.cle), ["illustration"]);
    assert.deepEqual(L.aVerifier.map((p) => p.cle), ["doublon"]);
    assert.deepEqual(L.familles.map((f) => f.libelle), ["Cahier des charges", "Génération", "Fidélité à la source", "Contexte"]);
    for (const f of L.familles) for (const p of f.preuves) assert.equal(p.etat, "conforme");
    assert.deepEqual(L.verdict, { bloquants: 1, aVerifier: 1, nonMesures: 2, publiable: false });
    assert.equal(verdictPreuves(L.verdict), "Non publiable : 1 bloquant · 1 à vérifier · 2 non mesurés");
  });
  it("la ligne des non mesurés regroupe par motif : « non conservé » une seule fois", () => {
    const ancien = lecturePreuves(preuvesDe(complet({ checks: undefined, provider: undefined })));
    const motifs = ancien.nonMesures.map((g) => g.motif);
    assert.equal(motifs.filter((m) => m === NON_CONSERVE).length, 1);
    assert.ok(ancien.nonMesures.find((g) => g.motif === NON_CONSERVE)!.preuves.length >= 5);
  });
});

describe("état de la source (motif des non mesurés)", () => {
  it("le seuil de lisibilité est celui de la chaîne", () => {
    assert.equal(SOURCE_LISIBLE_MIN, SEUIL_CHAINE);
  });
  it("illisible : texte trop mince, ou extraction de repli du mock", () => {
    const e = etatSourceDe(complet({ checks: undefined, origin: { rawText: "Court." } }));
    assert.deepEqual([e.etat, e.motif, e.signes], ["illisible", "texte_mince", 6]);
    const r = etatSourceDe(complet({ origin: { rawText: SOURCE, extracted: { _sourceType: "site" } } }));
    assert.deepEqual([r.etat, r.motif], ["illisible", "extraction_repli"]);
  });
});

describe("Preuves.tsx (rendu statique)", () => {
  const rendu = (a: Article, focus?: string, settings: Record<string, unknown> | null = null) => renderToStaticMarkup(h(Preuves, { article: a, focus, settings }));
  it("ids stables, focus, lien source sûr, passages en blockquote, aucun style en ligne", () => {
    const html = rendu(complet({ flags: [{ type: "citation_a_verifier", detail: "Absente telle quelle de la source : « Il faut agir vite pour tous ». Rétablir." }] }), "citations");
    assert.match(html, /id="preuve-citations"[^>]*aria-current="true"/);
    for (const cle of ["longueur", "ranking", "source", "illustration", "seo", "slug"]) assert.match(html, new RegExp(`id="preuve-${cle}"`), cle);
    assert.match(html, /<a href="https:\/\/rochefort\.fr\/a" target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /<blockquote[^>]*>Il faut agir vite pour tous<\/blockquote>/);
    assert.doesNotMatch(html, /style="/);
  });
  it("ordre à l'écran : verdict, non conformes, à vérifier, familles, non mesurés", () => {
    const html = rendu(complet({ illustration: null, flags: [{ type: "doublon", detail: "d" }] }));
    const pos = ["Non publiable", "Non conformes (1)", "À vérifier (1)", "Cahier des charges ·", "Non mesuré ("].map((t) => html.indexOf(t));
    assert.ok(pos.every((x) => x >= 0), String(pos));
    assert.deepEqual(pos, [...pos].sort((x, y) => x - y));
  });
  it("article ancien : « Non conservé » une fois, « (Paramètres actuels) » affiché", () => {
    const html = rendu(complet({ checks: undefined }));
    assert.equal((html.match(/non conservé/gi) || []).length, 1);
    assert.match(html, /\(Paramètres actuels\)/);
  });
  it("une cible repliée (non mesurée) est dépliée et mise en avant", () => {
    const html = rendu(complet({}, { review: null }), "relecture");
    assert.match(html, /<details open=""[^>]*>[\s\S]*id="preuve-relecture"[^>]*aria-current="true"/);
  });
});

/* La liste des consignes est recopiée ici (le panneau n'importe pas la chaîne
   de génération) : elle doit rester celle que la relecture rend. */
describe("consignes de relecture (M3-113, lot D)", () => {
  it("le panneau connaît exactement les clés que rend la relecture", async () => {
    const { CLES_CONSIGNES } = await import("../llm/prompts/review.js");
    const { CONSIGNES_RELECTURE } = await import("./relireArticles.regles");
    assert.deepEqual(CONSIGNES_RELECTURE.map((k) => k.cle), [...CLES_CONSIGNES]);
  });
});
