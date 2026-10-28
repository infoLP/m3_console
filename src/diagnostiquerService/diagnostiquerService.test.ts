import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENDUS, ATTENTE_WORKER_MS, FORME_REF, MIGRATION_MINIMALE, SONDE_INITIALE,
  apresSonde, calculerEtat, migrationsAJouer, etatWorker, fabriquerRef, filtrerParNiveau, lignesDetail, messageSonde, niveauDe,
} from "./sante.regles.js";

const tablesOk = () => ATTENDUS.map((a) => ({ nom: a.nom, ok: true }));
const sain = () => ({ base: { ok: true, latenceMs: 3 }, migrations: { minimale: MIGRATION_MINIMALE, derniere: MIGRATION_MINIMALE, aJouer: [] }, tables: tablesOk() });
const rapport = () => ({
  ok: true, etat: "ok", ref: "S-20261015-143205-K7QM", at: "2026-10-15T14:32:05.000Z", ...sain(),
  config: { baseConfiguree: true, planificateurCoupe: false, connexionMotDePasse: "oui", worker: "actif" },
  secret: "ne doit partir vers personne",
});

describe("santé du service (M3-108)", () => {
  it("référence : forme S-AAAAMMJJ-HHMMSS-XXXX, horodatage UTC", () => {
    const ref = fabriquerRef(new Date("2026-10-15T14:32:05Z"), () => 0);
    assert.equal(ref, "S-20261015-143205-AAAA");
    assert.match(ref, FORME_REF);
    assert.match(fabriquerRef(new Date("2026-01-02T03:04:05Z"), () => 0.9999), FORME_REF);
  });

  it("référence : le suffixe varie d'un appel à l'autre et évite 0, O, 1, I, L", () => {
    const refs = new Set(Array.from({ length: 50 }, () => fabriquerRef()));
    assert.ok(refs.size > 40);
    for (const r of refs) assert.match(r, FORME_REF);
  });

  it("état : ok seulement si base, migrations et schéma sont bons", () => {
    assert.equal(calculerEtat(sain()), "ok");
    assert.equal(calculerEtat({ ...sain(), base: { ok: false, latenceMs: null } }), "degrade");
    assert.equal(calculerEtat({ ...sain(), migrations: { ...sain().migrations, aJouer: ["023_jobs_voies.sql"] } }), "degrade");
    assert.equal(calculerEtat({ ...sain(), tables: [...tablesOk().slice(1), { nom: "articles", ok: false }] }), "degrade");
  });

  it("schéma à la M2 : chaque élément attendu nomme une migration du moteur, sans doublon", () => {
    const noms = ATTENDUS.map((a) => a.nom);
    assert.equal(new Set(noms).size, noms.length);
    for (const a of ATTENDUS) assert.match(a.migration, /^\d{3}_[a-z0-9_]+\.(sql|mjs)$/, a.nom);
    /* La minimale couvre toutes celles que la liste nomme : sinon une console
       à jour de schéma réclamerait quand même une migration. */
    for (const a of ATTENDUS) assert.ok(a.migration <= MIGRATION_MINIMALE, a.migration);
    for (const a of ATTENDUS.filter((x) => x.nom.includes("."))) {
      assert.ok(ATTENDUS.some((t) => t.nom === a.nom.split(".")[0]), `table de ${a.nom} attendue`);
    }
  });

  it("migrations à jouer : celles des éléments absents, triées, et la minimale si la base est en retard", () => {
    assert.deepEqual(migrationsAJouer([], MIGRATION_MINIMALE), []);
    assert.deepEqual(migrationsAJouer([], "024_plus_recente.sql"), []);
    assert.deepEqual(migrationsAJouer(["jobs.dedup_key", "ip_bans", "ip_failures"], "015_model_tests.sql"),
      ["016_ip_bans.sql", "023_jobs_voies.sql"]);
    assert.deepEqual(migrationsAJouer([], "021_competitor_candidates.sql"), [MIGRATION_MINIMALE]);
    /* Base neuve : rien d'inscrit, tout est à jouer. */
    assert.equal(migrationsAJouer(ATTENDUS.map((a) => a.nom), null)[0], "001_init.sql");
    /* Dernière migration illisible : on ne réclame que ce que le schéma montre. */
    assert.deepEqual(migrationsAJouer([], undefined), []);
  });

  it("état : une mesure non faite (null) compte comme un manque", () => {
    assert.equal(calculerEtat({ ...sain(), migrations: null }), "degrade");
    assert.equal(calculerEtat({ ...sain(), tables: null }), "degrade");
    assert.equal(calculerEtat({}), "degrade");
  });

  it("niveau : public sans session, administrateur selon le rôle transmis", () => {
    assert.equal(niveauDe(null, "administrateur"), "public");
    assert.equal(niveauDe({ id: 1 }, "relecteur"), "connecte");
    assert.equal(niveauDe({ id: 1 }, "administrateur"), "administrateur");
  });

  it("filtrage : sans session, exactement ok, etat, ref, at", () => {
    assert.deepEqual(Object.keys(filtrerParNiveau(rapport(), "public")).sort(), ["at", "etat", "ok", "ref"]);
  });

  it("filtrage : connecté → mesures sans configuration ; administrateur → avec", () => {
    const c = filtrerParNiveau(rapport(), "connecte");
    assert.deepEqual(Object.keys(c).sort(), ["at", "base", "etat", "migrations", "ok", "ref", "tables"]);
    const a = filtrerParNiveau(rapport(), "administrateur");
    assert.deepEqual(Object.keys(a).sort(), ["at", "base", "config", "etat", "migrations", "ok", "ref", "tables"]);
    assert.ok(!JSON.stringify(a).includes("ne doit partir"), "liste blanche : un champ inconnu ne part pas");
  });

  it("filtrage : base en panne, un connecté voit base.ok false et le reste à null", () => {
    const c = filtrerParNiveau({ ok: false, etat: "degrade", ref: "r", at: "t", base: { ok: false, latenceMs: null }, migrations: null, tables: null }, "connecte");
    assert.deepEqual(c.base, { ok: false, latenceMs: null });
    assert.equal(c.migrations, null);
    assert.equal(c.tables, null);
  });

  it("worker : attente de plus de 5 min → en attente ; traité récemment → actif ; sinon inconnu", () => {
    const t = Date.parse("2026-10-15T12:00:00Z");
    assert.equal(etatWorker({ plusAncienneAttente: new Date(t - ATTENTE_WORKER_MS - 1000) }, t), "en attente");
    assert.equal(etatWorker({ plusAncienneAttente: new Date(t - 60_000), dernierTraitement: new Date(t - 3_600_000) }, t), "actif");
    assert.equal(etatWorker({ dernierTraitement: new Date(t - 3 * 86_400_000) }, t), "inconnu");
    assert.equal(etatWorker({}, t), "inconnu");
  });
});

describe("sonde des pages d'erreur (M3-108)", () => {
  const suite = (sondes: boolean[], depart = SONDE_INITIALE) => {
    let etat = depart;
    return sondes.map((s) => { const r = apresSonde(etat, s); etat = r.etat; return r.relancer; });
  };

  it("retour à ok après une panne : une relance, une seule", () => {
    assert.deepEqual(suite([false, false, true, true, true]), [false, false, true, false, false]);
  });

  it("chaque retour à ok après une nouvelle panne relance de nouveau", () => {
    assert.deepEqual(suite([false, true, false, true]), [false, true, false, true]);
  });

  it("service sain dès la première sonde : l'erreur vient d'ailleurs, une relance", () => {
    assert.deepEqual(suite([true, true, true]), [true, false, false]);
  });

  it("erreur déjà relancée sur un premier ok : pas de nouvelle relance (pas de boucle)", () => {
    assert.deepEqual(suite([true, true], { ...SONDE_INITIALE, dejaRelancee: true }), [false, false]);
    assert.deepEqual(suite([false, true], { ...SONDE_INITIALE, dejaRelancee: true }), [false, true], "un vrai retour après panne relance quand même");
  });

  it("textes de la sonde", () => {
    assert.match(messageSonde(null, false).texte, /Vérification/);
    assert.equal(messageSonde(false, false).texte, "Service dégradé, nouvelle vérification dans 5 s");
    assert.equal(messageSonde({ ok: false, etat: "degrade" }, false).ton, "avertissement");
    assert.equal(messageSonde({ ok: true, etat: "ok" }, true).texte, "Service rétabli, rechargement…");
    assert.match(messageSonde({ ok: true, etat: "ok" }, false).texte, /répond normalement/);
    assert.match(messageSonde({ ok: true, etat: "degrade" }, false).texte, /partiellement/);
  });

  it("détail : rien sans `base`, liste lisible sinon, config pour l'administrateur", () => {
    assert.deepEqual(lignesDetail({ ok: true, etat: "ok", ref: "r", at: "t" }), []);
    assert.deepEqual(lignesDetail(null), []);
    const l = lignesDetail({
      base: { ok: true, latenceMs: 4 },
      migrations: { minimale: "023_jobs_voies.sql", derniere: "016_ip_bans.sql", aJouer: ["017_llm_prompts.sql", "023_jobs_voies.sql"] },
      tables: [{ nom: "articles", ok: true }, { nom: "jobs", ok: false }],
      config: { baseConfiguree: true, planificateurCoupe: false, connexionMotDePasse: "oui", worker: "en attente" },
    });
    assert.deepEqual(l, [
      "Base : joignable (4 ms)",
      "Migrations du moteur à jouer : 017_llm_prompts.sql, 023_jobs_voies.sql",
      "Schéma, éléments absents : jobs",
      "Base configurée : oui",
      "Planificateur coupé : non",
      "Connexion par mot de passe : oui",
      "Worker : en attente",
    ]);
    assert.deepEqual(lignesDetail({ base: { ok: false, latenceMs: null }, migrations: null, tables: null }), ["Base : injoignable"]);
  });
});
