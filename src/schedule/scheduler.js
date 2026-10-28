/* Ordonnanceur interne (M3-58, M3-49, M3-121) — un seul déclencheur, trois consommateurs.

   Toutes les minutes, dans le processus du serveur web :
   1. M3-49 — les articles `valide` dont la parution programmée est passée
      passent en `publie`. La publication restant simulée, c'est un changement
      de statut ; le jour où WordPress sera câblé, c'est lui qui publiera à
      l'heure (`status: "future"`, cf. src/publish/payload.js) et ce passage
      restera la trace côté M3.
   2. M3-58 — si un créneau de `schedule_times` est dû et la planification
      active : récolte planifiée, puis génération. Sous le verrou « chain »
      (src/lib/runLock.js), partagé avec les boutons du back-office.
   3. M3-121 — si un créneau de `competitors_scan_times` est dû et le scan des
      concurrents activé : scan lancé SANS être attendu, sous son propre bail
      « competitors » (voir competitorsDue). Il ne retarde ni le tick ni la chaîne.

   Si la récolte échoue entièrement (exception : base injoignable…), la
   génération n'est pas lancée : générer sur une récolte inconnue reviendrait à
   retraiter la précédente. Un échec de quelques sources, lui, est le cas
   ordinaire : la génération tourne sur ce qui a été récolté.

   Pourquoi dans le serveur et pas dans le cron de l'hôte : il se règle au
   back-office, il voit le verrou des exécutions manuelles, et Docker le
   redémarre avec le serveur (`restart: unless-stopped`). Un créneau manqué
   pendant un arrêt est rattrapé au redémarrage, s'il date de moins de 6 h
   (src/schedule/slots.js). */

import { readSettings } from "../lib/yamlStore.js";
import { readJson, writeJson, readArticle, writeArticle, pushCollection, readCollection, writeCollection, archiveStale, eraseExpiredPurges } from "../lib/store.js";
import { query } from "../lib/db.js";
import { withLock, acquire } from "../lib/runLock.js";
import { journalArchivageAuto } from "../lib/journal.js";
import { marquerRoutinePartielle } from "../lib/routineContext.js";
import { runHarvest } from "../ingest/harvestRun.js";
import { runGeneration } from "../generate/pipeline.js";
import { parseTimes, nextAction, upcomingSlot, scanSettings } from "./slots.js";
import { log } from "../lib/log.js";
import { missingCriteria } from "../../shared/scoring.js";
import { featsFor } from "../../shared/feats.js";

/* « 14/10 à 09:00 », à l'heure de Paris quel que soit le fuseau du conteneur. */
const heureDeParis = (iso) => new Date(iso).toLocaleString("fr-FR", {
  timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
}).replace(" ", " à ");

export const SCHEDULE_KEY = "schedule/state.json";
const TICK_MS = 60000;

let timer = null;
let busy = false;
let current = null;
let scanning = null;

export function startScheduler() {
  if (timer) return;
  const tick = async () => {
    if (busy) return;              // une chaîne longue chevauche plusieurs ticks
    busy = true;
    try { current = runTick(); await current; }
    catch (err) { log.error("schedule", "tick", { erreur: err.message }); }
    finally { busy = false; current = null; }
  };
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  setTimeout(tick, 5000).unref?.(); // premier passage peu après le démarrage
}

/* Plus de nouveau tick, et on attend celui en cours : le worker s'arrête sur
   SIGTERM en finissant sa chaîne plutôt qu'en la coupant au milieu. */
export async function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  if (current) await current.catch(() => {});
  if (scanning) await scanning;
}

export async function runTick({ now = Date.now() } = {}) {
  await publishDue(now);

  const settings = await readSettings();
  await archiveDue(settings, now).catch((err) => log.error("schedule", "archivage automatique", { erreur: err.message }));
  await erasePurgesDue(settings, now).catch((err) => log.error("schedule", "effacement des purges expirées", { erreur: err.message }));
  await competitorsDue(settings, now).catch((err) => log.error("schedule", "scan des concurrents", { erreur: err.message }));
  const state = (await readJson(SCHEDULE_KEY, {})) || {};
  if (settings.schedule_enabled !== "oui") {
    /* Désactivée : on oublie le dernier créneau, pour que la réactivation reparte
       de l'heure courante au lieu de rattraper ce qui a été manqué entre-temps. */
    if (state.lastSlot) await writeJson(SCHEDULE_KEY, { ...state, lastSlot: null });
    return { action: "off" };
  }
  const parsed = parseTimes(settings.schedule_times);
  if (parsed.error) return { action: "invalid", error: parsed.error };

  const next = nextAction(parsed.times, state.lastSlot, now);
  if (next.action === "wait") return next;
  if (next.action === "init" || next.action === "skip") {
    await writeJson(SCHEDULE_KEY, { ...state, lastSlot: next.slot, lastSkipped: next.action === "skip" ? next.slot : state.lastSkipped || null });
    if (next.action === "skip") log.warn("schedule", "créneau manqué non rattrapé", { creneau: next.slot });
    return next;
  }

  /* Le créneau est marqué traité AVANT de lancer : si la chaîne plante, on ne la
     relance pas en boucle à chaque minute — elle attendra le créneau suivant. */
  await writeJson(SCHEDULE_KEY, { ...state, lastSlot: next.slot, running: next.slot });
  const outcome = await runChain(next.slot);
  await writeJson(SCHEDULE_KEY, { ...state, lastSlot: next.slot, running: null, lastRun: outcome });
  return { ...next, outcome };
}

/* Récolte puis génération, sous le verrou partagé avec le back-office. */
export async function runChain(slot) {
  const at = new Date().toISOString();
  const outcome = { slot, at, harvest: null, generation: null, error: null };
  try {
    await withLock("chain", `planification ${slot.slice(11)}`, async () => {
      try {
        const h = await runHarvest({ scheduled: true });
        outcome.harvest = h.stats;
      } catch (err) {
        outcome.error = `récolte : ${err.message}`;
        marquerRoutinePartielle(`récolte en échec : ${err.message}`);
        await pushCollection("notifications", {
          id: `n-${Date.now()}-sched`, type: "chaine_echec", severity: "error",
          detail: `Récolte planifiée de ${slot.slice(11)} en échec (${err.message}) : la génération n'a pas été lancée.`,
          at: new Date().toISOString(), read: false,
        });
        return;
      }
      const g = await runGeneration();
      outcome.generation = { created: g.created.length, skipped: g.skipped.length, candidates: g.candidates, provider: g.provider, cap: g.cap || null, pending: g.pending || 0 };
    }, { routine: "planifiee" });
  } catch (err) {
    /* Verrou tenu (une exécution manuelle en cours) ou génération en erreur. */
    outcome.error = outcome.error || err.message;
    await pushCollection("notifications", {
      id: `n-${Date.now()}-sched`, type: "chaine_echec", severity: err.code === "LOCKED" ? "warning" : "error",
      detail: `Chaîne planifiée de ${slot.slice(11)} non exécutée : ${err.message}`,
      at: new Date().toISOString(), read: false,
    });
  }
  await pushCollection("runs", { id: `run-${Date.now()}`, kind: "schedule", at, stats: outcome });
  log.info("schedule", "chaîne", { creneau: slot, erreur: outcome.error || undefined });
  return outcome;
}

/* M3-121 — scan des concurrents planifié. Son état a sa propre clé (le créneau
   de la chaîne n'en dépend pas) et suit les règles de nextAction : activer ne
   lance rien sur-le-champ, un créneau manqué de plus de 6 h n'est pas rattrapé.
   Le créneau est consommé AVANT le lancement, et le scan n'est PAS attendu : une
   chaîne due au même tick part aussitôt, sous son verrou à elle. Un scan déjà en
   cours (bouton, autre processus) : runCompetitorScan rend { skipped: "busy" }.
   Module chargé au premier créneau dû : le crawl (cheerio, rss-parser…) n'entre
   pas dans le graphe d'import de l'ordonnanceur. */
export const COMPETITORS_SCHEDULE_KEY = "schedule/competitors.json";
export async function competitorsDue(settings, now = Date.now()) {
  const { enabled, times } = scanSettings(settings);
  const state = (await readJson(COMPETITORS_SCHEDULE_KEY, {})) || {};
  if (!enabled) {
    if (state.lastSlot) await writeJson(COMPETITORS_SCHEDULE_KEY, { ...state, lastSlot: null });
    return { action: "off" };
  }
  if (times.error) return { action: "invalid", error: times.error };
  const next = nextAction(times.times, state.lastSlot, now);
  if (next.action === "wait") return next;
  await writeJson(COMPETITORS_SCHEDULE_KEY, { ...state, lastSlot: next.slot, lastSkipped: next.action === "skip" ? next.slot : state.lastSkipped || null });
  if (next.action !== "run") return next;
  const run = Promise.resolve()
    .then(() => import("../ingest/competitorScan.js"))
    .then(({ runCompetitorScan }) => runCompetitorScan({ trigger: "planifie", by: null }))
    .then((r) => { if (r?.skipped) log.warn("schedule", "scan des concurrents déjà en cours", { creneau: next.slot }); })
    .catch((err) => log.error("schedule", "scan des concurrents", { creneau: next.slot, erreur: err.message }))
    .finally(() => { if (scanning === run) scanning = null; });
  scanning = run;
  return next;
}

/* M3-102 — archivage automatique, au plus une fois par ARCHIVAGE_AUTO_PERIODE_MS.
   La cadence est tenue par un bail « archivage-auto » pris et JAMAIS relâché :
   il expire seul, et tant qu'il court, aucun worker ne repasse. L'acquire étant
   atomique, deux workers sur la même base ne passent pas ensemble. Le worker ne
   libère au démarrage que le bail « chain » (clear("chain")) : celui-ci survit à
   un redémarrage, qui ne déclenche donc pas de passage en plus. Fermé (réglage
   absent ou « non ») : ni bail, ni requête. */
export const ARCHIVAGE_AUTO_PERIODE_MS = 55 * 60000;
export async function archiveDue(settings, now = Date.now()) {
  if (settings?.feat_archivage_auto !== "oui") return null;
  const hours = Number(settings.archivage_auto_heures) || 24;
  const token = await acquire("archivage-auto", { ttlMs: ARCHIVAGE_AUTO_PERIODE_MS, owner: "archivage automatique" });
  if (!token) return null;
  const ids = await archiveStale({ hours, now });
  journalArchivageAuto(ids, hours);
  if (ids.length) log.info("schedule", "archivage automatique", { n: ids.length, heures: hours });
  return ids;
}

/* T15 — effacement des articles purgés depuis plus de `purge_retention_days`
   jours (eraseExpiredPurges, src/lib/store.js : fiche écrite puis article effacé).
   Au plus une fois par jour, sur le modèle d'archiveDue : un bail « purges-expirees »
   de 24 h pris et JAMAIS relâché tient la cadence, entre ticks comme entre
   processus (l'acquire est atomique). Réglage à 0 ou absent : ni bail, ni requête.
   Un passage en erreur garde son bail : nouvel essai le lendemain, l'erreur est au
   journal (portée « schedule » → catégorie « chaine »). */
export const PURGES_EXPIREES_PERIODE_MS = 24 * 3600000;
export async function erasePurgesDue(settings, now = Date.now()) {
  const days = Number(settings?.purge_retention_days) || 0;
  if (days <= 0) return null;
  const token = await acquire("purges-expirees", { ttlMs: PURGES_EXPIREES_PERIODE_MS, owner: "effacement des purges expirées" });
  if (!token) return null;
  const ids = await eraseExpiredPurges({ days, now });
  if (ids.length) log.info("schedule", "purges expirées effacées", { n: ids.length, jours: days });
  return ids;
}

/* M3-49 : passe en `publie` les articles programmés dont l'heure est venue. */
export async function publishDue(now = Date.now()) {
  const { rows } = await query(
    `SELECT id FROM articles
      WHERE status = 'valide'
        AND doc#>>'{publication,scheduledAt}' IS NOT NULL
        AND (doc#>>'{publication,scheduledAt}')::timestamptz <= $1`,
    [new Date(now).toISOString()]
  );
  if (!rows.length) return 0;
  const settings = await readSettings();
  const done = new Map();
  const blocked = new Map();
  for (const { id } of rows) {
    const a = await readArticle(id);
    if (!a || a.status !== "valide" || !a.publication?.scheduledAt) continue;
    /* M3-72 : un article modifié après sa validation peut avoir perdu un critère.
       À l'heure dite, il ne part pas : il revient dans la file « à revoir », la
       programmation est annulée, et une notification nomme l'article, qui l'avait
       validé et ce qui manque (arbitrage du 2026-10-14). L'illustration suit la
       FEAT du rôle qui a validé — le planificateur ne tourne pour personne. */
    const role = a.decision?.byRole || null;
    const manque = missingCriteria(a, settings, { sansIllustration: !!featsFor(role, settings).sansIllustration });
    if (manque.length) {
      const prevu = a.publication.scheduledAt;
      a.status = "a_revoir";
      a.publication = { ...a.publication, scheduledAt: null, blockedAt: new Date(now).toISOString(), blockedScheduledAt: prevu, missing: manque };
      await writeArticle(a);
      blocked.set(a.id, a.publication.blockedAt);
      const qui = a.decision?.byName || a.decision?.byLogin || "personne d'identifié";
      await pushCollection("notifications", {
        id: `n-${Date.now()}-${a.id}-bloquee`, type: "parution_bloquee", severity: "warning",
        articleId: a.id, articleTitle: a.title || a.id,
        detail: `« ${a.title || a.id} », validé par ${qui}, devait paraître le ${heureDeParis(prevu)} : parution bloquée. Manque : ${manque.join(", ")}. Remis dans la file à revoir.`,
        at: new Date().toISOString(), read: false,
      });
      log.warn("schedule", "parution bloquée", { article: a.id, manque: manque.join(", ") });
      continue;
    }
    a.status = "publie";
    /* La parution est datée de l'heure PROGRAMMÉE, pas de la minute où le tick
       l'a constatée. La décision, elle, garde la date du geste (cf. publish). */
    a.publication = { ...a.publication, publishedAt: a.publication.scheduledAt };
    await writeArticle(a);
    done.set(a.id, a.publication.publishedAt);
  }
  if (done.size || blocked.size) {
    /* Le journal des publications porte aussi la date de parution — ou celle du
       blocage, pour qu'une programmation annulée ne reste pas « en attente ». Lire-modifier-
       écrire en deux appels : une publication manuelle pile à cette seconde
       pourrait être perdue du journal (pas de l'article) — risque accepté,
       cf. la mise en garde de writeCollection. */
    const pubs = await readCollection("publications");
    let touched = false;
    for (const p of pubs) {
      if (!p.scheduledAt || p.publishedAt || p.blockedAt) continue;
      if (done.has(p.articleId)) { p.publishedAt = done.get(p.articleId); touched = true; }
      else if (blocked.has(p.articleId)) { p.blockedAt = blocked.get(p.articleId); touched = true; }
    }
    if (touched) await writeCollection("publications", pubs);
  }
  return done.size;
}

/* Pour l'onglet Dernier run : état lisible de la planification. */
export async function scheduleStatus(now = Date.now()) {
  const settings = await readSettings();
  const state = (await readJson(SCHEDULE_KEY, {})) || {};
  const parsed = parseTimes(settings.schedule_times);
  return {
    enabled: settings.schedule_enabled === "oui",
    times: parsed.times || [],
    error: parsed.error || null,
    next: settings.schedule_enabled === "oui" && parsed.times ? upcomingSlot(parsed.times, now) : null,
    lastSlot: state.lastSlot || null,
    running: state.running || null,
    lastRun: state.lastRun || null,
    lastSkipped: state.lastSkipped || null,
  };
}
