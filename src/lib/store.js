/* Persistance PostgreSQL de l'état runtime.

   Les signatures exportées sont celles de la version fichier : les 11 modules
   appelants n'ont pas changé (seul readIndex() gagne des paramètres, cf. plus bas).

   Deux familles de stockage :
   - `kv_documents` (clé → JSON) pour le harvest et les collections cappées ;
   - la table `articles`, avec ses colonnes générées, pour ce qui se filtre et se trie. */

import { query, withTransaction } from "./db.js";
import { wordsOf, readingOf } from "../../shared/scoring.js";
import { zoneClassOf } from "../../shared/model.js";
import { journalRun, journalNotification } from "./journal.js";
import { ROOT } from "./racine.js";
import { routineCourante, surFinRoutine } from "./routineCanal.js";

/* ROOT reste exporté d'ici (legacy/server.js, xlsxImport.js, migrate.js…) ;
   il est calculé dans racine.js — voir pourquoi là-bas. */
export { ROOT };

/* Construit une clé de document. Remplace le chemin de fichier d'avant sans que
   les appelants changent : dataPath("harvest", "latest.json") → "harvest/latest.json". */
export function dataPath(...parts) {
  return parts.join("/");
}

const UPSERT_KV = `INSERT INTO kv_documents (key, value) VALUES ($1, $2::jsonb)
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

export async function readJson(key, fallback = null) {
  const { rows } = await query("SELECT value FROM kv_documents WHERE key = $1", [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function writeJson(key, value) {
  await query(UPSERT_KV, [key, JSON.stringify(value)]);
  return key;
}

/* Collections génériques : notifications, runs, tickets, publications. */
const collectionKey = (name) => dataPath("collections", `${name}.json`);

export async function readCollection(name, fallback = []) {
  return (await readJson(collectionKey(name), fallback)) ?? fallback;
}

/* Remplacement complet : l'upsert est atomique à lui seul, pas de verrou utile.
   Attention : un appelant qui lit puis réécrit (meta.js resolveTicket) fait un
   lire-modifier-écrire sur DEUX appels — aucun verrou interne ne peut le protéger. */
export async function writeCollection(name, arr) {
  return writeJson(collectionKey(name), arr);
}

/* Retire les éléments que `keep` refuse, sous le même verrou de ligne que
   pushCollection : une notification poussée par la récolte pendant la purge
   (M3-80) ne doit pas être effacée par la réécriture. → nombre retiré. */
export async function filterCollection(name, keep) {
  const key = collectionKey(name);
  let removed = 0;
  await withTransaction(async (c) => {
    const { rows } = await c.query("SELECT value FROM kv_documents WHERE key = $1 FOR UPDATE", [key]);
    const arr = Array.isArray(rows[0]?.value) ? rows[0].value : [];
    const kept = arr.filter(keep);
    removed = arr.length - kept.length;
    if (removed) await c.query(UPSERT_KV, [key, JSON.stringify(kept)]);
  });
  return removed;
}

/* Ajoute un élément en tête. Lire → unshift → réécrire sous verrou de ligne
   (arbitrage B1) : sans cela, le cron `daily` et le back-office qui poussent en
   même temps perdent silencieusement une entrée. */
/* Lire → transformer → réécrire un document sous verrou de ligne, comme
   pushCollection (M3-57, T6) : deux récoltes qui se chevauchent mettent à jour
   l'état de leurs sources sans effacer celui de l'autre. `fn` reçoit la valeur
   courante (ou `fallback`) et rend la nouvelle ; elle tourne sous le verrou,
   donc elle reste courte et sans I/O. → la nouvelle valeur. */
export async function updateJson(key, fn, fallback = null) {
  return withTransaction(async (c) => {
    /* Ligne créée d'abord : sur un document absent, FOR UPDATE ne verrouillerait rien. */
    await c.query("INSERT INTO kv_documents (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING", [key, JSON.stringify(fallback)]);
    const { rows } = await c.query("SELECT value FROM kv_documents WHERE key = $1 FOR UPDATE", [key]);
    const next = fn(rows[0]?.value ?? fallback);
    await c.query(UPSERT_KV, [key, JSON.stringify(next)]);
    return next;
  });
}

export async function pushCollection(name, item, cap = 500) {
  const key = collectionKey(name);
  /* M3-105 : un run écrit pendant une routine (bail « chain ») porte son
     identifiant, et la routine le garde pour en faire le résumé à sa sortie. */
  const rt = name === "runs" ? routineCourante() : null;
  if (rt) { item = { ...item, routine: rt.id }; rt.runs.push(item); }
  await withTransaction(async (c) => {
    /* La ligne doit exister pour que FOR UPDATE ait quelque chose à verrouiller :
       sur une collection encore vide, deux pushs concurrents s'écraseraient. */
    await c.query("INSERT INTO kv_documents (key, value) VALUES ($1, '[]'::jsonb) ON CONFLICT (key) DO NOTHING", [key]);
    const { rows } = await c.query("SELECT value FROM kv_documents WHERE key = $1 FOR UPDATE", [key]);
    const arr = Array.isArray(rows[0]?.value) ? rows[0].value : [];
    arr.unshift(item);
    await c.query(UPSERT_KV, [key, JSON.stringify(arr.slice(0, cap))]);
  });
  /* Copie au journal (M3-81), une fois l'écriture validée : runs et notifications
     d'échec de chaîne. Sans effet hors serveur (journal non démarré). */
  if (name === "runs") journalRun(item);
  else if (name === "notifications") journalNotification(item);
  return item;
}

/* M3-105 — résumés des routines, les plus récents en tête. Collection à part :
   « runs » reçoit aussi un run par changement de statut et, plafonnée à 500, ne
   tient pas un mois de routines. 300 en tiennent plusieurs à quelques routines
   par jour. */
export const ROUTINES_CAP = 300;
surFinRoutine((resume) => pushCollection("routines", resume, ROUTINES_CAP));
export const readRoutines = () => readCollection("routines");

/* ------------------------------------------------------------------ articles */

export async function readArticle(id) {
  const { rows } = await query("SELECT doc FROM articles WHERE id = $1", [id]);
  return rows.length ? rows[0].doc : null;
}

/* `touch: false` conserve updatedAt tel quel. Réservé aux reprises de stock
   (recalcul de score, migration de format) : y toucher daterait 73 articles du
   jour de la migration et fausserait les séries du Suivi, qui s'en servent. */
export async function writeArticle(article, { touch = true } = {}) {
  if (touch || !article.updatedAt) article.updatedAt = new Date().toISOString();
  /* A1 : ces trois valeurs étaient calculées par rebuildIndex(), qui n'existe plus.
     Sans ce calcul ici, la console perd le nombre de signes et le temps de lecture
     sans qu'aucune erreur ne soit remontée. */
  const signs = wordsOf(article);
  const reading = readingOf(article);
  const zoneClass = article.zoneClass || zoneClassOf(article.zone);
  /* Même raison que created_at/updated_at : le cast text -> timestamptz n'étant
     pas immutable, la date de décision ne peut pas être une colonne générée.
     C'est donc ici, et nulle part ailleurs, qu'elle suit le document. */
  const decidedAt = article.decision?.at || null;
  await query(
    `INSERT INTO articles (id, doc, created_at, updated_at, signs, reading, zone_class, decided_at)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       doc = EXCLUDED.doc, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
       signs = EXCLUDED.signs, reading = EXCLUDED.reading, zone_class = EXCLUDED.zone_class,
       decided_at = EXCLUDED.decided_at`,
    [article.id, JSON.stringify(article), article.createdAt || article.updatedAt,
     article.updatedAt, signs, reading, zoneClass, decidedAt]
  );
  return article;
}

export async function listArticleIds() {
  const { rows } = await query("SELECT id FROM articles ORDER BY id");
  return rows.map((r) => r.id);
}

/* Purge les articles générés. `config/` et le harvest ne sont pas touchés.
   Si `rearmHarvest`, le dernier harvest est remis à `processed:false` pour qu'une
   nouvelle génération le retraite intégralement.

   Depuis M3-79, le back-office ne SUPPRIME plus : chaque article encore vivant
   passe au statut `purge`, avec une décision datée et attribuée (`by`) qui garde
   la précédente. Il sort de la file, des doublons et des statistiques, mais reste
   consultable dans l'Historique. `hard` supprime vraiment — réservé aux outils de
   développement (src/tools/reset.js, seed.js), qui remettent la base à zéro.

   T14 (point du 27/10) : réarmer ne suffit plus à régénérer. Un contenu source
   qui a déjà donné un article est écarté par la génération (generatedItemKeys),
   sauf si l'administrateur a coché « autoriser la régénération » au moment de
   purger : `allowRegen` pose alors `regenAllowed` sur le document (et dans la
   décision, pour la trace), et la fiche de l'article effacé le garde. */
export async function clearArticles({ rearmHarvest = true, hard = false, by = null, allowRegen = false } = {}) {
  const at = new Date().toISOString();
  const { rowCount } = hard
    ? await query("DELETE FROM articles")
    : await query(
      `UPDATE articles
          SET doc = doc || jsonb_build_object(
                'status', 'purge',
                'updatedAt', $1::text,
                'regenAllowed', $7::boolean,
                'decision', jsonb_build_object(
                  'status', 'purge', 'at', $1::text,
                  'byId', $2::text, 'byName', $3::text, 'byLogin', $4::text, 'byRole', $5::text,
                  'regenAllowed', $7::boolean,
                  'previousStatus', doc->>'status',
                  'previous', doc->'decision')),
              decided_at = $6::timestamptz,
              updated_at = $6::timestamptz
        WHERE status <> 'purge'`,
      /* La même date en $1 (texte, dans le document) et $6 (horodatage) : un seul
         paramètre casté vers deux types fait échouer PostgreSQL (« inconsistent
         types deduced for parameter »). */
      [at, by?.id || null, by?.name || null, by?.login || null, by?.role || null, at, allowRegen === true]);

  let rearmed = false;
  let harvestDate = null;
  if (rearmHarvest) {
    const key = dataPath("harvest", "latest.json");
    const h = await readJson(key);
    if (h && Array.isArray(h.items)) {
      h.items.forEach((it) => { it.processed = false; });
      await writeJson(key, h);
      if (h.date) await writeJson(dataPath("harvest", `${h.date}.json`), h);
      rearmed = true;
      harvestDate = h.date || null;
    }
  }
  return { removed: rowCount, rearmed, harvestDate };
}

/* M3-102 — archivage automatique : les articles non traités (brouillon, à revoir,
   signalé) générés il y a plus de `hours` heures passent en `archive`, au nom du
   système. Même trace que clearArticles : la décision garde le statut quitté et
   la précédente, et decided_by (colonne générée) remplit le « Par » de
   l'Historique sans toucher à l'API.

   Idempotent et sûr à plusieurs : un seul UPDATE, et PostgreSQL revérifie le
   WHERE après avoir verrouillé chaque ligne — un article validé entre-temps par
   quelqu'un n'est pas écrasé, et deux passages simultanés ne l'archivent qu'une
   fois. Rend les identifiants archivés. */
export const ARCHIVAGE_AUTO_STATUTS = ["brouillon", "a_revoir", "signale"];
export const ARCHIVAGE_AUTO_PAR = "Archivage automatique";
export async function archiveStale({ hours, now = Date.now() }) {
  const at = new Date(now).toISOString();
  const { rows } = await query(
    `UPDATE articles
        SET doc = doc || jsonb_build_object(
              'status', 'archive',
              'updatedAt', $1::text,
              'decision', jsonb_build_object(
                'status', 'archive', 'at', $1::text,
                'byId', NULL, 'byName', $2::text, 'byLogin', NULL, 'byRole', 'systeme',
                'auto', true, 'afterHours', $3::int,
                'previousStatus', doc->>'status',
                'previous', doc->'decision')),
            decided_at = $4::timestamptz,
            updated_at = $4::timestamptz
      WHERE status = ANY($5::text[])
        AND created_at < $4::timestamptz - make_interval(hours => $3::int)
      RETURNING id`,
    /* Même date en $1 (texte) et $4 (horodatage) : cf. clearArticles. */
    [at, ARCHIVAGE_AUTO_PAR, hours, at, ARCHIVAGE_AUTO_STATUTS]);
  return rows.map((r) => r.id);
}

/* ------------------------------------------------ purge définitive (T14) */

/* Chaîne des décisions d'un article, de la plus ancienne à la plus récente.
   Le document n'en garde que la dernière, qui porte la précédente sous
   `previous` (migration 003, clearArticles, archiveStale) : on la met à plat, avec
   les clés d'origine, sans `previous` ni `previousStatus`. */
export function decisionChain(decision) {
  const out = [];
  for (let d = decision; d && typeof d === "object"; d = d.previous) {
    const { previous: _p, previousStatus: _s, ...rest } = d;
    out.unshift(rest);
  }
  return out;
}

const dateOr = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const lastAt = (chain, status) => chain.filter((d) => d.status === status).at(-1) || null;

/* Fiche minimale d'un article effacé (table article_tombstones, migration 022) :
   de quoi le retrouver par UUID et savoir d'où il venait, qui l'a fait naître,
   publié, archivé, purgé puis effacé — rien de son texte. */
export function tombstoneOf(doc, { erasedAt, erasedBy = "auto" }) {
  const chain = decisionChain(doc.decision);
  const purge = lastAt(chain, "purge");
  return {
    id: doc.id,
    uuid: doc.uuid,
    title: doc.title ?? null,
    cat: doc.cat ?? null,
    mode: doc.mode ?? null,
    source_id: doc.origin?.sourceId ?? null,
    source_label: doc.source?.label ?? null,
    source_kind: doc.source?.kind ?? null,
    source_url: doc.origin?.sourceUrl || doc.source?.url || null,
    item_key: doc.origin?.harvestItemId ?? null,
    harvested_at: dateOr(doc.origin?.harvestedAt),
    generated_at: dateOr(doc.createdAt),
    source_published_at: dateOr(doc.origin?.publishedAt),
    published_at: dateOr(doc.publication?.publishedAt) || dateOr(lastAt(chain, "publie")?.at),
    archived_at: dateOr(lastAt(chain, "archive")?.at),
    purged_at: dateOr(purge?.at),
    purged_by: purge ? purge.byName || purge.byLogin || null : null,
    erased_at: dateOr(erasedAt),
    erased_by: erasedBy,
    generated_by: doc.provider ?? null,
    decisions: chain,
    meta: {
      zone: doc.zone ? { num: doc.zone.num ?? null, dept: doc.zone.dept ?? null, region: doc.zone.region ?? null, commune: doc.zone.commune ?? null } : null,
      ranking: doc.ranking ?? null,
      prompt: doc.checks?.prompt ?? null,
      regenAllowed: doc.regenAllowed === true,
    },
  };
}

const TOMBSTONE_COLUMNS = [
  "id", "uuid", "title", "cat", "mode", "source_id", "source_label", "source_kind", "source_url", "item_key",
  "harvested_at", "generated_at", "source_published_at", "published_at", "archived_at", "purged_at", "purged_by",
  "erased_at", "erased_by", "generated_by", "decisions", "meta",
];
const INSERT_TOMBSTONE = `INSERT INTO article_tombstones (${TOMBSTONE_COLUMNS.join(", ")})
  VALUES (${TOMBSTONE_COLUMNS.map((c, i) => `$${i + 1}${c === "decisions" || c === "meta" ? "::jsonb" : ""}`).join(", ")})
  ON CONFLICT (id) DO NOTHING`;

/* Effacement des articles purgés depuis plus de `days` jours (réglage
   purge_retention_days ; 0 ou absent = jamais). Pour chacun, la fiche est écrite
   PUIS l'article effacé, dans la même transaction : jamais d'article disparu sans
   fiche. Seul le statut `purge` est concerné, et sa date de purge est decided_at
   (écrite par clearArticles). `FOR UPDATE SKIP LOCKED` : deux passages simultanés
   ne prennent pas le même article. Branché chaque jour par l'ordonnanceur
   (src/schedule/scheduler.js). → identifiants effacés. */
export async function eraseExpiredPurges({ days, now = Date.now(), by = "auto" } = {}) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return [];
  const at = new Date(now).toISOString();
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT id, doc FROM articles
        WHERE status = 'purge'
          AND decided_at < $1::timestamptz - make_interval(days => $2::int)
        ORDER BY id
        FOR UPDATE SKIP LOCKED`,
      [at, Math.floor(d)]);
    for (const r of rows) {
      const t = tombstoneOf({ ...r.doc, id: r.id }, { erasedAt: at, erasedBy: by });
      await c.query(INSERT_TOMBSTONE, TOMBSTONE_COLUMNS.map((k) => (k === "decisions" || k === "meta" ? JSON.stringify(t[k]) : t[k])));
    }
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await c.query("DELETE FROM articles WHERE id = ANY($1::text[]) AND status = 'purge'", [ids]);
    return ids;
  });
}

/* Article par UUID : vivant (quel que soit son statut), sinon la fiche de
   l'article effacé, sinon null. */
export async function lookupByUuid(uuid) {
  const u = String(uuid || "").trim();
  if (!u) return null;
  const a = await query("SELECT doc FROM articles WHERE uuid = $1", [u]);
  if (a.rows.length) return { kind: "article", article: a.rows[0].doc };
  const t = await query("SELECT * FROM article_tombstones WHERE uuid = $1", [u]);
  return t.rows.length ? { kind: "fiche", fiche: t.rows[0] } : null;
}

/* Anti-régénération (T14) : parmi `keys` (identifiants des contenus récoltés,
   = origin.harvestItemId des articles), ceux qui ont déjà donné un article —
   vivant, purgé ou effacé (fiche) — sans que la régénération ait été autorisée
   à la purge. → Set. */
export async function generatedItemKeys(keys) {
  const list = [...new Set((keys || []).filter(Boolean).map(String))];
  if (!list.length) return new Set();
  const { rows } = await query(
    `SELECT item_key FROM articles
      WHERE item_key = ANY($1::text[]) AND coalesce(doc->>'regenAllowed', 'false') <> 'true'
     UNION
     SELECT item_key FROM article_tombstones
      WHERE item_key = ANY($1::text[]) AND coalesce(meta->>'regenAllowed', 'false') <> 'true'`,
    [list]);
  return new Set(rows.map((r) => r.item_key));
}

/* Efface tout l'état runtime : articles, harvest, collections.
   Seul point d'entrée pour une remise à zéro complète (src/tools/reset.js). */
export async function clearAllData() {
  await withTransaction(async (c) => {
    await c.query("DELETE FROM articles");
    await c.query("DELETE FROM article_tombstones");
    await c.query("DELETE FROM kv_documents");
  });
}

/* -------------------------------------------------------------------- index */

/* Les 20 champs que projetait rebuildIndex(). 11 viennent de colonnes générées
   (donc impossibles à désynchroniser du document), 3 de colonnes calculées en JS,
   et zone/scores/flags sont lus directement dans le document. */
const INDEX_COLUMNS = `
  id, uuid, title, cat,
  doc->'zone'                                      AS zone,
  zone_class                                       AS "zoneClass",
  status,
  jsonb_path_query_array(doc, '$.flags[*].type')   AS flags,
  mode,
  doc->'scores'                                    AS scores,
  reviewer, ranking, signs, reading,
  has_illustration                                 AS "hasIllustration",
  coalesce(source_label, '')                       AS "sourceLabel",
  coalesce(source_kind,  '')                       AS "sourceKind",
  coalesce(source_id,    '')                       AS "sourceId",
  doc->>'createdAt'                                AS "createdAt",
  doc->>'updatedAt'                                AS "updatedAt",
  doc->'origin'->>'harvestedAt'                    AS "harvestedAt",
  doc->'origin'->>'publishedAt'                    AS "sourcePublishedAt",
  doc->'checks'->'review'->>'verdict'              AS "reviewVerdict"`;

export const INDEX_LIMIT_DEFAULT = 100;
export const INDEX_LIMIT_MAX = 500;

/* Assemble les conditions optionnelles et le tableau de paramètres en parallèle.
   Les valeurs passent toujours par $n — jamais par concaténation. */
function buildFilters({ status, zone, source, since }) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
  /* Les articles purgés (M3-79) ne sont plus dans la file : l'Historique seul les montre. */
  if (status) add("status = ?", status);
  else where.push("status <> 'purge'");
  if (zone) add("zone_class = ?", zone);
  if (source) add("coalesce(source_label, '') = ?", source);
  if (since) add("updated_at > ?::timestamptz", since);
  return { where, params };
}

/* Curseur de pagination : le couple (updated_at, id) de la dernière ligne rendue.
   Préféré à OFFSET, qui fait lire puis jeter N lignes et dont la fenêtre se décale
   dès qu'une écriture concurrente survient — un relecteur verrait alors deux fois
   le même article, ou en sauterait un. */
const encodeCursor = (row) => `${row.updatedAt}|${row.id}`;

function decodeCursor(cursor) {
  const i = String(cursor).lastIndexOf("|");
  if (i < 1) return null;
  return { updatedAt: cursor.slice(0, i), id: cursor.slice(i + 1) };
}

/* Retourne l'enveloppe { generated_at, articles, total, nextCursor }.
   Sans `limit`, la valeur par défaut s'applique : cette fonction ne renvoie
   JAMAIS toute la table (cf. section « Volume » du plan de migration). */
export async function readIndex(opts = {}) {
  const limit = Math.min(Math.max(1, Number(opts.limit) || INDEX_LIMIT_DEFAULT), INDEX_LIMIT_MAX);
  const { where, params } = buildFilters(opts);

  const totalSql = `SELECT count(*)::int AS n, max(updated_at) AS max_updated
    FROM articles${where.length ? " WHERE " + where.join(" AND ") : ""}`;
  const totalPromise = query(totalSql, params);

  const rowWhere = [...where];
  const rowParams = [...params];
  const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cur) {
    rowParams.push(cur.updatedAt, cur.id);
    rowWhere.push(`(updated_at, id) < ($${rowParams.length - 1}::timestamptz, $${rowParams.length})`);
  }
  rowParams.push(limit + 1); // +1 : sert uniquement à savoir s'il reste une page
  const rowsSql = `SELECT ${INDEX_COLUMNS}
    FROM articles${rowWhere.length ? " WHERE " + rowWhere.join(" AND ") : ""}
    ORDER BY updated_at DESC, id DESC
    LIMIT $${rowParams.length}`;

  const [{ rows: totalRows }, { rows }] = await Promise.all([totalPromise, query(rowsSql, rowParams)]);

  const hasMore = rows.length > limit;
  const articles = hasMore ? rows.slice(0, limit) : rows;
  /* generated_at est une VERSION d’état, pas l’heure de la réponse : la console
     s’en sert pour détecter un changement lors de son sondage périodique. Le
     renseigner avec new Date() la ferait recharger toutes les 30 secondes. Une
     suppression ne fait pas bouger ce maximum, d’où la comparaison côté console
     sur `total` également. */
  const maxUpdated = totalRows[0].max_updated;
  return {
    generated_at: maxUpdated ? new Date(maxUpdated).toISOString() : null,
    articles,
    total: totalRows[0].n,
    nextCursor: hasMore ? encodeCursor(articles[articles.length - 1]) : null,
  };
}

/* ---------------------------------------------------------------- historique */

/* Les trois catégories de l'onglet Historique :
   - `publie`  — paru ;
   - `archive` — le rejet : il n'existe pas de statut « refusé » distinct
                 (cf. STATUSES dans shared/model.js), « classer sans diffusion »
                 EST le refus ;
   - `valide`  — envoyé en parution avec une date planifiée, en attente. Rien ne
                 le fera passer en `publie` le jour dit (il n'y a pas
                 d'ordonnanceur) : sans cette catégorie, il resterait invisible.

   - `purge`   — retiré par « Purger les articles » (M3-79) : conservé, daté et
                 attribué, sa décision précédente gardée sous `decision.previous`.

   Toute modification ici doit être reportée dans la clause WHERE de l'index
   partiel `articles_history_idx` (migrations 004 puis 012), faute de quoi le tri
   perd son index en silence. */
export const HISTORY_STATUSES = ["publie", "archive", "valide", "purge"];
export const HISTORY_LIMIT_DEFAULT = 50;

/* La date de décision affichée est `decided_at` seule : une ligne qui n'en a pas
   affiche « — » plutôt qu'une approximation muette. Le TRI, lui, se rabat sur
   updated_at (même expression que l'index articles_history_idx), sans quoi une
   telle ligne sortirait de la pagination par curseur. */
const HISTORY_SORT_KEY = "coalesce(decided_at, updated_at)";
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/* `sortAt` n'est pas affiché : il ne sert qu'à fabriquer le curseur de page.
   L'URL de publication n'est pas projetée — elle est simulée (`wp_target/slug`),
   l'exposer donnerait un lien qui ne mène nulle part. */
const HISTORY_COLUMNS = `
  id, uuid, title, cat, status,
  doc->'zone'                                         AS zone,
  coalesce(source_label, '')                          AS "sourceLabel",
  coalesce(source_kind,  '')                          AS "sourceKind",
  doc->>'createdAt'                                   AS "createdAt",
  to_char(decided_at AT TIME ZONE 'UTC', ${ISO})      AS "decidedAt",
  to_char(${HISTORY_SORT_KEY} AT TIME ZONE 'UTC', ${ISO}) AS "sortAt",
  decided_by                                          AS "decidedBy",
  decided_by_id                                       AS "decidedById",
  decided_by_role                                     AS "decidedByRole",
  decision_legacy                                     AS legacy,
  doc#>>'{publication,scheduledAt}'                   AS "scheduledAt",
  doc#>>'{origin,harvestedAt}'                        AS "harvestedAt",
  doc#>>'{decision,previousStatus}'                   AS "purgedFrom"`;

/* `%` et `_` saisis dans la recherche sont échappés : sans cela, un utilisateur
   qui tape « 100 % » obtient toutes les lignes sans comprendre pourquoi. */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, "\\$&");

const encodeHistoryCursor = (row) => `${row.sortAt}|${row.id}`;

/* Ligne d'Historique tirée de la fiche d'un article effacé (T14) : mêmes champs
   qu'une ligne d'article, statut « efface », la décision affichée est
   l'effacement ; le reste de la fiche suit sous `fiche`, en consultation seule. */
const isoOf = (v) => (v ? new Date(v).toISOString() : null);
export function historyRowOfTombstone(t) {
  return {
    id: t.id, uuid: t.uuid, title: t.title, cat: t.cat, status: "efface",
    zone: t.meta?.zone ?? null,
    sourceLabel: t.source_label || "", sourceKind: t.source_kind || "",
    createdAt: isoOf(t.generated_at),
    decidedAt: isoOf(t.erased_at),
    sortAt: isoOf(t.erased_at),
    decidedBy: t.erased_by === "auto" ? "Effacement automatique" : t.erased_by,
    decidedById: null,
    decidedByRole: t.erased_by === "auto" ? "systeme" : null,
    legacy: false,
    scheduledAt: null,
    harvestedAt: isoOf(t.harvested_at),
    purgedFrom: null,
    fiche: {
      sourceUrl: t.source_url, itemKey: t.item_key,
      sourcePublishedAt: isoOf(t.source_published_at), publishedAt: isoOf(t.published_at),
      archivedAt: isoOf(t.archived_at), purgedAt: isoOf(t.purged_at), purgedBy: t.purged_by,
      erasedAt: isoOf(t.erased_at), erasedBy: t.erased_by, generatedBy: t.generated_by,
      decisions: Array.isArray(t.decisions) ? t.decisions : [],
      regenAllowed: t.meta?.regenAllowed === true,
    },
  };
}

/* Recherche par UUID (T14) : l'article, quel que soit son statut, ou la fiche de
   l'article effacé. Un purgé ou un effacé suit la FEAT des purgés (M3-97) : sans
   le droit, rien n'est rendu, comme dans la liste. */
async function historyByUuid(uuid, statuses, withPurged) {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0]));
  const none = { items: [], total: 0, counts, nextCursor: null };
  const { rows } = await query(`SELECT ${HISTORY_COLUMNS} FROM articles WHERE uuid = $1`, [uuid]);
  if (rows.length) {
    if (rows[0].status === "purge" && !withPurged) return none;
    return { ...none, items: rows, total: 1 };
  }
  if (!withPurged) return none;
  const t = await query("SELECT * FROM article_tombstones WHERE uuid = $1", [uuid]);
  return t.rows.length ? { ...none, items: [historyRowOfTombstone(t.rows[0])], total: 1 } : none;
}

export async function readHistory({ category, q, limit, cursor, withPurged = true, uuid } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || HISTORY_LIMIT_DEFAULT), INDEX_LIMIT_MAX);
  /* M3-97 : sans le droit de voir les purgés, ils sortent de la requête même —
     lignes, total et compteurs —, et la catégorie « purge » demandée vaut « Tout ». */
  const statuses = withPurged ? HISTORY_STATUSES : HISTORY_STATUSES.filter((s) => s !== "purge");
  const u = String(uuid || "").trim();
  if (u) return historyByUuid(u, statuses, withPurged);

  /* Base commune aux lignes ET aux compteurs : la recherche s'applique aux deux,
     la catégorie seulement aux lignes — comme les facettes de la console, un
     compteur n'applique jamais son propre filtre, sinon les onglets affichent
     toujours leur propre total et ne servent plus à comparer. */
  const base = [`status = ANY($1)`];
  const baseParams = [statuses];
  if (q) {
    baseParams.push(`%${escapeLike(q)}%`);
    base.push(`title ILIKE $${baseParams.length}`);
  }

  const countsSql = `SELECT status, count(*)::int AS n FROM articles
                      WHERE ${base.join(" AND ")} GROUP BY status`;

  const where = [...base];
  const params = [...baseParams];
  if (statuses.includes(category)) {
    params.push(category);
    where.push(`status = $${params.length}`);
  }

  const totalSql = `SELECT count(*)::int AS n FROM articles WHERE ${where.join(" AND ")}`;
  const totalParams = [...params];

  const cur = cursor ? decodeCursor(cursor) : null;
  if (cur) {
    params.push(cur.updatedAt, cur.id);
    where.push(`(${HISTORY_SORT_KEY}, id) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }
  params.push(lim + 1); // +1 : sert uniquement à savoir s'il reste une page
  const rowsSql = `SELECT ${HISTORY_COLUMNS}
    FROM articles WHERE ${where.join(" AND ")}
    ORDER BY ${HISTORY_SORT_KEY} DESC, id DESC
    LIMIT $${params.length}`;

  const [counts, total, rows] = await Promise.all([
    query(countsSql, baseParams),
    query(totalSql, totalParams),
    query(rowsSql, params),
  ]);

  const hasMore = rows.rows.length > lim;
  const items = hasMore ? rows.rows.slice(0, lim) : rows.rows;
  return {
    items,
    total: total.rows[0].n,
    /* Les trois clés sont toujours présentes, à zéro le cas échéant : les onglets
       de l'écran afficheraient « undefined » sur une catégorie encore vide. */
    counts: {
      ...Object.fromEntries(statuses.map((s) => [s, 0])),
      ...Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    },
    nextCursor: hasMore ? encodeHistoryCursor(items[items.length - 1]) : null,
  };
}
