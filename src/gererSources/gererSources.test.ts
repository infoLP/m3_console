import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  affichageFiabilite, appliquerChamp, compterProblemes, consequenceSuppression, decouperSurlignage, effacerFiltres, etatRecolte,
  filtreActif, filtrerSources, filtresDepuisUrl, filtresVersUrl, FILTRES_DEFAUT, figerOrganisation, frequenceAffichee, groupes,
  memeAdresse, problemesDe, proposerZones, regionsPourFiltre, resumeTest, sourceDepuisDemande, urlDe, zoneMatches,
  type EtatRecolteBrut, type Fiabilite, type Filtres, type ResultatTest, type Source,
} from "./gererSources.regles";

const S = (p: Partial<Source>): Source => ({ id: p.id || "s-1", name: "x", type: "rss", ...p });

describe("filtrerSources", () => {
  const liste = [
    S({ id: "a", name: "Mairie Aytré", kind: "public", active: true, dept: "17", commune: "Aytré" }),
    S({ id: "b", name: "Entreprise", kind: "private", active: false, region: "75" }),
    S({ id: "c", name: "Sans zone", kind: "public", active: true }),
  ];
  it("chaque filtre applique les autres", () => {
    assert.deepEqual(filtrerSources(liste, { ...FILTRES_DEFAUT, kind: "public" }).map((s) => s.id), ["a", "c"]);
    assert.deepEqual(filtrerSources(liste, { ...FILTRES_DEFAUT, kind: "public", zone: "none" }).map((s) => s.id), ["c"]);
    assert.deepEqual(filtrerSources(liste, { ...FILTRES_DEFAUT, activeOnly: true, q: "aytré" }).map((s) => s.id), ["a"]);
    assert.deepEqual(filtrerSources(liste, { ...FILTRES_DEFAUT, zone: "r:75" }).map((s) => s.id), ["a", "b"], "la région inclut ses départements");
    assert.deepEqual(filtrerSources(liste, { ...FILTRES_DEFAUT, zone: "d:17" }).map((s) => s.id), ["a"]);
  });
  it("zoneMatches : sans zone, région, département", () => {
    assert.equal(zoneMatches(liste[2], "none"), true);
    assert.equal(zoneMatches(liste[0], "none"), false);
    assert.equal(zoneMatches(liste[1], "r:75"), true);
  });
  it("regionsPourFiltre compte par région et par département", () => {
    const r = regionsPourFiltre(liste);
    assert.equal(r.sansZone, 1);
    assert.equal(r.regions.length, 1);
    assert.equal(r.regions[0].n, 2);
    assert.deepEqual(r.regions[0].depts, [{ code: "17", nom: "Charente-Maritime", n: 1 }]);
  });
});

describe("appliquerChamp", () => {
  it("rend une copie, l'original ne bouge pas", () => {
    const s = S({ name: "a" });
    const { source } = appliquerChamp(s, "name", "b");
    assert.equal(s.name, "a");
    assert.equal(source.name, "b");
  });
  it("l'URL va dans le champ du type, et suit un changement de type", () => {
    let s = appliquerChamp(S({ type: "rss" }), "url", "https://x/feed").source;
    assert.equal(s.rssUrl, "https://x/feed");
    s = appliquerChamp(s, "type", "site").source;
    assert.equal(s.rssUrl, undefined);
    assert.equal(s.siteUrl, "https://x/feed");
    assert.equal(urlDe(s), "https://x/feed");
  });
  it("une zone en cours de frappe n'est pas retenue, une zone connue l'est", () => {
    const s = S({});
    assert.equal(appliquerChamp(s, "zone", "1").invalide, true);
    const ok = appliquerChamp(s, "zone", "17 · Charente-Maritime");
    assert.equal(ok.invalide, undefined);
    assert.equal(ok.source.dept, "17");
    const reg = appliquerChamp(s, "zone", "Région · Nouvelle-Aquitaine").source;
    assert.equal(reg.region, "75");
    assert.equal(reg.dept, undefined);
  });
  it("l'organisation retapée garde son groupe jusqu'à ce que le champ soit quitté", () => {
    const a = S({ id: "a", organisation: "Mairie" });
    const b = S({ id: "b", organisation: "Mairie" });
    const a2 = appliquerChamp(a, "organisation", "Mai").source;
    assert.equal(groupes([a2, b]).length, 1, "toujours un seul groupe pendant la frappe");
    const fige = figerOrganisation(a2);
    assert.equal(fige.orgAffichee, undefined);
    assert.equal(groupes([fige, b]).length, 2);
  });
});

describe("sourceDepuisDemande", () => {
  const t = { id: "t-1", label: "Nouvelle mairie", url: "https://mairie.fr/", type: "site", commune: "Aytré", dept: "17", status: "ouvert", requestedBy: "a", at: "2026-10-14" };
  it("inactive, pré-remplie, URL dans le bon champ", () => {
    const s = sourceDepuisDemande(t);
    assert.equal(s.active, false);
    assert.equal(s.fromTicket, "t-1");
    assert.equal(s.siteUrl, "https://mairie.fr/");
    assert.equal(s.dept, "17");
  });
  it("memeAdresse repère le doublon par ticket ou par URL", () => {
    assert.equal(memeAdresse([S({ siteUrl: "https://mairie.fr/" })], t), true);
    assert.equal(memeAdresse([S({ fromTicket: "t-1" })], t), true);
    assert.equal(memeAdresse([S({ siteUrl: "https://autre.fr/" })], t), false);
  });
});

describe("proposerZones", () => {
  it("remplit les sources avec commune et sans zone, signale inconnues et ambiguës", () => {
    const liste = [S({ id: "a", commune: "Aytré" }), S({ id: "b", commune: "Inconnue" }), S({ id: "c", commune: "Saint-Jean" }), S({ id: "d", commune: "Aytré", dept: "17" })];
    const r = proposerZones(liste, { "Aytré": { dept: "17" }, "Inconnue": null, "Saint-Jean": { ambiguous: true } });
    assert.equal(r.filled, 1);
    assert.deepEqual(r.ids, ["a"]);
    assert.equal(r.sources[0].dept, "17");
    assert.equal(r.sources[0].scopeLevel, "commune");
    assert.deepEqual(r.left, ["Inconnue", "Saint-Jean (ambiguë)"]);
    assert.equal(r.sources[3], liste[3], "déjà zonée : intouchée");
  });
});

describe("affichageFiabilite", () => {
  const F = (p: Partial<Fiabilite>): Fiabilite => ({ score: 80, level: "fiable", reasons: [], articles: {}, lastItemAt: null, emptyStreak: 0, ...p });

  it("source inconnue : tiret, ton neutre", () => {
    const r = affichageFiabilite(undefined);
    assert.equal(r.texte, "—");
    assert.equal(r.ton, "off");
    assert.match(r.titre, /inconnue/);
  });

  it("source nouvelle (score nul) : tiret, ton neutre, niveau dans l'infobulle", () => {
    const r = affichageFiabilite(F({ score: null, level: "nouvelle", reasons: ["moins de 3 récoltes"] }));
    assert.equal(r.texte, "—");
    assert.equal(r.ton, "off");
    assert.match(r.titre, /nouvelle/);
    assert.match(r.titre, /moins de 3 récoltes/);
  });

  it("ton selon le niveau, chiffre toujours visible", () => {
    assert.deepEqual([F({}), F({ score: 55, level: "moyenne" }), F({ score: 20, level: "faible" }), F({ score: 75, level: "muette" })]
      .map((f) => [affichageFiabilite(f).texte, affichageFiabilite(f).ton]),
      [["80", "on"], ["55", "warn"], ["20", "bad"], ["75", "bad"]]);
  });

  it("infobulle : rendement, récoltes vides d'affilée, dernier item, articles", () => {
    const r = affichageFiabilite(F({ reasons: ["rien de neuf depuis plus de 30 jours"], emptyStreak: 3, lastItemAt: "2026-09-02T08:15:00.000Z",
      articles: { valide: 2, publie: 1, archive: 1, brouillon: 4 } }));
    assert.equal(r.titre, [
      "Score : 80/100 (fiable)",
      "Rendement : rien de neuf depuis plus de 30 jours",
      "Récoltes vides d'affilée : 3",
      "Dernier item : 02/09/2026",
      "Articles : 3 retenu(s), 1 écarté(s)",
    ].join("\n"));
    assert.match(affichageFiabilite(F({})).titre, /Rendement : rien à signaler\nRécoltes vides d'affilée : 0\nDernier item : aucun$/);
  });
});

/* ---------- M3-110 ---------- */

const MAINTENANT = Date.parse("2026-10-15T12:00:00.000Z");
const E = (p: Partial<EtatRecolteBrut>): EtatRecolteBrut => ({ lastAttemptAt: "2026-10-15T04:00:00.000Z", lastOkAt: "2026-10-15T04:00:00.000Z", failures: 0, quarantinedUntil: null, dernier: { at: "2026-10-15T04:00:00.000Z", ok: true, n: 7 }, ...p });
const FE = (etat: EtatRecolteBrut | undefined, p: Partial<Fiabilite> = {}): Fiabilite => ({ score: 80, level: "fiable", reasons: [], articles: {}, lastItemAt: null, emptyStreak: 0, etat, ...p });

describe("etatRecolte", () => {
  it("jamais : pas de fiabilité, pas d'état, ou aucune tentative", () => {
    assert.equal(etatRecolte(undefined, MAINTENANT).cle, "jamais");
    assert.equal(etatRecolte(FE(undefined), MAINTENANT).cle, "jamais");
    const r = etatRecolte(FE(E({ lastAttemptAt: null, dernier: null })), MAINTENANT);
    assert.equal(r.cle, "jamais");
    assert.equal(r.date, null);
    assert.equal(r.texte, "Jamais récoltée");
  });
  it("OK : date courte (heure de Paris) et nombre de contenus en infobulle", () => {
    const r = etatRecolte(FE(E({})), MAINTENANT);
    assert.deepEqual([r.cle, r.texte, r.ton, r.date], ["ok", "OK", "go", "15/10/2026"]);
    assert.match(r.titre, /7 contenu\(s\)/);
    assert.equal(etatRecolte(FE(E({ dernier: { at: "2026-10-14T22:30:00.000Z", ok: true, n: 1 } })), MAINTENANT).date, "15/10/2026", "22 h 30 UTC = minuit et demi à Paris");
  });
  it("échec : échecs d'affilée ou dernière tentative ratée", () => {
    assert.equal(etatRecolte(FE(E({ failures: 2 })), MAINTENANT).cle, "echec");
    assert.equal(etatRecolte(FE(E({ dernier: { at: "2026-10-15T04:00:00.000Z", ok: false, n: 0 } })), MAINTENANT).texte, "Échec");
  });
  it("à l'écart tant que la mise à l'écart court, échec ensuite", () => {
    const r = etatRecolte(FE(E({ failures: 5, quarantinedUntil: "2026-10-17T08:00:00.000Z" })), MAINTENANT);
    assert.deepEqual([r.cle, r.texte, r.ton], ["ecart", "À l'écart jusqu'au 17/10/2026", "amber"]);
    assert.match(r.titre, /10:00/, "heure de Paris dans l'infobulle");
    assert.equal(etatRecolte(FE(E({ failures: 5, quarantinedUntil: "2026-10-15T11:00:00.000Z" })), MAINTENANT).cle, "echec");
  });
  it("muette : réussie mais vide d'affilée", () => {
    assert.equal(etatRecolte(FE(E({}), { level: "muette", emptyStreak: 6 }), MAINTENANT).cle, "muette");
  });
});

describe("problèmes", () => {
  const fiabilite: Record<string, Fiabilite> = {
    ok: FE(E({})),
    ech: FE(E({ failures: 1 })),
    ecart: FE(E({ quarantinedUntil: "2026-10-16T00:00:00.000Z" })),
    muette: FE(E({}), { level: "muette" }),
    faible: FE(E({}), { level: "faible", score: 20 }),
    nouv: FE(E({ lastAttemptAt: null, dernier: null, lastOkAt: null }), { level: "nouvelle", score: null }),
  };
  const liste = [
    S({ id: "ok", active: true, dept: "17" }), S({ id: "ech", active: true, dept: "17" }), S({ id: "ecart", active: true, dept: "17" }),
    S({ id: "muette", active: true, dept: "17" }), S({ id: "faible", active: true, dept: "17" }), S({ id: "nouv", active: true, dept: "17" }),
    S({ id: "inactive", active: false }), S({ id: "neuve", active: true, region: "75" }),
  ];
  const ctx = { fiabilite, maintenant: MAINTENANT };
  it("problemesDe : une cause par motif, cumulables", () => {
    assert.deepEqual(problemesDe(liste[0], fiabilite.ok, MAINTENANT), []);
    assert.deepEqual(problemesDe(liste[2], fiabilite.ecart, MAINTENANT), ["echec"]);
    assert.deepEqual(problemesDe(liste[6], undefined, MAINTENANT), [], "inactive jamais récoltée, sans zone : aucun problème");
    assert.deepEqual(problemesDe(liste[7], undefined, MAINTENANT), ["jamais"]);
    assert.deepEqual(problemesDe(S({ active: true }), fiabilite.ech, MAINTENANT), ["echec"], "sans zone n'est pas un problème");
  });
  it("compterProblemes : total par source, effectifs par cause", () => {
    const r = compterProblemes(liste, ctx);
    assert.equal(r.total, 6);
    assert.deepEqual(r.parCause, { echec: 2, muette: 1, faible: 1, jamais: 2 });
  });
  it("le filtre « problème » prend une cause ou toutes, et n'agit qu'avec le contexte", () => {
    const f = (probleme: string) => filtrerSources(liste, { ...FILTRES_DEFAUT, probleme }, ctx).map((s) => s.id);
    assert.deepEqual(f("echec"), ["ech", "ecart"]);
    assert.deepEqual(f("jamais"), ["nouv", "neuve"]);
    assert.equal(f("tous").length, 6);
    assert.equal(filtrerSources(liste, { ...FILTRES_DEFAUT, probleme: "echec" }).length, liste.length);
  });
});

describe("filtres ↔ URL", () => {
  it("aller-retour sans perte", () => {
    const cas: Filtres[] = [
      FILTRES_DEFAUT,
      { q: "mairie d'Aytré & co", kind: "private", zone: "d:17", activeOnly: true, grouper: false, probleme: "muette" },
      { ...FILTRES_DEFAUT, zone: "r:75", probleme: "tous" },
      { ...FILTRES_DEFAUT, zone: "none", kind: "public" },
    ];
    for (const f of cas) assert.deepEqual(filtresDepuisUrl(new URLSearchParams(filtresVersUrl(f).toString())), f);
  });
  it("les défauts n'apparaissent pas dans l'URL ; les autres paramètres sont gardés", () => {
    assert.equal(filtresVersUrl(FILTRES_DEFAUT).toString(), "");
    const p = filtresVersUrl({ ...FILTRES_DEFAUT, q: "x", activeOnly: true }, new URLSearchParams("demande=t-1&q=ancien&zone=d:17"));
    assert.equal(p.toString(), "demande=t-1&q=x&actives=1");
    assert.equal(filtresVersUrl({ ...FILTRES_DEFAUT, q: "   " }).toString(), "");
  });
  it("searchParams de Next (objet) ; valeurs inconnues ramenées au défaut", () => {
    assert.deepEqual(filtresDepuisUrl({ q: ["a", "b"], volet: "autre", zone: "<script>", probleme: "inconnu", grouper: "0", actives: "oui" }),
      { ...FILTRES_DEFAUT, q: "a", grouper: false });
    /* Un lien gardé d'avant le retrait de la puce « Sans zone » ne filtre plus rien. */
    assert.equal(filtresDepuisUrl({ probleme: "sanszone" }).probleme, "");
  });
  it("filtreActif ignore le regroupement ; Effacer le conserve", () => {
    assert.equal(filtreActif({ ...FILTRES_DEFAUT, grouper: false }), false);
    assert.equal(filtreActif({ ...FILTRES_DEFAUT, q: " " }), false);
    assert.equal(filtreActif({ ...FILTRES_DEFAUT, probleme: "faible" }), true);
    assert.deepEqual(effacerFiltres({ q: "x", kind: "public", zone: "none", activeOnly: true, grouper: false, probleme: "tous" }), { ...FILTRES_DEFAUT, grouper: false });
  });
});

describe("decouperSurlignage", () => {
  it("toutes les occurrences, sans tenir compte de la casse", () => {
    assert.deepEqual(decouperSurlignage("Mairie de La Rochelle, mairie annexe", "MAIRIE"), [
      { texte: "Mairie", marque: true }, { texte: " de La Rochelle, ", marque: false }, { texte: "mairie", marque: true }, { texte: " annexe", marque: false },
    ]);
  });
  it("terme vide ou absent : le texte entier, non marqué", () => {
    assert.deepEqual(decouperSurlignage("Aytré", ""), [{ texte: "Aytré", marque: false }]);
    assert.deepEqual(decouperSurlignage("Aytré", "zzz"), [{ texte: "Aytré", marque: false }]);
  });
});

describe("frequenceAffichee et conséquences", () => {
  it("intervalle saisi, sinon déduit de la fréquence", () => {
    assert.equal(frequenceAffichee(S({ intervalDays: 3 })), "Intervalle : tous les 3 j");
    assert.equal(frequenceAffichee(S({ intervalDays: 0 })), "Intervalle : à chaque récolte");
    assert.equal(frequenceAffichee(S({})), "— (à chaque récolte)");
    assert.match(frequenceAffichee(S({ frequency: "hebdomadaire" })), /^hebdomadaire \(tous les \d+ j\)$/, "le rythme vient de frequencyDays");
  });
  it("consequenceSuppression : nombre d'articles, ou brouillon jamais enregistré", () => {
    assert.equal(consequenceSuppression(FE(undefined, { articles: { valide: 2, brouillon: 10 } }), true),
      "Ses 12 articles restent dans l'historique ; elle ne sera plus récoltée. Effectif à l'enregistrement.");
    assert.match(consequenceSuppression(undefined, true), /^Aucun article/);
    assert.match(consequenceSuppression(FE(undefined, { articles: { publie: 1 } }), true), /^Son article reste/);
    assert.match(consequenceSuppression(undefined, false), /jamais été enregistrée/);
  });
});

describe("resumeTest", () => {
  const R = (p: Partial<ResultatTest>): ResultatTest => ({ ok: true, via: "rss", http: 200, items: 12, complets: 9, exemples: ["a", "b", "c", "d"], dureeMs: 1234, erreur: null, antiRobot: false, ...p });
  it("succès : contenus et complets sur 14 jours, 3 exemples, durée", () => {
    const r = resumeTest(R({}));
    assert.equal(r.ton, "succes");
    assert.equal(r.titre, "12 contenus trouvés, dont 9 complets sur 14 jours");
    assert.deepEqual(r.exemples, ["a", "b", "c"]);
    assert.deepEqual(r.details, ["Test via rss, en 1,2 s."]);
  });
  it("joignable mais vide, ou sans contenu complet : avertissement", () => {
    assert.equal(resumeTest(R({ items: 0, complets: 0, exemples: [] })).ton, "avertissement");
    const r = resumeTest(R({ items: 1, complets: 0 }));
    assert.equal(r.ton, "avertissement");
    assert.equal(r.titre, "1 contenu trouvé, dont 0 complet sur 14 jours");
  });
  it("échec : erreur claire, code HTTP, mention anti-robot", () => {
    const r = resumeTest(R({ ok: false, via: null, http: 403, items: 0, complets: 0, exemples: [], dureeMs: 420, erreur: "Accès refusé par le site", antiRobot: true }));
    assert.equal(r.ton, "erreur");
    assert.equal(r.titre, "Échec du test");
    assert.deepEqual(r.details, ["Protection anti-robot détectée : le site bloque la récolte automatique.", "Accès refusé par le site", "Code HTTP 403.", "Test en 420 ms."]);
  });
});
