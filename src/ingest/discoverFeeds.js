/* Découverte de flux RSS pour les sources qui n'en ont pas (M3-50).

   Le 2026-10-14, 12 des 31 sources actives sans flux en publiaient un qu'on
   n'utilisait pas — dont les mairies de Rochefort, Saintes et Aytré, lues
   jusque-là par l'heuristique de page liste. Un flux daté, complet et
   structuré vaut toujours mieux qu'une page HTML devinée.

   npm run sources:discover              → propose, n'écrit rien
   npm run sources:discover -- --apply   → écrit rss_url (et type) des flux validés
   npm run sources:discover -- --parked  → inclut le parking (sources sans flux ni liste)
   npm run sources:discover -- --only=id1,id2 --apply → seulement ces sources

   Relire avant --apply : un flux pauvre peut valoir moins que la page liste
   (Saintes, 2026-10-14 : 2 items en 60 jours par le flux, 6 nouveaux par la page).

   Un flux n'est retenu que s'il a publié dans les 60 derniers jours, n'est pas
   d'abord un flux d'offres d'emploi, et n'est pas déjà celui d'une autre source
   (trois sources « Rochefort » pointeraient sinon sur le même flux et
   récolteraient trois fois chaque article). L'écriture est une mise à jour
   ciblée par id : writeSources remplacerait toute la table. */

import * as cheerio from "cheerio";
import { readSources } from "../lib/yamlStore.js";
import { query, closePool } from "../lib/db.js";
import { isMain } from "../lib/main.js";
import { fetchCapped } from "./net.js";
import { harvestFeed } from "./fetchFeed.js";

export const COMMON_PATHS = ["/feed", "/feed/", "/rss.xml", "/rss", "/feed.xml", "/actualites/feed", "/?feed=rss2", "/spip.php?page=backend"];
const JOB_RE = /\((h\/f|f\/h)\)|\bcdi\b|\bcdd\b|recrut|offre d'emploi|alternance|stage\b/i;
const FRESH_DAYS = 60;

export function feedLinksIn(html, base) {
  const $ = cheerio.load(html);
  return $("link[rel=alternate][type*='rss'], link[rel=alternate][type*='atom']")
    .map((_, el) => { try { return new URL($(el).attr("href"), base).toString(); } catch { return null; } })
    .get().filter(Boolean);
}

/* Part des titres qui sont des offres d'emploi. */
export function jobShare(titles) {
  if (!titles.length) return 0;
  return titles.filter((t) => JOB_RE.test(t)).length / titles.length;
}

async function candidatesFor(s, timeoutMs) {
  const pages = [s.listUrl, s.pressUrl, s.siteUrl].filter(Boolean);
  const out = [];
  for (const p of pages) {
    try { out.push(...feedLinksIn(await fetchCapped(p, { timeoutMs, maxBytes: 2 * 1024 * 1024 }), p)); } catch { /* page muette */ }
  }
  const origin = (() => { try { return new URL(pages[0]).origin; } catch { return null; } })();
  if (origin) out.push(...COMMON_PATHS.map((p) => origin + p));
  return [...new Set(out)];
}

/* Premier flux valide pour la source, ou null avec la raison. */
export async function discoverFor(s, { timeoutMs = 15000 } = {}) {
  const cutoffMs = Date.now() - FRESH_DAYS * 86400000;
  let last = "aucun flux trouvé";
  for (const url of await candidatesFor(s, timeoutMs)) {
    const r = await harvestFeed(url, { timeoutMs, maxItems: 30, fullText: false });
    if (!r.ok || !r.items.length) continue;
    const recent = r.items.filter((it) => it.publishedAt && Date.parse(it.publishedAt) >= cutoffMs);
    if (!recent.length) { last = `flux ${url} sans item depuis ${FRESH_DAYS} j`; continue; }
    if (jobShare(r.items.map((it) => it.title)) >= 0.5) { last = `flux ${url} : surtout des offres d'emploi`; continue; }
    const avg = Math.round(recent.reduce((a, it) => a + it.rawText.length, 0) / recent.length);
    return { url, recent: recent.length, avgText: avg, sample: recent[0].title };
  }
  return { url: null, reason: last };
}

export async function discoverFeeds({ apply = false, parked = false, only = null, log = console.log } = {}) {
  const sources = await readSources();
  const used = new Set(sources.map((s) => s.rssUrl).filter(Boolean));
  const targets = sources.filter((s) => !s.rssUrl && (s.listUrl || s.pressUrl || s.siteUrl)
    && (only ? only.includes(s.id) : (s.active || (parked && s.kind === "parked"))));
  const found = [];
  const queue = [...targets];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      found.push({ s, r: await discoverFor(s) });
    }
  }));
  const ordered = found.sort((a, b) => sources.indexOf(a.s) - sources.indexOf(b.s));
  const kept = [];
  for (const { s, r } of ordered) {
    if (!r.url) { log(`  · ${s.name} — ${r.reason}`); continue; }
    if (used.has(r.url)) { log(`  = ${s.name} — ${r.url} déjà utilisé par une autre source`); continue; }
    used.add(r.url);
    kept.push({ s, r });
    log(`  + ${s.name} — ${r.url} (${r.recent} items/${FRESH_DAYS} j, ${r.avgText} car. en moyenne) « ${r.sample.slice(0, 60)} »`);
  }
  if (apply && kept.length) {
    for (const { s, r } of kept) await query("UPDATE sources SET rss_url = $1, type = 'rss' WHERE id = $2", [r.url, s.id]);
    /* journal() n'écrit pas hors requête HTTP et n'est pas attendu : en ligne de
       commande, la ligne est écrite ici, avant la fermeture du pool. */
    const detail = { total: kept.length, sources: kept.map(({ s, r }) => ({ id: s.id, nom: s.name, rss: r.url })) };
    await query(
      `INSERT INTO journal (category, level, event, actor_name, detail) VALUES ('action', 'info', 'flux RSS découverts', 'sources:discover', $1::jsonb)`,
      [JSON.stringify(detail)],
    );
  }
  return { scanned: targets.length, kept: kept.map(({ s, r }) => ({ id: s.id, name: s.name, ...r })), applied: apply };
}

if (isMain(import.meta.url)) {
  try { process.loadEnvFile(); } catch {}
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  discoverFeeds({ apply: args.includes("--apply"), parked: args.includes("--parked"), only: onlyArg ? onlyArg.slice(7).split(",") : null })
    .then((r) => console.log(`✓ ${r.kept.length} flux retenus sur ${r.scanned} sources examinées${r.applied ? " — écrits en base" : " — rien d'écrit (--apply pour enregistrer)"}`))
    .catch((e) => { console.error("✗ " + e.stack); process.exitCode = 1; })
    .finally(() => closePool().catch(() => {}));
}
