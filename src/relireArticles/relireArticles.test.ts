import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  choixJours, dateCourte, datesArticle, groupesParJour, jourDeGeneration, jourOuvert, JOUR_INCONNU, departementsDeLaFile, deptParDefaut, filteredIndex, kpisEntete, nextPending, pendingInDept, pendingInKind, pendingInZone,
  filtreSources, organisationParSource, PORTEE_DEFAUT, queueSummary, voisin, type Article, type Ligne, type SourceRef,
} from "./relireArticles.regles";

const L = (p: Partial<Ligne>): Ligne => ({ id: p.id || "a", title: "t", cat: "Économie", zone: { num: "17", region: "Nouvelle-Aquitaine" }, zoneClass: "hab", status: "a_revoir", ranking: 50, signs: 1000, reading: 1, ...p });

const file = [
  L({ id: "a", ranking: 80, sourceKind: "public", sourceLabel: "Mairie", scores: { ready: true, conformity: { passed: 5, total: 5, detail: { longueur: true, ranking: true, source: true, illustration: true, seo: true } } } }),
  L({ id: "b", ranking: 60, status: "signale", sourceKind: "private", sourceLabel: "Entreprise", flags: ["hors_sujet"], scores: { ready: false, conformity: { passed: 3, total: 5, detail: { longueur: true, ranking: true, source: true, illustration: false, seo: false } } } }),
  L({ id: "c", ranking: 90, zone: { num: "16", region: "Nouvelle-Aquitaine" }, sourceKind: "public", sourceLabel: "Mairie" }),
  L({ id: "d", ranking: 70, zoneClass: "nonhab", zone: { regionOnly: true, region: "Occitanie" }, sourceKind: "public", sourceLabel: "Autre" }),
  L({ id: "e", status: "publie", updatedAt: "2026-10-14T09:00:00Z", sourceKind: "public", sourceLabel: "Mairie" }),
];

describe("file filtrée", () => {
  it("tri : le plus récent d'abord, puis à traiter, puis ranking décroissant", () => {
    assert.deepEqual(filteredIndex(file, PORTEE_DEFAUT).map((a) => a.id), ["e", "c", "a", "b"]);
  });
  it("chaque filtre applique les autres", () => {
    assert.deepEqual(filteredIndex(file, { ...PORTEE_DEFAUT, dept: "17" }).map((a) => a.id), ["e", "a", "b"]);
    assert.deepEqual(filteredIndex(file, { ...PORTEE_DEFAUT, dept: "17", kind: "private" }).map((a) => a.id), ["b"]);
    assert.deepEqual(filteredIndex(file, { ...PORTEE_DEFAUT, focus: "hors_sujet" }).map((a) => a.id), ["b"]);
    assert.deepEqual(filteredIndex(file, { ...PORTEE_DEFAUT, focus: "ready", prefsDepts: ["17"] }).map((a) => a.id), ["a"]);
    assert.deepEqual(filteredIndex(file, { ...PORTEE_DEFAUT, zone: "nonhab" }).map((a) => a.id), ["d"]);
    assert.deepEqual(filteredIndex(file, { ...PORTEE_DEFAUT, sourceFilter: "Mairie" }).map((a) => a.id), ["e", "c", "a"]);
  });
  it("les badges se réconcilient : Σ pastilles = badge zone = badge « Tout »", () => {
    const p = PORTEE_DEFAUT;
    assert.equal(pendingInZone(file, p, "hab"), 3);
    assert.equal(pendingInDept(file, p, "17") + pendingInDept(file, p, "16"), 3);
    assert.equal(pendingInKind(file, p, ""), 3);
    assert.equal(pendingInKind(file, p, "private"), 1);
    assert.equal(pendingInZone(file, { ...p, kind: "private" }, "hab"), 1, "le badge zone applique le volet");
  });
  it("sources de la portée, hors filtre source lui-même (sans référentiel : depuis les articles)", () => {
    const s = filtreSources(file, { ...PORTEE_DEFAUT, sourceFilter: "lib:Autre" });
    assert.deepEqual(s.groupes.flatMap((g) => g.sources.map((x) => x.label)), ["Mairie", "Entreprise"]);
    assert.equal(s.groupes[0].sources[0].count, 3);
    assert.equal(s.groupes[0].sources[0].pending, 2);
    assert.equal(s.total, 4);
  });
});

describe("M3-59 : filtre source depuis le référentiel, groupé par organisation", () => {
  const ref: SourceRef[] = [
    { id: "s1", name: "Magazine municipal", kind: "public", organisation: "Mairie de La Rochelle", active: true, dept: "17" },
    { id: "s2", name: "Communiqués", kind: "public", organisation: "mairie de la rochelle ", active: true, dept: "17" },
    { id: "s3", name: "Communiqués", kind: "public", organisation: "Département 17", active: true, dept: "17" },
    { id: "s4", name: "Sans article", kind: "public", active: true, dept: "17" },
    { id: "s5", name: "Inactive", kind: "public", active: false },
    { id: "s6", name: "Privée", kind: "private", active: true },
    { id: "s7", name: "Charente", kind: "public", active: true, dept: "16" },
  ];
  const idx = [
    L({ id: "a", sourceId: "s1", sourceKind: "public", sourceLabel: "Magazine municipal" }),
    L({ id: "b", sourceId: "s2", sourceKind: "public", sourceLabel: "Communiqués", status: "publie" }),
    L({ id: "c", sourceId: "s3", sourceKind: "public", sourceLabel: "Communiqués" }),
    L({ id: "d", sourceKind: "public", sourceLabel: "Saisie à la main" }),
  ];
  const p = { ...PORTEE_DEFAUT, orgDe: organisationParSource(ref) };
  const options = (f: ReturnType<typeof filtreSources>) => f.groupes.flatMap((g) => g.sources.map((s) => s.cle));

  it("toutes les sources actives de la portée, même à zéro article ; deux homonymes restent deux", () => {
    const f = filtreSources(idx, p, ref);
    assert.deepEqual(options(f).sort(), ["lib:Saisie à la main", "src:s1", "src:s2", "src:s3", "src:s4", "src:s6", "src:s7"]);
    assert.equal(f.total, 4);
  });
  it("une organisation de deux sources forme un groupe, casse et espaces ignorés", () => {
    const g = filtreSources(idx, p, ref).groupes.find((x) => x.cle);
    assert.equal(g?.cle, "org:mairie de la rochelle");
    assert.equal(g?.label, "Mairie de La Rochelle");
    assert.deepEqual(g?.sources.map((s) => s.cle), ["src:s1", "src:s2"], "à traiter d'abord");
    assert.equal(g?.count, 2);
    assert.equal(g?.pending, 1);
    assert.equal(filtreSources(idx, p, ref).groupes.filter((x) => x.cle).length, 1, "« Département 17 » n'a qu'une source : pas de groupe");
  });
  it("le volet et la pastille de département bornent les sources sans article", () => {
    assert.ok(!options(filtreSources(idx, { ...p, kind: "public" }, ref)).includes("src:s6"));
    assert.ok(!options(filtreSources(idx, { ...p, dept: "17" }, ref)).includes("src:s7"));
    assert.ok(options(filtreSources(idx, { ...p, dept: "17" }, ref)).includes("src:s4"));
  });
  it("filtrer par identifiant, par organisation, ou par libellé pour un article sans source", () => {
    assert.deepEqual(filteredIndex(idx, { ...p, sourceFilter: "src:s3" }).map((a) => a.id), ["c"]);
    assert.deepEqual(filteredIndex(idx, { ...p, sourceFilter: "org:mairie de la rochelle" }).map((a) => a.id).sort(), ["a", "b"]);
    assert.deepEqual(filteredIndex(idx, { ...p, sourceFilter: "lib:Saisie à la main" }).map((a) => a.id), ["d"]);
    assert.deepEqual(filteredIndex(idx, { ...PORTEE_DEFAUT, sourceFilter: "org:mairie de la rochelle" }).map((a) => a.id), [], "sans référentiel, pas de regroupement");
  });
});

describe("M3-90 : nouveaux articles en haut, trois dates", () => {
  const datee = [
    L({ id: "vieux", ranking: 95, createdAt: "2026-10-10T08:00:00Z" }),
    L({ id: "neuf", ranking: 10, createdAt: "2026-10-14T06:00:00Z" }),
    L({ id: "milieu", ranking: 50, createdAt: "2026-10-12T06:00:00Z" }),
    L({ id: "paru-neuf", status: "publie", createdAt: "2026-10-14T07:00:00Z" }),
    L({ id: "sans-date", ranking: 99, updatedAt: "2026-10-13T00:00:00Z" }),
  ];
  it("le plus récent en haut, quel que soit le statut ; le ranking ne départage plus", () => {
    assert.deepEqual(filteredIndex(datee, PORTEE_DEFAUT).map((a) => a.id), ["paru-neuf", "neuf", "sans-date", "milieu", "vieux"]);
  });
  it("à date égale, le statut départage : à traiter devant", () => {
    const t = "2026-10-14T06:00:00Z";
    assert.deepEqual(filteredIndex([L({ id: "paru", status: "publie", ranking: 99, createdAt: t }), L({ id: "a-revoir", ranking: 10, createdAt: t })], PORTEE_DEFAUT).map((a) => a.id), ["a-revoir", "paru"]);
  });
  it("à date égale, le ranking départage", () => {
    const t = "2026-10-14T06:00:00Z";
    assert.deepEqual(filteredIndex([L({ id: "x", ranking: 10, createdAt: t }), L({ id: "y", ranking: 90, createdAt: t })], PORTEE_DEFAUT).map((a) => a.id), ["y", "x"]);
  });
  it("datesArticle lit le document (origin) ou la ligne", () => {
    const a = { ...L({ id: "a" }), createdAt: "2026-10-14T06:00:00Z", regeneratedAt: "2026-10-14T09:00:00Z", origin: { harvestedAt: "2026-10-14T05:00:00Z", publishedAt: "2026-10-13" } } as unknown as Article;
    assert.deepEqual(datesArticle(a), { recuperation: "2026-10-14T05:00:00Z", publicationSource: "2026-10-13", generation: "2026-10-14T06:00:00Z", regeneration: "2026-10-14T09:00:00Z" });
    assert.deepEqual(datesArticle(L({ harvestedAt: "2026-10-01T00:00:00Z", sourcePublishedAt: null })), { recuperation: "2026-10-01T00:00:00Z", publicationSource: null, generation: null, regeneration: null });
  });
  it("dateCourte : heure de Paris, heure seulement si la valeur en porte une", () => {
    assert.equal(dateCourte(null), "—");
    assert.equal(dateCourte("pas une date"), "—");
    assert.match(dateCourte("2026-10-13"), /^13 oct\.? 2026$/);
    assert.match(dateCourte("2026-10-14T06:05:00Z"), /14 oct\.? 2026.*08:05/);
  });
});

describe("navigation dans la file", () => {
  it("nextPending : dans la zone d'abord, sinon n'importe où", () => {
    assert.equal(nextPending(file, PORTEE_DEFAUT, "c"), "a");
    assert.equal(nextPending(file, { ...PORTEE_DEFAUT, zone: "nonhab" }, "d"), "c", "plus rien dans la zone : la file entière");
  });
  it("voisin suit la file filtrée", () => {
    assert.equal(voisin(file, PORTEE_DEFAUT, "c", 1), "a");
    assert.equal(voisin(file, PORTEE_DEFAUT, "e", -1), null, "déjà au début");
    assert.equal(voisin(file, PORTEE_DEFAUT, null, 1), "e");
  });
});

describe("accueil et en-tête", () => {
  it("queueSummary lit l'index entier, sans portée", () => {
    const q = queueSummary(file);
    assert.equal(q.pending, 4);
    assert.equal(q.hab, 3);
    assert.equal(q.nonhab, 1);
    assert.equal(q.signale, 1);
    assert.equal(q.horsSujet, 1);
    assert.equal(q.ready, 1);
    assert.equal(q.scored, 2);
    assert.deepEqual(q.missing, { longueur: 0, ranking: 0, source: 0, illustration: 1, seo: 1 });
  });
  it("kpis de l'en-tête", () => {
    assert.deepEqual(kpisEntete(file, "2026-10-14"), { drafts: 3, pending: 4, signaled: 1, publishedToday: 1 });
  });
  it("départements proposés et filtre par défaut", () => {
    assert.deepEqual(departementsDeLaFile(file), ["16", "17"]);
    assert.equal(deptParDefaut(file, "17", "hab"), "17");
    assert.equal(deptParDefaut(file, "33", "hab"), null, "absent de la file : pas posé");
    assert.equal(deptParDefaut(file, "17", "nonhab"), null);
  });
});
describe("rail repliable par jour de génération", () => {
  const jours = [
    L({ id: "j1", createdAt: "2026-10-15T08:00:00Z" }),
    L({ id: "j2", createdAt: "2026-10-14T22:30:00Z" }),           // 15 oct. à Paris (UTC+2)
    L({ id: "j3", createdAt: "2026-10-14T21:30:00Z", status: "publie" }),
    L({ id: "j4", createdAt: "2026-10-13T10:00:00Z" }),
    L({ id: "j5" }),                                                // ni createdAt ni updatedAt
    L({ id: "j6", updatedAt: "2026-10-12T10:00:00Z" }),            // ligne ancienne : updatedAt
  ];
  it("jourDeGeneration : jour à l'heure de Paris, updatedAt à défaut, inconnu sinon", () => {
    assert.equal(jourDeGeneration(jours[1]), "2026-10-15");
    assert.equal(jourDeGeneration(jours[2]), "2026-10-14");
    assert.equal(jourDeGeneration(jours[5]), "2026-10-12");
    assert.equal(jourDeGeneration(jours[4]), JOUR_INCONNU);
    assert.equal(jourDeGeneration(L({ createdAt: "pas une date" })), JOUR_INCONNU);
  });
  it("groupesParJour : du plus récent au plus ancien, ordre de la file gardé, inconnu en dernier", () => {
    const g = groupesParJour(filteredIndex(jours, PORTEE_DEFAUT));
    assert.deepEqual(g.map((x) => [x.jour, x.articles.map((a) => a.id)]), [
      ["2026-10-15", ["j1", "j2"]], ["2026-10-14", ["j3"]], ["2026-10-13", ["j4"]], ["2026-10-12", ["j6"]], [JOUR_INCONNU, ["j5"]],
    ]);
    assert.match(g[0].libelle, /^15 oct.? 2026$/);
    assert.equal(g[4].libelle, "Date inconnue");
    assert.deepEqual(groupesParJour([]), []);
  });
  it("les filtres s'appliquent dans les groupes", () => {
    const g = groupesParJour(filteredIndex([...jours, L({ id: "z", createdAt: "2026-10-15T09:00:00Z", zoneClass: "nonhab" })], PORTEE_DEFAUT));
    assert.deepEqual(g[0].articles.map((a) => a.id), ["j1", "j2"]);
  });
  it("jourOuvert : le plus récent ouvert par défaut, le choix de l'utilisateur prime", () => {
    const g = groupesParJour(jours);
    assert.equal(jourOuvert("2026-10-15", g, undefined), true);
    assert.equal(jourOuvert("2026-10-14", g, {}), false);
    assert.equal(jourOuvert("2026-10-15", g, { "2026-10-15": false }), false);
    assert.equal(jourOuvert("2026-10-14", g, { "2026-10-14": true }), true);
    assert.equal(jourOuvert("2026-10-15", [], undefined), false);
  });
  it("choixJours : ajoute le choix et ne garde que les jours les plus récents", () => {
    assert.deepEqual(choixJours(undefined, "2026-10-14", true), { "2026-10-14": true });
    assert.deepEqual(choixJours({ "2026-10-14": true }, "2026-10-14", false), { "2026-10-14": false });
    assert.deepEqual(choixJours({ "2026-10-13": true, "2026-10-12": false }, "2026-10-15", true, 2), { "2026-10-15": true, "2026-10-13": true });
  });
});
