/* Journal consultable au back-office (M3-81) — table `journal`, migration 013.

   TROIS SOURCES, pour ne pas semer des appels partout :
   1. le journal fichier (log.js), relayé par addLogSink : connexions, refus,
      SSO, erreurs serveur et navigateur, chaînes planifiées — tout ce qui y
      était déjà écrit arrive ici sans toucher aux appels existants ;
   2. les « runs » et certaines notifications, relayés par store.pushCollection
      (récolte, génération, purge, recalcul, décisions, plafond atteint…) ;
   3. des appels explicites à journal() pour les actions d'administration
      (paramètres, sources, utilisateurs, moteurs LLM, notifications).

   QUI A AGI. L'auteur est lu dans le contexte de la requête en cours
   (requestContext, posé par server.js autour de chaque appel d'API) : un appel
   à journal() n'a pas à le transmettre. Hors requête — chaîne planifiée —
   l'auteur reste vide, et c'est vrai : personne n'a cliqué.

   SANS CONSÉQUENCE. Une écriture qui échoue est perdue, jamais propagée : le
   journal observe le service, il ne doit pas pouvoir le casser. Elle n'est pas
   non plus renvoyée vers log.js, qui la relaierait ici — une boucle.

   QUAND IL ÉCRIT. Dans le worker, dès startJournal(). Dans le processus web
   (Next.js), pendant une requête — c'est-à-dire dans requestContext, que le pont
   pose autour de chaque handler. Depuis le passage à Next.js, plus personne
   n'appelait startJournal() côté web : tout journal() du web était muet, les
   actions de la console comme celles du back-office (M3-96). Se fier au
   contexte plutôt qu'à un appel au démarrage évite aussi de dépendre de
   l'instance du module qu'aurait initialisée instrumentation.ts. Troisième cas :
   un auteur passé explicitement (journalConsole, appelé par une action serveur
   après le handler, donc hors contexte). Les outils en ligne de commande (npm
   run harvest, rescore…) n'ont rien de tout cela : ils n'écrivent pas dans la
   table.

   RÉTENTION : 90 jours, purge au démarrage puis chaque jour. Le journal porte
   des noms de personnes ; la durée est bornée à dessein. */

import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "./db.js";
import { addLogSink, cleanFields } from "./log.js";

export const requestContext = new AsyncLocalStorage();
export const JOURNAL_CATEGORIES = ["connexion", "action", "erreur", "chaine"];
export const JOURNAL_RETENTION_DAYS = 90;

let enabled = false;
let warned = false;

/* Un détail trop gros (pile d'erreur, statistiques de run) est tronqué : le
   journal sert à retrouver, le fichier de logs/ garde le reste. */
function trim(detail) {
  if (detail == null) return null;
  const s = JSON.stringify(cleanFields(detail));
  return s.length > 4000 ? JSON.stringify({ tronque: s.slice(0, 4000) }) : s;
}

export function journal(category, event, { level = "info", detail = null, target = null, actor = undefined } = {}) {
  const store = requestContext.getStore();
  if ((!enabled && !store && actor === undefined) || !JOURNAL_CATEGORIES.includes(category)) return;
  const ctx = store || {};
  const who = actor !== undefined ? actor : ctx.user ? { ...ctx.user, role: ctx.role || ctx.user.role } : null;
  /* Rendue (R7, M3-100) : un appelant en ligne de commande qui ferme le pool
     juste après doit pouvoir attendre l'INSERT. Ne rejette jamais. */
  return query(
    `INSERT INTO journal (category, level, event, actor_id, actor_name, actor_role, target, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [category, level, String(event).slice(0, 200), who?.id || null, who?.name || null, who?.role || null,
     target == null ? null : String(target).slice(0, 200), trim(detail)],
  ).catch((e) => {
    if (warned) return;
    warned = true; // une fois : une base injoignable ne doit pas inonder la console
    console.error(`✗ journal en base indisponible (${e.code || e.message}) — les fichiers de logs/ restent complets`);
  });
}

/* Journal fichier → table. Portées retenues et leur catégorie ; le reste (http,
   boot…) n'y va pas : une ligne par requête noierait l'onglet. */
const SCOPES = { auth: "connexion", client: "erreur", api: "erreur", db: "erreur", schedule: "chaine" };
const LEVELS = { INFO: "info", WARN: "warn", ERROR: "error" };
const SKIP = new Set([
  "auth:sso départ", // redirection vers Entra : la connexion qui suit est journalisée
  /* Écrits par journalCompte(), avec le nom et l'identifiant COMPLET : le relais du
     fichier n'aurait que l'identifiant tronqué, et en double. */
  "auth:connexion", "auth:connexion sso", "auth:déconnexion", "auth:sso rattachement initial",
  "auth:mot de passe changé", "auth:mot de passe attribué par l'administrateur",
]);

/* Connexions d'un compte CONNU, vues par l'administrateur (seul à lire le
   journal) : qui (nom, rôle) et avec quel identifiant, en entier. Le fichier de
   logs/ garde l'identifiant tronqué (loginCourt) : il est lu hors de l'appli et
   conservé sans borne. Les refus, eux, restent tronqués : l'identifiant saisi
   peut ne correspondre à aucun compte — voire être un mot de passe tapé dans le
   mauvais champ. `user` absent : l'auteur est celui de la requête (un
   administrateur qui attribue un mot de passe), le compte visé va en cible. */
export function journalCompte(event, compte, { user, detail = null, level = "info" } = {}) {
  journal("connexion", event, {
    level, detail,
    target: compte?.login || null,
    ...(user ? { actor: { id: user.id, name: user.name || user.login, role: user.role } } : {}),
  });
}

/* Actions faites dans la console (M3-96) : décisions, parution, régénération,
   édition. Catégorie « action », comme celles du back-office ; `detail.origine`
   les distingue (filtre « Origine » de l'onglet Journal).

   `article` est l'article, ou le Resultat d'une action serveur ({ ok, data }) :
   un échec (refus 409, droit manquant…) n'est pas une action faite, rien n'est
   écrit. La valeur reçue est rendue telle quelle, pour que l'action serveur
   puisse écrire `return journalConsole(…, await tenter(…), …)` en une ligne.

   `user` : l'action serveur appelle journalConsole APRÈS le handler, donc hors
   du contexte de requête — elle passe la personne. Absent, on retombe sur le
   contexte (appel depuis un handler, cf. journalRun).

   L'édition s'enregistre toute seule pendant la frappe : une ligne par saisie
   noierait l'onglet (c'est pourquoi M3-81 l'avait écartée). Elle est donc
   journalisée une fois par personne et par article sur EDITION_FENETRE_MS, avec
   les champs touchés. */
export const EDITION_FENETRE_MS = 15 * 60 * 1000;
const derniereEdition = new Map();

/**
 * @template T
 * @param {string} event
 * @param {T} article
 * @param {{ user?: { id?: string, name?: string, login?: string, role?: string } | null, detail?: Record<string, unknown> | null, level?: string, now?: number }} [options]
 * @returns {T}
 */
export function journalConsole(event, article, { user = null, detail = null, level = "info", now = Date.now() } = {}) {
  /** @type {any} */
  let a = article;
  if (a && typeof a === "object" && typeof a.ok === "boolean") {
    if (!a.ok) return article;
    a = a.data?.article || a.data;
  }
  const id = a?.id || null;
  if (event === "édition" && id) {
    const cle = `${user?.id || requestContext.getStore()?.user?.id || "?"}|${id}`;
    const avant = derniereEdition.get(cle);
    if (avant && now - avant < EDITION_FENETRE_MS) return article;
    derniereEdition.set(cle, now);
    if (derniereEdition.size > 2000) for (const [k, t] of derniereEdition) if (now - t >= EDITION_FENETRE_MS) derniereEdition.delete(k);
  }
  journal("action", event, {
    level,
    target: a?.title || id,
    detail: { origine: "console", article: id, ...(detail || {}) },
    ...(user ? { actor: { id: user.id, name: user.name || user.login, role: user.role } } : {}),
  });
  return article;
}

function fromLog(niveau, portee, message, champs) {
  const category = SCOPES[portee];
  if (!category || SKIP.has(`${portee}:${message}`)) return;
  const { pile, ...rest } = champs || {};
  /* Une connexion arrive AVANT la session : pas d'auteur dans le contexte. Le
     compte visé (identifiant tronqué, cf. loginCourt) sert alors de cible. */
  journal(category, message, { level: LEVELS[niveau] || "info", target: rest.login || rest.compte || null, detail: Object.keys(rest).length ? rest : null });
}

/* Runs (store.pushCollection("runs")) : ce qui a été décidé, lancé ou recalculé.
   Un changement de statut vient de la console (setStatus) : il est nommé par le
   statut visé et passe par journalConsole, l'auteur étant celui de la requête. */
const STATUS_EVENTS = {
  valide: "validation",
  signale: "signalement",
  archive: "archivage",
  publie: "parution",
  a_revoir: "remise en relecture",
  brouillon: "retour en brouillon",
};
const RUN_EVENTS = {
  purge: ["action", "purge des articles"],
  rescore: ["action", "recalcul des scores"],
  generation: ["chaine", "génération"],
  harvest: ["chaine", "récolte"],
  schedule: ["chaine", "chaîne planifiée"],
};
export function journalRun(run) {
  const s = run?.stats || {};
  if (run?.kind === "status") {
    journalConsole(STATUS_EVENTS[s.status] || "changement de statut", { id: s.article || null }, { detail: { statut: s.status, role: s.role } });
    return;
  }
  const [category, event] = RUN_EVENTS[run?.kind] || ["chaine", `run ${run?.kind || "?"}`];
  journal(category, event, { target: s.article || null, detail: s });
}

/* Notifications qui disent qu'une chaîne a buté : copiées au journal. */
const NOTIF_EVENTS = {
  llm_plafond: "plafond de dépense LLM atteint",
  llm_degraded: "LLM indisponible, repli sur le mock",
  llm_secours: "moteur principal en échec, bascule sur le moteur de secours",
  llm_modele_ko: "modèle choisi en échec au test du catalogue",
  llm_hallucination: "hallucination persistante après relances, article signalé",
  parution_bloquee: "parution programmée bloquée",
  source_ecartee: "source mise à l'écart",
  source_furtif: "source lue par le crawler furtif (liste blanche)",
  source_muette: "source muette (cinq récoltes vides d'affilée)",
  chaine_echec: "chaîne planifiée en échec",
};
export function journalNotification(n) {
  const event = NOTIF_EVENTS[n?.type];
  if (!event) return;
  journal("chaine", event, { level: n.severity === "error" ? "error" : "warn", target: n.sourceName || n.articleTitle || null, detail: { detail: n.detail, url: n.url } });
}

/* M3-102 : un passage de l'archivage automatique qui a archivé quelque chose.
   Catégorie « chaine », comme la récolte et la génération : c'est un traitement
   du worker, sans auteur — le filtre « Origine » des actions ne le concerne pas.
   Les identifiants sont bornés : un premier passage sur un gros stock en
   archiverait des centaines. */
export const ARCHIVAGE_AUTO_IDS_MAX = 50;
export function journalArchivageAuto(ids, hours) {
  if (!ids?.length) return;
  journal("chaine", "archivage automatique", {
    target: `${ids.length} article${ids.length > 1 ? "s" : ""}`,
    detail: { origine: "systeme", n: ids.length, heures: hours, articles: ids.slice(0, ARCHIVAGE_AUTO_IDS_MAX) },
    actor: null,
  });
}

export async function purgeJournal() {
  const { rowCount } = await query(`DELETE FROM journal WHERE at < now() - make_interval(days => $1)`, [JOURNAL_RETENTION_DAYS]);
  return rowCount;
}

/* Relais du journal fichier, posé au chargement du module : le web n'appelle
   pas startJournal(), et journal() filtre de toute façon hors requête et hors
   worker. */
addLogSink(fromLog);

/* Appelé une fois par le worker (src/worker.js) : active l'écriture hors requête
   et la purge quotidienne. */
export function startJournal() {
  if (enabled) return;
  enabled = true;
  const purge = () => purgeJournal().catch(() => { /* table absente ou base injoignable : réessayé demain */ });
  purge();
  setInterval(purge, 24 * 3600 * 1000).unref();
}

/* Lecture pour l'onglet Journal : filtres, pagination par curseur (at, id). */
export const JOURNAL_ORIGINES = ["console", "backoffice"];
export async function readJournal({ category, level, origine, q, since, until, limit = 100, cursor } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 100), 500);
  /* Conditions construites deux fois : les compteurs par catégorie appliquent
     tous les filtres SAUF la catégorie (comme les onglets de l'Historique), et
     retirer une condition après coup décalerait la numérotation des $n. */
  const build = (withCategory) => {
    const where = [];
    const params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
    if (withCategory && JOURNAL_CATEGORIES.includes(category)) add("category = ?", category);
    if (["info", "warn", "error"].includes(level)) add("level = ?", level);
    /* Origine (M3-96) : la console marque ses actions ; le reste des actions vient
       du back-office. Hors catégorie « action », une origine ne veut rien dire. */
    if (origine === "console") add("detail->>'origine' = ?", "console");
    else if (origine === "backoffice") add("(category = 'action' AND detail->>'origine' IS DISTINCT FROM ?)", "console");
    if (q) add("(event ILIKE ? OR actor_name ILIKE ? OR target ILIKE ? OR detail::text ILIKE ?)", `%${String(q).replace(/[\\%_]/g, "\\$&")}%`);
    if (since) add("at >= ?::timestamptz", since);
    if (until) add("at < ?::timestamptz", until);
    return { where, params };
  };
  const c = build(false);
  const counts = await query(
    `SELECT category, count(*)::int AS n FROM journal ${c.where.length ? "WHERE " + c.where.join(" AND ") : ""} GROUP BY category`,
    c.params,
  );
  const { where, params } = build(true);
  if (cursor) {
    const i = String(cursor).lastIndexOf("|");
    if (i > 0) {
      params.push(cursor.slice(0, i), cursor.slice(i + 1));
      where.push(`(at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
    }
  }
  params.push(lim + 1);
  const { rows } = await query(
    `SELECT id::text, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, category, level, event,
            actor_name AS "actorName", actor_role AS "actorRole", target, detail
       FROM journal ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const more = rows.length > lim;
  const items = more ? rows.slice(0, lim) : rows;
  return {
    items,
    counts: { ...Object.fromEntries(JOURNAL_CATEGORIES.map((c) => [c, 0])), ...Object.fromEntries(counts.rows.map((r) => [r.category, r.n])) },
    nextCursor: more ? `${items[items.length - 1].at}|${items[items.length - 1].id}` : null,
    retentionDays: JOURNAL_RETENTION_DAYS,
  };
}
