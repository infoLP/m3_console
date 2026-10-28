/* M3-108 — /api/health par niveau de détail : contrat du HEALTHCHECK (200/503
   et `ok`), rien d'autre que { ok, etat, ref, at } sans session, mesures pour
   un connecté, configuration en oui/non pour l'administrateur et jamais une
   valeur de variable d'environnement. Schéma à la M2 (T25) : la console ne lit
   plus de dossier migrations/, elle compare le schéma à sa liste ATTENDUS et
   répond 503 avec les migrations du moteur à jouer. Vrai gestionnaire ; base
   et journal simulés par `mock.module` : `npm test` saute ce fichier,
   `npm run test:wiring` le lance. */

import test, { mock } from "node:test";
import assert from "node:assert/strict";

if (typeof mock.module !== "function") {
  test("santé du service", { skip: "lancer `npm run test:wiring` (option --experimental-test-module-mocks)" }, () => {});
} else {
  const root = new URL("../../src/", import.meta.url);
  const { ATTENDUS, MIGRATION_MINIMALE } = await import(new URL("diagnostiquerService/sante.regles.js", root).href);

  /* `absents` : éléments attendus que le schéma n'a pas ; `derniere` : la
     dernière ligne de schema_migrations (null : table vide ou absente). */
  let base = {};
  const reset = (s = {}) => { base = { enPanne: false, absents: [], derniere: MIGRATION_MINIMALE, ...s }; erreurs.length = 0; };
  const q = async (sql) => {
    if (base.enPanne) throw new Error("connect ECONNREFUSED postgresql://m3:FuiteMotDePasse@db:5432/m3");
    /* Avant « SELECT 1 » : la requête du schéma en contient un (NOT EXISTS). */
    if (/unnest/.test(sql)) return { rows: base.absents.map((nom) => ({ nom })) };
    if (/SELECT 1/.test(sql)) return { rows: [{ "?column?": 1 }] };
    if (/to_regclass\('schema_migrations'\)/.test(sql)) return { rows: [{ t: base.derniere === null ? null : "schema_migrations" }] };
    if (/FROM schema_migrations/.test(sql)) return { rows: [{ v: base.derniere }] };
    if (/FROM jobs/.test(sql)) return { rows: [{ attente: null, traite: new Date() }] };
    return { rows: [] };
  };
  mock.module(new URL("lib/db.js", root).href, {
    namedExports: { query: q, withTransaction: async (fn) => fn({ query: q }), closePool: async () => {}, getPool: () => ({}) },
  });
  const erreurs = [];
  mock.module(new URL("lib/log.js", root).href, {
    namedExports: {
      log: { info() {}, warn() {}, error(portee, message, champs) { erreurs.push({ portee, message, champs }); } },
      addLogSink() {}, cleanFields: (x) => x, loginCourt: (x) => x,
    },
  });

  const { sante } = await import(new URL("diagnostiquerService/sante.js", root).href);
  const appel = async (ctx = {}) => {
    let out; let statut;
    await sante({ user: null, role: null, ...ctx, res: { writeHead(s) { statut = s; }, end(b) { out = { brut: b, json: JSON.parse(b) }; } } });
    return { statut, ...out };
  };
  const connecte = { user: { id: 1, login: "camille" }, role: "relecteur" };

  test("sans session : exactement { ok, etat, ref, at }, 200 si la base répond", async () => {
    reset();
    const r = await appel();
    assert.equal(r.statut, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ["at", "etat", "ok", "ref"]);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.etat, "ok");
    assert.match(r.json.ref, /^S-\d{8}-\d{6}-[A-Z2-9]{4}$/);
    assert.equal(erreurs.length, 0, "service sain : aucune ligne d'erreur");
  });

  test("base en panne : 503, ok false, dégradé, log.error porte la référence ; aucune exception", async () => {
    reset({ enPanne: true });
    const r = await appel();
    assert.equal(r.statut, 503);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.etat, "degrade");
    assert.deepEqual(Object.keys(r.json).sort(), ["at", "etat", "ok", "ref"]);
    assert.equal(erreurs.length, 1);
    assert.equal(erreurs[0].portee, "sante");
    assert.equal(erreurs[0].message, "service dégradé");
    assert.equal(erreurs[0].champs.ref, r.json.ref, "la référence affichée mène à la ligne de journal");
    assert.ok(!r.brut.includes("ECONNREFUSED"), "le message d'erreur ne part que vers le journal");
  });

  test("base en panne, connecté : base.ok false, le reste à null", async () => {
    reset({ enPanne: true });
    const r = await appel(connecte);
    assert.equal(r.statut, 503);
    assert.deepEqual(r.json.base, { ok: false, latenceMs: null });
    assert.equal(r.json.migrations, null);
    assert.equal(r.json.tables, null);
    assert.equal(r.json.config, undefined);
  });

  test("connecté : base, migrations et schéma, pas de configuration", async () => {
    reset();
    const r = await appel(connecte);
    assert.equal(r.statut, 200);
    assert.equal(r.json.base.ok, true);
    assert.equal(typeof r.json.base.latenceMs, "number");
    assert.deepEqual(r.json.migrations, { minimale: MIGRATION_MINIMALE, derniere: MIGRATION_MINIMALE, aJouer: [] });
    assert.deepEqual(r.json.tables.map((t) => t.nom), ATTENDUS.map((a) => a.nom));
    assert.ok(r.json.tables.every((t) => t.ok));
    assert.equal("config" in r.json, false);
  });

  test("administrateur : configuration en oui/non, aucune valeur de variable d'environnement", async () => {
    reset();
    const avant = { DATABASE_URL: process.env.DATABASE_URL, M3_SCHEDULER: process.env.M3_SCHEDULER, CONSOLE_CONNEXION_LOCALE: process.env.CONSOLE_CONNEXION_LOCALE };
    process.env.DATABASE_URL = "postgresql://m3_admin:TresSecret-42@pg.interne:5432/m3prod";
    process.env.M3_SCHEDULER = "off";
    process.env.CONSOLE_CONNEXION_LOCALE = "true";
    try {
      const r = await appel({ user: { id: 2, login: "alex" }, role: "administrateur" });
      assert.deepEqual(r.json.config, { baseConfiguree: true, planificateurCoupe: true, connexionMotDePasse: "oui", worker: "actif" });
      for (const fuite of ["TresSecret-42", "m3_admin", "pg.interne", "m3prod", "postgresql://"]) {
        assert.ok(!r.brut.includes(fuite), `« ${fuite} » ne doit pas apparaître`);
      }
    } finally {
      for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  test("administrateur : la connexion par mot de passe affichée est l'état effectif, verrou compris", async () => {
    /* Le booléen faux sans Entra configuré ne ferme rien (verrou localEnabled) :
       afficher « non » ferait croire le mot de passe retiré. */
    const ENTRA = {
      M3_ENTRA_TENANT_ID: "tenant", M3_ENTRA_CLIENT_ID: "client",
      M3_ENTRA_CLIENT_SECRET: "secret", M3_PUBLIC_URL: "https://m3.example.test",
    };
    const cles = ["M3_AUTH_MODE", "CONSOLE_CONNEXION_LOCALE", ...Object.keys(ENTRA)];
    const avant = Object.fromEntries(cles.map((k) => [k, process.env[k]]));
    const vu = async (env) => {
      for (const k of cles) delete process.env[k];
      Object.assign(process.env, env);
      reset();
      return (await appel({ user: { id: 2, login: "alex" }, role: "administrateur" })).json.config.connexionMotDePasse;
    };
    try {
      assert.equal(await vu({ CONSOLE_CONNEXION_LOCALE: "false" }), "oui (verrou : Entra non configuré)");
      assert.equal(await vu({ CONSOLE_CONNEXION_LOCALE: "false", ...ENTRA }), "non");
      assert.equal(await vu({ CONSOLE_CONNEXION_LOCALE: "true", ...ENTRA }), "oui");
      assert.equal(await vu({}), "oui");
    } finally {
      for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  test("moteur en retard : 503, dégradé, la migration minimale est à jouer", async () => {
    reset({ derniere: "021_competitor_candidates.sql" });
    const r = await appel(connecte);
    assert.equal(r.statut, 503);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.etat, "degrade");
    assert.deepEqual(r.json.migrations.aJouer, [MIGRATION_MINIMALE]);
    assert.equal(erreurs.length, 1);
    assert.equal(erreurs[0].champs.ref, r.json.ref);
    assert.equal(erreurs[0].champs.migrationsAJouer, MIGRATION_MINIMALE);
  });

  test("élément absent : 503, l'élément et sa migration sont nommés", async () => {
    reset({ absents: ["jobs.dedup_key", "ip_bans"] });
    const r = await appel(connecte);
    assert.equal(r.statut, 503);
    assert.equal(r.json.etat, "degrade");
    assert.deepEqual(r.json.tables.filter((t) => !t.ok).map((t) => t.nom).sort(), ["ip_bans", "jobs.dedup_key"]);
    assert.deepEqual(r.json.migrations.aJouer, ["016_ip_bans.sql", "023_jobs_voies.sql"]);
  });

  test("base neuve (moteur jamais démarré) : 503, tout est à jouer ; sans session, rien de plus que l'état", async () => {
    reset({ absents: ATTENDUS.map((a) => a.nom), derniere: null });
    const r = await appel(connecte);
    assert.equal(r.statut, 503);
    assert.equal(r.json.migrations.derniere, null);
    assert.equal(r.json.migrations.aJouer[0], "001_init.sql");
    assert.equal(r.json.migrations.aJouer.at(-1), MIGRATION_MINIMALE);
    const anonyme = await appel();
    assert.equal(anonyme.statut, 503);
    assert.deepEqual(Object.keys(anonyme.json).sort(), ["at", "etat", "ok", "ref"]);
  });
}
