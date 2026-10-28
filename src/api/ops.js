import { send } from "../lib/http.js";
import { readCollection, readJson, dataPath } from "../lib/store.js";
import { query } from "../lib/db.js";
import { enqueue, lastJobs } from "../lib/demandes.js";
import { readSettings } from "../lib/yamlStore.js";
import { parseTimes, upcomingSlot } from "../../shared/slots.js";
import { KV_PLANIFICATION } from "../../shared/contrat.js";
import { coutRoutinesOuvert, masquerCouts } from "../consulterCoutRoutines/coutRoutines.calcul.js";

/* Depuis la phase 1 de la migration Next.js, le serveur web n'exécute plus la
   récolte : il dépose une demande (table `jobs`) que le worker prend sous le
   bail « chain », partagé avec la chaîne planifiée (M3-58). La réponse est un
   202 avec la demande ; le front suit son état par GET /api/runs. Une récolte
   lancée à la main interroge toutes les sources, sans tenir compte de leur
   intervalle ; les sources à l'écart restent sautées. */
export async function harvest({ res, body, user }) {
  const job = await enqueue("harvest", { limit: Number(body.limit) || 0, only: body.only || null }, user);
  send(res, 202, { ok: true, job });
}

/* État lisible de la planification, pour l'onglet Dernier run (T24) : les
   réglages et les créneaux viennent de la console (shared/slots.js), l'état
   d'exécution (dernier créneau, en cours, dernier résultat) de la kv que
   l'ordonnanceur du moteur écrit. Même forme que l'ancien scheduleStatus du
   moteur, que la console importait. */
export async function scheduleStatus(now = Date.now()) {
  const settings = await readSettings();
  const state = (await readJson(KV_PLANIFICATION, {})) || {};
  const parsed = parseTimes(settings.schedule_times);
  const actif = settings.schedule_enabled === "oui";
  return {
    enabled: actif,
    times: parsed.times || [],
    error: parsed.error || null,
    next: actif && parsed.times ? upcomingSlot(parsed.times, now) : null,
    lastSlot: state.lastSlot || null,
    running: state.running || null,
    lastRun: state.lastRun || null,
    lastSkipped: state.lastSkipped || null,
  };
}

export async function lastRun({ res, role }) {
  const runs = await readCollection("runs");
  const harvestFile = await readJson(dataPath("harvest", "latest.json"));
  /* M3-105 : les montants en dollars suivent la FEAT « Coût des routines ».
     Sous son seuil, ils ne partent pas (tokens et compteurs restent). */
  const voitCouts = coutRoutinesOuvert(role, await readSettings());
  const body = {
    runs: runs.slice(0, 30),
    harvest: harvestFile ? { date: harvestFile.date, stats: harvestFile.stats, sources: harvestFile.sources, skipped: harvestFile.skipped || [] } : null,
    schedule: await scheduleStatus(),
    /* Les demandes au worker : ce que le front sonde après un clic, et ce que
       l'onglet Dernier run affiche. Une demande qui reste « en attente » dit
       que le worker ne tourne pas — c'est l'information la plus utile ici. */
    jobs: await lastJobs(10),
  };
  send(res, 200, voitCouts ? body : masquerCouts(body));
}

export async function publications({ res }) {
  const pubs = await readCollection("publications");
  const now = Date.now();
  send(res, 200, {
    publications: pubs,
    scheduled: pubs.filter((p) => p.scheduledAt && !p.publishedAt && new Date(p.scheduledAt).getTime() > now),
  });
}

const PENDING = "('a_revoir','signale','brouillon')";
const DONE = "('valide','publie','archive')";
const ACCEPTED = "('valide','publie')";

/* Date de décision (003_decision_trace.sql). Avant elle, les séries « acceptés /
   publiés / archivés » étaient ventilées par `updated_at` : un article publié
   lundi puis corrigé jeudi était recompté jeudi, et disparaissait de lundi. Le
   repli sur updated_at ne concerne plus que les lignes reprises par la migration,
   pour lesquelles c'est exactement ce que faisait l'ancien calcul. */
const DECIDED_AT = "coalesce(decided_at, updated_at)";
/* Articles purgés (M3-79) : conservés pour l'Historique, mais sortis du travail.
   Ils ne comptent dans aucune statistique — leur « décision » de purge n'est pas
   une décision éditoriale, et l'auteur de la purge n'a relu aucun d'eux. */
const LIVE = "status <> 'purge'";

/* Statistiques pour l'onglet Suivi.

   Entièrement en agrégats SQL. La version fichier chargeait TOUS les articles via
   readIndex() et comptait en JavaScript ; readIndex() étant désormais paginé, ce
   calcul serait devenu silencieusement faux — il n'aurait plus porté que sur la
   première page. C'est le piège principal de la bascule côté API.

   Le découpage en journées reste en UTC, comme le faisait la version précédente
   (String(a.createdAt).slice(0, 10) sur une date ISO terminée par Z). Basculer sur
   Europe/Paris décalerait les compteurs d'articles créés en soirée : c'est une
   décision à prendre à part, pas un effet de bord de la migration. */
export async function stats({ res, query: params }) {
  const range = params.range || "semaine";
  const days = range === "jour" ? 1 : range === "mois" ? 30 : 7;

  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = dayKey(Date.now());
  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = dayKey(Date.now() - i * 86400 * 1000);
    buckets[d] = { date: d, created: 0, accepted: 0, archived: 0, published: 0 };
  }
  /* Borne basse des requêtes de série : le plus ancien seau, à 00:00 UTC. Sans
     elle, la montée en volume ferait scanner toute la table pour sept jours. */
  const oldest = Object.keys(buckets).sort()[0] + "T00:00:00Z";

  const [totals, byStatus, byCategory, created, updated, byUser, untracked, pace] = await Promise.all([
    query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status IN ${PENDING})::int AS pending,
              count(*) FILTER (WHERE status IN ${DONE}
                AND to_char(${DECIDED_AT} AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $1)::int AS done_today
         FROM articles WHERE ${LIVE}`, [today]),
    query(`SELECT status, count(*)::int AS n FROM articles WHERE ${LIVE} GROUP BY status`),
    query(`SELECT cat, count(*)::int AS n FROM articles WHERE cat IS NOT NULL AND ${LIVE} GROUP BY cat`),
    query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS n
         FROM articles WHERE created_at >= $1::timestamptz AND ${LIVE} GROUP BY 1`, [oldest]),
    query(
      `SELECT to_char(${DECIDED_AT} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
              count(*) FILTER (WHERE status IN ${ACCEPTED})::int AS accepted,
              count(*) FILTER (WHERE status = 'publie')::int  AS published,
              count(*) FILTER (WHERE status = 'archive')::int AS archived
         FROM articles
        WHERE status IN ${DONE} AND ${DECIDED_AT} >= $1::timestamptz GROUP BY 1`, [oldest]),
    query(
      `SELECT decided_by AS reviewer,
              count(*) FILTER (WHERE status IN ${ACCEPTED})::int AS accepted,
              count(*) FILTER (WHERE status = 'archive')::int  AS archived
         FROM articles WHERE decided_by IS NOT NULL AND ${LIVE} GROUP BY decided_by`),
    query(
      `SELECT count(*)::int AS n FROM articles
        WHERE status IN ${DONE} AND decided_by IS NULL`),
    /* Rythme réel : médiane de l'écart entre deux décisions CONSÉCUTIVES d'une
       même personne. Tout écart de plus de 30 minutes est une pause (déjeuner,
       réunion, lendemain) et non du travail : l'inclure ferait dire « 14 h par
       article » à une file traitée en deux fois. Le seuil coupe donc les séances.
       Rien à voir avec le champ `reading`, qui est une vitesse de LECTURE
       théorique (signes / signs_per_minute) et ignore vérifications et
       corrections. Les deux sont montrés séparément sur l'accueil, et nommés
       pour ce qu'ils sont.
       Tant qu'aucune décision n'a été prise, median rend NULL : l'écran affiche
       « pas encore mesurable » plutôt qu'un chiffre inventé. */
    query(
      `WITH d AS (
         SELECT decided_by, ${DECIDED_AT} AS t FROM articles
          WHERE status IN ${DONE} AND decided_by IS NOT NULL
            AND ${DECIDED_AT} >= now() - interval '30 days'
       ), g AS (
         SELECT extract(epoch FROM (t - lag(t) OVER (PARTITION BY decided_by ORDER BY t))) / 60 AS m
           FROM d
       )
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY m) AS median,
              count(*)::int AS n
         FROM g WHERE m IS NOT NULL AND m > 0 AND m <= 30`),
  ]);

  for (const r of created.rows) if (buckets[r.d]) buckets[r.d].created = r.n;
  for (const r of updated.rows) {
    if (!buckets[r.d]) continue;
    buckets[r.d].accepted = r.accepted;
    buckets[r.d].published = r.published;
    buckets[r.d].archived = r.archived;
  }

  send(res, 200, {
    range,
    toProduce: totals.rows[0].pending,
    doneToday: totals.rows[0].done_today,
    total: totals.rows[0].total,
    byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
    byCategory: Object.fromEntries(byCategory.rows.map((r) => [r.cat, r.n])),
    series: Object.values(buckets).sort((x, y) => x.date.localeCompare(y.date)),
    /* Par PERSONNE depuis le 2026-09-16, et non plus par rôle : ce bloc agrégeait
       `reviewer`, qui recevait le libellé du rôle envoyé par la console. Les
       décisions antérieures n'ont pas d'auteur — elles sont comptées à part
       plutôt qu'attribuées à quelqu'un au jugé. */
    byUser: byUser.rows.map((r) => ({ reviewer: r.reviewer, accepted: r.accepted, archived: r.archived })),
    untrackedDecisions: untracked.rows[0].n,
    pace: {
      medianMinutes: pace.rows[0].median == null ? null : Math.round(Number(pace.rows[0].median) * 10) / 10,
      sample: pace.rows[0].n,
    },
  });
}
