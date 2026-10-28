/* Récupération des sources actives → harvest/<date>.json et harvest/latest.json
   + notifications pour les sources inaccessibles + entrée dans runs.

   Depuis M3-58, la récolte peut tourner plusieurs fois par jour (src/schedule/) :
   - une source à l'écart (échecs d'affilée) est sautée, et notifiée une fois ;
   - en récolte PLANIFIÉE, une source dont l'intervalle n'est pas écoulé est
     sautée ; une récolte lancée à la main les interroge toutes ;
   - la fenêtre de chaque source part de son dernier succès s'il est plus ancien
     que window_hours ;
   - les contenus de la récolte précédente pas encore générés sont reportés —
     sans quoi une génération interrompue (plafond de dépense) les perdrait. */

import { readSources, readSettings } from "../lib/yamlStore.js";
import { readJson, writeJson, updateJson, dataPath, pushCollection } from "../lib/store.js";
import { log } from "../lib/log.js";
import { isMain } from "../lib/main.js";
import { sourceFallback } from "../../shared/zones.js";
import { intervalOf, isQuarantined, isDue, cutoffFor, afterAttempt, QUARANTINE_AFTER, QUARANTINE_MS } from "../../shared/sourceSchedule.js";
import { recordYield, MUTE_AFTER } from "../../shared/sourceReliability.js";

export const SOURCES_STATE_KEY = "harvest/sources-state.json";
const CARRY_DAYS = 14;
/* Liste blanche du furtif (M3-57, T6) : une fois par semaine, un fetch ordinaire
   vérifie que le 403 est toujours là ; s'il a disparu, la source en sort. */
export const FURTIF_RECHECK_MS = 7 * 86400000;
import { harvestFeed } from "./fetchFeed.js";
import { harvestArticleList } from "./fetchArticleList.js";
import { harvestPdf } from "./fetchPdf.js";
import { closeRenderer, rendererFor } from "./fetchRendered.js";

const PRESS_RE = /presse|m[ée]dia|journal|quotidien|hebdo|gazette|d[ée]p[êe]che/i;

export function sourceMode(s) {
  return PRESS_RE.test(`${s.name} ${s.category || ""}`) ? "press" : "source";
}

function targetUrl(s) {
  return s.rssUrl || s.listUrl || s.pressUrl || s.siteUrl || null;
}
function effectiveType(s) {
  if (s.rssUrl) return "rss";
  const u = s.listUrl || s.pressUrl || s.siteUrl || "";
  if (/\.pdf($|\?)/i.test(u)) return "pdf";
  if (s.listUrl || s.pressUrl) return "article";
  if (s.siteUrl) return "site";
  return "none";
}

/* Le navigateur du repli rendu (M3-57) vit le temps d'une récolte : fermé même
   sur erreur, sinon le worker garderait un Chromium ouvert entre deux runs. */
export async function runHarvest(opts = {}) {
  try {
    return await harvestOnce(opts);
  } finally {
    await closeRenderer();
  }
}

async function harvestOnce({ limit = 0, only = null, scheduled = false } = {}) {
  const settings = await readSettings();
  const allSources = await readSources();
  let sources = allSources.filter((s) => s.active && targetUrl(s));
  if (only) sources = sources.filter((s) => only.includes(s.id));
  if (limit > 0) sources = sources.slice(0, limit);

  /* Repli (M3-57) : null si « non » ou coupe-circuit M3_RENDER_FALLBACK=0. */
  const fb = rendererFor(settings.harvest_render_fallback);
  const baseOpts = { timeoutMs: settings.request_timeout_ms, maxItems: settings.max_items_per_source,
    ...(fb ? { render: true, renderer: fb.render, stealth: fb.stealth } : {}) };
  const states = (await readJson(SOURCES_STATE_KEY, {})) || {};
  /* État écrit source par source, sous verrou (T6) : deux récoltes qui se
     chevauchent ne s'effacent pas, et un arrêt en cours de run garde l'acquis.
     Une source retirée de la liste blanche pendant le run (écran d'administration,
     M3-117) n'y est pas remise depuis la copie du début : seul un furtif réussi
     sur un 403 dans ce run (`enteredFurtif`) l'y inscrit. */
  const enteredFurtif = new Set();
  const persistState = (id) => states[id] === undefined ? null
    : updateJson(SOURCES_STATE_KEY, (all) => {
      const next = { ...states[id] };
      if (!all?.[id]?.furtif && !enteredFurtif.has(id)) delete next.furtif;
      return { ...(all || {}), [id]: next };
    }, {});
  const now = Date.now();

  const date = new Date().toISOString().slice(0, 10);
  const seenPath = dataPath("harvest", "seen.json");
  const seen = (await readJson(seenPath, {})) || {};

  const MAX_TOTAL_ITEMS = 300;
  const perSource = [];
  /* Les sources sautées vont à part : `sources` ne liste que celles réellement
     interrogées. L'accueil de la console compte comme « muette » toute entrée
     ok sans contenu — une source sautée n'est pas muette, elle n'a pas été
     appelée. */
  const skipped = [];
  const items = [];
  let failures = 0, attempted = 0, quarantinedNow = 0, setAside = 0, notDue = 0;

  for (const s of sources) {
    const st = states[s.id];
    if (isQuarantined(st, now)) {
      setAside++;
      skipped.push({ id: s.id, name: s.name, reason: "ecartee", detail: `à l'écart jusqu'au ${fmtParis(st.quarantinedUntil)} (${st.failures} échecs d'affilée)` });
      continue;
    }
    if (scheduled && !isDue(s, st, now)) {
      notDue++;
      skipped.push({ id: s.id, name: s.name, reason: "pas_due", detail: `intervalle de ${intervalOf(s).days} j non écoulé` });
      continue;
    }
    if (items.length >= MAX_TOTAL_ITEMS) {
      perSource.push({ id: s.id, name: s.name, ok: true, count: 0, error: "plafond d'items atteint" });
      continue;
    }
    attempted++;
    try {
      const opts = {
        ...baseOpts,
        cutoffMs: cutoffFor(st, settings.window_hours, now),
        isSeen: (externalId) => !!seen[`${s.id}:${externalId}`],
        /* Liste blanche du furtif : tenue ici, dans l'état de récolte de la source
           (fait mesuré, pas un réglage). Ignorée si le furtif est coupé. */
        stealthFirst: !!(fb?.stealth && st?.furtif),
        stealthRecheck: !!(fb?.stealth && st?.furtif && now - Date.parse(st.furtif.checkedAt || st.furtif.since) >= FURTIF_RECHECK_MS),
      };
      const type = effectiveType(s);
      const url = type === "rss" ? s.rssUrl : (s.listUrl || s.pressUrl || s.siteUrl);
      let r;
      if (type === "rss") r = await harvestFeed(url, opts);
      else if (type === "pdf") r = await harvestPdf(url, opts);
      else if (type === "article" || type === "site") r = await harvestArticleList(url, { ...opts, selector: s.selector });
      else r = { ok: false, error: "type de source non récupérable", items: [] };

      const next = afterAttempt(st, r.ok, Date.now());
      states[s.id] = next.state;

      /* Furtif sur un 403 (M3-57, décision de l'utilisateur du 2026-10-26).
         Réussi : la source entre en liste blanche, les récoltes suivantes y vont
         directement. Toujours refusée, muette ou bloquée : mise à l'écart sur-le-champ,
         par la notification « source_ecartee » existante (alerte de l'accueil). */
      if (opts.stealthRecheck && r.furtif !== "sortie") states[s.id].furtif = { ...states[s.id].furtif, checkedAt: new Date().toISOString() };
      if (r.furtif === "sortie") {
        delete states[s.id].furtif;
        await pushCollection("notifications", {
          id: `n-${Date.now()}-${s.id}`,
          type: "source_furtif",
          severity: "info",
          sourceId: s.id, sourceName: s.name, url,
          detail: "La source répond de nouveau sans refus (plus de 403) : elle sort de la liste blanche du furtif et est récoltée normalement.",
          at: new Date().toISOString(), read: false,
        });
      }
      if (r.furtif === "ok") enteredFurtif.add(s.id);
      if (r.furtif === "ok" && !states[s.id].furtif) {
        states[s.id].furtif = { since: new Date().toISOString() };
        await pushCollection("notifications", {
          id: `n-${Date.now()}-${s.id}`,
          type: "source_furtif",
          severity: "info",
          sourceId: s.id, sourceName: s.name, url,
          detail: "Réponse 403 : la source a été lue par le crawler furtif (camouflage anti-robot) et passe en liste blanche ; les récoltes suivantes l'emploient directement.",
          at: new Date().toISOString(), read: false,
        });
      }
      if (r.furtif === "refus") {
        states[s.id].yield = recordYield(states[s.id].yield, { ok: false }).yield;
        states[s.id].failures = Math.max(states[s.id].failures || 0, QUARANTINE_AFTER);
        states[s.id].quarantinedUntil = new Date(Date.now() + QUARANTINE_MS).toISOString();
        failures++;
        quarantinedNow++;
        perSource.push({ id: s.id, name: s.name, ok: false, count: 0, error: r.error });
        await pushCollection("notifications", {
          id: `n-${Date.now()}-${s.id}`,
          type: "source_ecartee",
          severity: "warning",
          sourceId: s.id, sourceName: s.name, url, error: r.error,
          detail: `${opts.stealthFirst ? "Source en liste blanche du furtif" : "Réponse 403"}, et le crawler furtif n'a rien pu lire (refus, page muette ou bloquée) : source mise à l'écart jusqu'au ${fmtParis(states[s.id].quarantinedUntil)}, puis retentée. Erreur : ${r.error}`,
          at: new Date().toISOString(), read: false,
        });
        continue;
      }

      if (!r.ok) {
        states[s.id].yield = recordYield(states[s.id].yield, { ok: false }).yield;
        failures++;
        perSource.push({ id: s.id, name: s.name, ok: false, count: 0, error: r.error });
        /* À la mise à l'écart, UNE notification qui le dit, à la place de l'échec
           ordinaire : c'est elle que l'administrateur doit voir. */
        if (next.quarantined) quarantinedNow++;
        await pushCollection("notifications", next.quarantined ? {
          id: `n-${Date.now()}-${s.id}`,
          type: "source_ecartee",
          severity: "warning",
          sourceId: s.id, sourceName: s.name, url, error: r.error,
          detail: `${next.state.failures} échecs d'affilée (seuil ${QUARANTINE_AFTER}) : source mise à l'écart jusqu'au ${fmtParis(next.state.quarantinedUntil)}, puis retentée. Dernière erreur : ${r.error}`,
          at: new Date().toISOString(), read: false,
        } : {
          id: `n-${Date.now()}-${s.id}`,
          type: "source_inaccessible",
          severity: "warning",
          sourceId: s.id, sourceName: s.name, url, error: r.error,
          at: new Date().toISOString(), read: false,
        });
        continue;
      }

      const fresh = [];
      const fallback = sourceFallback(s);
      for (const it of r.items) {
        const key = `${s.id}:${it.externalId}`;
        if (seen[key]) continue;
        seen[key] = new Date().toISOString();
        const item = {
          id: key.replace(/[^\w:-]/g, "").replace(":", "_"),
          sourceId: s.id,
          sourceName: s.name,
          sourceType: type,
          sourceKind: s.kind,
          /* Repli du géo-tag selon le niveau de la source (M3-78) : département,
             région, ou rien pour une source nationale. */
          sourceDept: fallback.dept,
          sourceRegion: fallback.region,
          mode: sourceMode(s),
          zone: s.zone && Object.keys(s.zone).length ? s.zone : {},
          url: it.link || url,
          title: String(it.title || "").slice(0, 300),
          publishedAt: it.publishedAt,
          rawText: String(it.rawText || "").slice(0, 6000),
          summary: String(it.summary || "").slice(0, 400),
          harvestedAt: new Date().toISOString(),
          processed: false,
        };
        fresh.push(item);
        items.push(item);
      }
      perSource.push({ id: s.id, name: s.name, ok: true, count: fresh.length, ...(r.diag ? { diag: r.diag } : {}) });

      const y = recordYield(states[s.id].yield, { ok: true, count: fresh.length });
      states[s.id].yield = y.yield;
      /* Une source qui répond mais ne rapporte plus rien n'échoue jamais : sans
         cette alerte, elle resterait active et muette indéfiniment. */
      if (y.muteNow) {
        await pushCollection("notifications", {
          id: `n-${Date.now()}-${s.id}`,
          type: "source_muette",
          severity: "warning",
          sourceId: s.id, sourceName: s.name, url,
          detail: `${MUTE_AFTER} récoltes réussies d'affilée sans aucun contenu nouveau : vérifier l'adresse, le sélecteur ou chercher un flux RSS.`,
          at: new Date().toISOString(), read: false,
        });
      }
    } finally {
      /* Une écriture d'état qui échoue ne doit ni masquer l'erreur de la source ni
         arrêter la récolte : elle est journalisée, et rattrapée au run suivant. */
      try { await persistState(s.id); } catch (err) {
        log.error("harvest", "état de la source non enregistré", { source: s.id, erreur: err.message || String(err) });
      }
    }
  }

  /* seen.json reste écrit en fin de run, et pas source par source : les contenus
     récoltés ne sont enregistrés qu'avec latest.json, plus bas. Marqués « vus » plus
     tôt, un arrêt en cours de run les perdrait ; non marqués, ils sont simplement
     relus au run suivant. Fusion sous verrou (T6) : deux récoltes concurrentes
     gardent chacune ses clés. */
  await updateJson(seenPath, (all) => prune({ ...(all || {}), ...seen }, 45), {});

  /* Report des contenus non générés de la récolte précédente : latest.json va
     être remplacé, et la génération ne lit que lui. */
  const previous = await readJson(dataPath("harvest", "latest.json"));
  const fresh = new Set(items.map((it) => it.id));
  /* Borné à CARRY_DAYS : un contenu jamais généré au bout de deux semaines n'est
     plus une actualité, et le report ne doit pas s'accumuler sans fin si la
     génération reste bloquée. */
  const carryCut = now - CARRY_DAYS * 86400000;
  const carried = (previous?.items || []).filter((it) =>
    !it.processed && !fresh.has(it.id) && !(Date.parse(it.harvestedAt) < carryCut));
  const freshCount = items.length;
  items.unshift(...carried);

  const harvest = {
    date, generatedAt: new Date().toISOString(),
    window_hours: settings.window_hours,
    scheduled,
    sources: perSource, skipped, items,
    stats: {
      sources: attempted, active: sources.length, ok: attempted - failures, failures,
      setAside, quarantinedNow, notDue,
      items: freshCount, carried: carried.length,
      startedAt: new Date(now).toISOString(), // frise des Exécutions (M3-109) : durée de la récolte
    },
  };
  await writeJson(dataPath("harvest", `${date}.json`), harvest);
  await writeJson(dataPath("harvest", "latest.json"), harvest);
  await pushCollection("runs", {
    id: `run-${Date.now()}`, kind: "harvest", at: harvest.generatedAt,
    stats: harvest.stats,
  });
  return harvest;
}

function fmtParis(iso) {
  return new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function prune(seen, days) {
  const cutoff = Date.now() - days * 86400 * 1000;
  const out = {};
  for (const [k, iso] of Object.entries(seen)) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t >= cutoff) out[k] = iso;
  }
  return out;
}

if (isMain(import.meta.url)) {
  try { process.loadEnvFile(); } catch {}
  runHarvest({ limit: Number(process.env.M3_HARVEST_LIMIT) || 0 })
    .then((h) => {
      console.log(`✓ harvest ${h.date} : ${h.stats.items} items, ${h.stats.ok}/${h.stats.sources} sources OK, ${h.stats.failures} échecs`);
      h.sources.filter((s) => s.ok && s.count).forEach((s) => console.log(`  • ${s.name} : ${s.count}`));
      h.sources.filter((s) => !s.ok).forEach((s) => console.log(`  ✗ ${s.name} — ${s.error}`));
    })
    .catch((e) => { console.error("✗ " + e.stack); process.exit(1); });
}
