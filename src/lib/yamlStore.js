/* Référentiels de configuration : sources, réglages, utilisateurs.

   Stockés en PostgreSQL. Seuls vestiges de l'ancien stockage YAML : les
   config/sources.{public,private}.baseline.yml, conservés en lecture seule dans
   l'image comme jeu de « retour à l'état de référence » (décision 2 du plan).

   Le nom du module est conservé : 12 modules l'importent, et le renommer
   n'apporterait rien d'autre que du bruit dans l'historique. */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { ROOT } from "./store.js";
import { query, withTransaction } from "./db.js";
import { H2_REQUIRED_ABOVE_SIGNS, PROMPT_DEFAULTS, LENGTH_DEFAULTS, RULES_DEFAULTS } from "../../shared/model.js";
import { parseTimes } from "../../shared/slots.js";
import { DEFAULT_ZONES, parseZones, formatZones, SCOPE_LEVELS } from "../../shared/zones.js";
import { DEPARTEMENTS, REGIONS } from "../../shared/geoFrance.js";
import { FEATS, FEAT_ROLES } from "../../shared/feats.js";
import { SITE_ICON_KEY } from "../../shared/contrat.js";

const { parse } = YAML;

export const CONFIG_DIR = join(ROOT, "config");
export const configPath = (name) => join(CONFIG_DIR, name);

/* --- historique de configuration (B2) --------------------------------------
   Remplace le copyFile(abs, abs + ".bak") d'avant : on enregistre l'état
   AVANT modification, en tête de chaque écriture. */

const HISTORY_CAP = 100;

async function snapshot(client, scope, payload, author) {
  await client.query(
    "INSERT INTO config_history (scope, payload, author) VALUES ($1, $2::jsonb, $3)",
    [scope, JSON.stringify(payload), author ?? null]
  );
  await client.query(
    `DELETE FROM config_history
      WHERE scope = $1
        AND id NOT IN (SELECT id FROM config_history WHERE scope = $1 ORDER BY at DESC, id DESC LIMIT $2)`,
    [scope, HISTORY_CAP]
  );
}

export async function readConfigHistory(scope, limit = 20) {
  const { rows } = await query(
    "SELECT id, scope, at, author FROM config_history WHERE scope = $1 ORDER BY at DESC, id DESC LIMIT $2",
    [scope, limit]
  );
  return rows;
}

export async function readConfigHistoryEntry(id) {
  const { rows } = await query("SELECT id, scope, payload, at, author FROM config_history WHERE id = $1", [id]);
  return rows[0] || null;
}

/* Suppression ciblée d'une version. Prévue dès la première mouture (B2) : un
   historique conserve par construction ce qu'on vient d'en retirer, et il faut
   pouvoir en sortir une donnée personnelle ou une valeur sensible saisie par
   erreur — le cap automatique ne suffit pas. */
export async function deleteConfigHistoryEntry(id) {
  const { rowCount } = await query("DELETE FROM config_history WHERE id = $1", [id]);
  return rowCount;
}

/* --- settings : scalaires whitelistés + bornes ------------------------------ */
export const SETTING_SPECS = {
  window_hours: { type: "int", min: 1, max: 8760, default: 72 },
  request_timeout_ms: { type: "int", min: 1000, max: 120000, default: 15000 },
  max_items_per_source: { type: "int", min: 1, max: 200, default: 15 },
  /* Zones couvertes (M3-74, shared/zones.js). Elles remplacent `region`, qui ne
     changeait pas le périmètre (codé en dur sur la Nouvelle-Aquitaine) et pouvait
     donc le contredire, et `region_num`, que rien ne lisait. Leurs lignes restent
     en base sans effet : readSettings ne lit que les clés déclarées ici. */
  zones_covered: { type: "zones", default: formatZones(DEFAULT_ZONES) },
  /* non : un sujet hors zone est écarté avant génération (M3-73), sans appel LLM.
     oui : il est généré, puis signalé « non habilité ». */
  generate_out_of_zone: { type: "enum", values: ["non", "oui"], default: "non" },
  /* Filtre posé à l'ouverture de la console. Vide = aucun. */
  console_default_dept: { type: "dept", default: "17" },
  /* Identifiant OpenRouter, TOUJOURS préfixé par l'éditeur. */
  /* Le modèle n'est plus un réglage plat : il appartient au moteur LLM actif
     (table llm_providers, onglet LLM du back-office). L'exposer aussi ici
     donnerait deux sources de vérité pour une même valeur. */
  dedup_threshold: { type: "float", min: 0, max: 1, default: 0.5 },
  signs_max: { type: "int", min: 500, max: 40000, default: 7000 },
  ranking_threshold: { type: "int", min: 0, max: 100, default: 60 },
  /* Plancher de la balise titre (M3-86) ; doit rester sous meta_title_max. */
  meta_title_min: { type: "int", min: 10, max: 120, default: 30 },
  meta_title_max: { type: "int", min: 20, max: 120, default: 60 },
  meta_desc_min: { type: "int", min: 20, max: 200, default: 70 },
  meta_desc_max: { type: "int", min: 40, max: 400, default: 160 },
  keywords_min: { type: "int", min: 1, max: 20, default: 3 },
  signs_per_minute: { type: "int", min: 400, max: 4000, default: 1400 },
  /* Nombre minimal de H2 exigé par le critère SEO. 0 désactive le contrôle de
     structure sans toucher au code — le plan Hn redevient purement indicatif. */
  outline_h2_min: { type: "int", min: 0, max: 10, default: 1 },
  /* Au-delà de cette longueur, un H2 est exigé (grille) et demandé (prompt) ;
     en deçà, c'est une brève. Une valeur, deux lecteurs : cf. shared/model.js. */
  h2_above_signs: { type: "int", min: 200, max: 20000, default: H2_REQUIRED_ABOVE_SIGNS },
  /* Règles que seul le prompt de génération cite (src/llm/prompts/generate.js).
     Avec signs_max, meta_title_max, meta_desc_min/max, keywords_min et
     outline_h2_min ci-dessus, ce sont toutes les contraintes chiffrées du prompt :
     plus aucune n'y est écrite en dur. */
  /* Plancher du titre (M3-86) ; doit rester sous title_max. */
  title_min: { type: "int", min: 10, max: 200, default: 30 },
  title_max: { type: "int", min: 30, max: 200, default: PROMPT_DEFAULTS.title_max },
  h2_title_max: { type: "int", min: 20, max: 150, default: PROMPT_DEFAULTS.h2_title_max },
  breve_signs_min: { type: "int", min: 100, max: 5000, default: PROMPT_DEFAULTS.breve_signs_min },
  /* Longueur visée (M3-86, src/llm/lengthTarget.js) : pourcentage des signes
     utiles de la source, borné par breve_signs_min et signs_max. 0 = règle
     désactivée, le prompt reprend la consigne « proportionnée » d'avant. */
  length_source_pct: { type: "int", min: 0, max: 1000, default: LENGTH_DEFAULTS.length_source_pct },
  /* Même logique pour le titre et la balise titre (% du titre de la source,
     bornés par title_min/max et meta_title_min/max) et pour la méta-description
     (% du chapô ou du premier paragraphe, borné par meta_desc_min/max), M3-86.
     0 = règle désactivée, comportement d'avant (seul le maximum compte). */
  title_source_pct: { type: "int", min: 0, max: 1000, default: 0 },
  meta_source_pct: { type: "int", min: 0, max: 1000, default: 0 },
  /* Nombre maximal de mots du slug (M3-56). 0 = sans limite. */
  slug_max_words: { type: "int", min: 0, max: 20, default: 6 },
  /* Bornes des appels LLM (M3-60, M3-64). Elles vivent ici plutôt qu'en dur dans
     les adaptateurs pour deux raisons : elles se règlent au back-office sans
     redéploiement, et les deux dialectes partagent alors la même valeur — un
     max_tokens dupliqué finit toujours par diverger.

     4096 tokens de sortie couvrent environ 15 000 caractères, soit le double de
     signs_max (7000) : large pour un article, mais ça reste un plafond.
     120 s de délai : une génération derrière une passerelle qui met le modèle en
     file d'attente est légitimement longue — bien plus que les 15 s du scraping
     (request_timeout_ms ci-dessus), qui n'a pas le même rythme. */
  llm_max_tokens: { type: "int", min: 256, max: 32000, default: 4096 },
  llm_timeout_ms: { type: "int", min: 5000, max: 600000, default: 120000 },
  /* Test des modèles du catalogue (src/llm/modelTests.js) : appels simultanés.
     5 par défaut — au-delà, on provoque soi-même des 429 chez une passerelle,
     et le verdict accuse un modèle qui n'y est pour rien. */
  llm_test_concurrency: { type: "int", min: 1, max: 20, default: 5 },
  /* Nouvelles demandes au modèle quand sa réponse ne tient pas une règle des
     Paramètres (M3-87, src/llm/rules.js). Chacune se paie comme une génération,
     et le plafond de dépense les arrête. */
  rules_retry_max: { type: "int", min: 0, max: 3, default: RULES_DEFAULTS.rules_retry_max },
  /* Moteur de secours (M3-88, src/llm/fallback.js) : identifiant d'un moteur de
     l'onglet LLM, appelé quand le moteur actif échoue. « aucun » = repli mock
     direct, comme avant. Le principal reste le moteur actif de l'onglet LLM. */
  llm_fallback_provider: { type: "string", default: "aucun" },
  /* Modèle qui surcharge le modèle par défaut du moteur de secours (M3-104) ;
     vide = son modèle par défaut. Permet un secours sur le même moteur que
     l'actif, avec un autre modèle. */
  llm_fallback_model: { type: "string", default: "", optional: true },
  /* Relecture automatique (M3-89) : chaque article généré comparé à sa source
     par un second moteur, verdict stocké dans checks.review. Désactivée par
     défaut : elle double le coût d'une génération. « mock » = relecture
     mécanique gratuite, pour essayer la chaîne. */
  llm_review_enabled: { type: "enum", values: ["non", "oui"], default: "non" },
  llm_review_provider: { type: "string", default: "aucun" },
  /* Idem pour le moteur de relecture (M3-104) ; vide = son modèle par défaut. */
  llm_review_model: { type: "string", default: "", optional: true },
  /* Relances sur hallucination (M3-55) : un article que la relecture rejette est
     redemandé, au plus llm_regen_max fois, aux moteurs de llm_regen_engines pris
     dans l'ordre (« moteur:modèle, moteur:modèle »). Liste vide = aucune relance,
     quel que soit llm_regen_max. */
  llm_regen_max: { type: "int", min: 0, max: 3, default: 2 },
  llm_regen_engines: { type: "string", default: "", optional: true },
  /* Plafonds de dépense LLM (M3-62, src/llm/budget.js). 0 = désactivé, c'est le
     défaut : on ne bride pas une installation qui ne l'a pas demandé. Dollars =
     champ `cost` d'OpenRouter ; tokens = seul plafond qui borne un moteur qui ne
     renvoie aucun coût. Jour et mois à l'heure de Paris. */
  llm_cap_run_usd: { type: "float", min: 0, max: 10000, default: 0 },
  llm_cap_run_tokens: { type: "int", min: 0, max: 1000000000, default: 0 },
  llm_cap_day_usd: { type: "float", min: 0, max: 10000, default: 0 },
  llm_cap_day_tokens: { type: "int", min: 0, max: 1000000000, default: 0 },
  llm_cap_month_usd: { type: "float", min: 0, max: 100000, default: 0 },
  llm_cap_month_tokens: { type: "int", min: 0, max: 1000000000, default: 0 },
  /* Au plafond : « stop » n'appelle plus le LLM, les candidats restants attendent
     la run suivante ; « mock » continue en mock, avec des articles factices
     signalés comme tels (bandeau ambre). */
  llm_cap_action: { type: "enum", values: ["stop", "mock"], default: "stop" },
  wp_target: { type: "string", default: "https://wordpress.exemple.fr" },
  /* Chaîne automatique récolte → génération (M3-58, src/schedule/scheduler.js).
     Désactivée par défaut : un déploiement ne doit pas se mettre à appeler le LLM
     de lui-même sans qu'on l'ait décidé. Horaires à l'heure de Paris, séparés
     par des virgules ; validés par checkCoherence. */
  schedule_enabled: { type: "enum", values: ["non", "oui"], default: "non" },
  schedule_times: { type: "string", default: "06:30" },
  /* Rôle minimal qui voit l'écran d'accueil (état de la veille). Les rôles sous
     ce seuil ouvrent directement sur la Relecture, comme avant son existence.
     Déclaré ici et nulle part ailleurs : settingsView() rend un <select> pour
     toute spec portant des `values`, le back-office se peuple donc seul. */
  home_min_role: { type: "enum", values: ["relecteur", "super_utilisateur", "administrateur"], default: "relecteur" },
  /* Raccourcis clavier (shared/shortcuts.js). Ces trois réglages BORNENT, ils ne
     dictent pas : chacun choisit ensuite ses touches dans les Préférences, sans
     jamais pouvoir se rouvrir ce qui est fermé ici. */
  keys_enabled: { type: "enum", values: ["oui", "non"], default: "oui" },
  keys_decisions: { type: "enum", values: ["oui", "non"], default: "oui" },
  keys_confirm: { type: "enum", values: ["risquees", "toutes", "aucune"], default: "risquees" },
  /* FEAT (M3-83, shared/feats.js) : rôle minimal qui a accès à chaque fonction
     expérimentale ; « aucun » la ferme à tous. Le défaut ouvre à tous, comme
     avant que l'accès soit réglable — sauf FEAT qui en précise un autre. */
  /* Archivage automatique (M3-102) : brouillon, à revoir et signalé plus vieux
     que le délai, comptés depuis la génération, passent en archivé au nom du
     système, une fois par heure (m3-worker). Désactivé par défaut. */
  feat_archivage_auto: { type: "enum", values: ["non", "oui"], default: "non" },
  archivage_auto_heures: { type: "int", min: 1, max: 720, default: 24 },
  /* Effacement des purgés (T14) : un article purgé depuis plus de N jours est
     effacé ; sa fiche minimale reste dans article_tombstones (migration 022),
     retrouvable par UUID. 0 = jamais, c'est le défaut. */
  purge_retention_days: { type: "int", min: 0, max: 3650, default: 0 },
  /* Crawlers de repli de la récolte (M3-57) : réglage global et non FEAT à rôle,
     la récolte tournant côté serveur sans utilisateur. Sans l'outil installé dans
     l'image du worker, la valeur est sans effet (signalé dans le diagnostic). */
  harvest_render_fallback: { type: "enum", values: ["non", "playwright", "furtif"], default: "non" },
  /* Scan des concurrents (M3-121, M3-122) : à part de la chaîne récolte →
     génération. Désactivé par défaut ; le bouton de Sources → Concurrents le
     lance même désactivé. Horaires validés par checkCoherence, comme
     schedule_times. max_articles : articles lus par concurrent et par scan. */
  competitors_scan_enabled: { type: "enum", values: ["non", "oui"], default: "non" },
  competitors_scan_times: { type: "string", default: "02:30" },
  competitors_max_articles: { type: "int", min: 1, max: 50, default: 10 },
  ...Object.fromEntries(Object.values(FEATS).map((f) => [f.setting, { type: "enum", values: FEAT_ROLES, default: f.default || "relecteur" }])),
};

export function coerceSetting(spec, value) {
  if (spec.type === "zones") return formatZones(parseZones(value));
  if (spec.type === "dept") {
    const s = String(value ?? "").trim().toUpperCase();
    if (s && !DEPARTEMENTS[s]) throw new Error(`département inconnu : ${s}`);
    return s;
  }
  if (spec.type === "string") {
    const s = String(value ?? "").trim();
    /* optional : la chaîne vide est une valeur (« rien de choisi »), pas une erreur. */
    if (!s && !spec.optional) throw new Error("valeur vide");
    return s;
  }
  if (spec.type === "enum") {
    const s = String(value).trim();
    if (!spec.values.includes(s)) throw new Error(`valeur attendue : ${spec.values.join(" ou ")}`);
    return s;
  }
  const n = spec.type === "int" ? Math.round(Number(value)) : Number(value);
  if (!Number.isFinite(n)) throw new Error("nombre invalide");
  if (spec.min != null && n < spec.min) throw new Error(`< ${spec.min}`);
  if (spec.max != null && n > spec.max) throw new Error(`> ${spec.max}`);
  return n;
}

/* La base ne stocke que du texte : le YAML rendait des nombres typés, il faut
   donc recoercer à la lecture, sinon signs_max repart en "7000" et le calcul
   des scores dérape sans erreur. Une valeur illisible retombe sur le défaut. */
export async function readSettings() {
  return (await readSettingsState()).settings;
}

/* Lignes de la table → réglages effectifs + clés « réglées ici » (M3-109, B2).
   Pure, pour être testée sans base. Une clé est réglée ici dès qu'une ligne
   existe, même illisible : c'est elle que « revenir au défaut » supprimera. Les
   clés hors SETTING_SPECS (site_icon) ne sont jamais des réglages. */
export function settingsFromRows(rows) {
  const stored = new Map((rows || []).map((r) => [r.key, r.value]));
  const settings = {};
  for (const [k, spec] of Object.entries(SETTING_SPECS)) {
    const raw = stored.get(k);
    if (raw == null) { settings[k] = spec.default; continue; }
    try {
      settings[k] = coerceSetting(spec, raw);
    } catch {
      settings[k] = spec.default;
    }
  }
  return { settings, stored: Object.keys(SETTING_SPECS).filter((k) => stored.get(k) != null) };
}

/* Réglages effectifs ET clés stockées en base (« réglé ici »), en une lecture.
   Les autres prennent la valeur du moteur : le défaut du code. */
export async function readSettingsState() {
  const { rows } = await query("SELECT key, value FROM settings");
  return settingsFromRows(rows);
}

export async function writeSettings(patch, { author = null } = {}) {
  const entries = Object.entries(patch || {}).filter(([k]) => SETTING_SPECS[k]);
  checkCoherence({ ...(await readSettings()), ...Object.fromEntries(entries.map(([k, v]) => [k, coerceSetting(SETTING_SPECS[k], v)])) });
  await withTransaction(async (c) => {
    const before = await readSettingsWith(c);
    await snapshot(c, "settings", before, author);
    for (const [k, v] of entries) {
      const value = String(coerceSetting(SETTING_SPECS[k], v));
      await c.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [k, value]
      );
    }
  });
  return readSettings();
}

/* « Revenir au défaut » (M3-109, B2) : SUPPRIME les lignes, sans écrire la
   valeur par défaut — le réglage suit ensuite le défaut du code, même s'il
   change. Même filet qu'une écriture : cohérence vérifiée sur le résultat,
   instantané dans config_history. Clés hors SETTING_SPECS ignorées (l'icône du
   site a sa propre route). Rend les clés réellement supprimées. */
export async function resetSettings(keys, { author = null } = {}) {
  const wanted = [...new Set((keys || []).filter((k) => typeof k === "string" && Object.hasOwn(SETTING_SPECS, k)))];
  if (!wanted.length) return [];
  checkCoherence({ ...(await readSettings()), ...Object.fromEntries(wanted.map((k) => [k, SETTING_SPECS[k].default])) });
  let removed = [];
  await withTransaction(async (c) => {
    const before = await readSettingsWith(c);
    removed = wanted.filter((k) => Object.hasOwn(before, k));
    if (!removed.length) return;
    await snapshot(c, "settings", before, author);
    await c.query("DELETE FROM settings WHERE key = ANY($1::text[])", [removed]);
  });
  return removed;
}

/* Les bornes par réglage ne suffisent plus depuis que le prompt les cite toutes :
   « une brève de 2 000 à 1 500 signes » serait une consigne contradictoire pour
   le modèle, et la grille noterait selon l'autre moitié. Refus explicite, avec
   le message renvoyé tel quel au back-office. */
export function checkCoherence(s) {
  const errors = [];
  if (s.breve_signs_min >= s.h2_above_signs) errors.push(`breve_signs_min (${s.breve_signs_min}) doit être inférieur à h2_above_signs (${s.h2_above_signs})`);
  if (s.h2_above_signs > s.signs_max) errors.push(`h2_above_signs (${s.h2_above_signs}) ne peut dépasser signs_max (${s.signs_max})`);
  if (s.title_min >= s.title_max) errors.push(`title_min (${s.title_min}) doit être inférieur à title_max (${s.title_max})`);
  if (s.meta_title_min >= s.meta_title_max) errors.push(`meta_title_min (${s.meta_title_min}) doit être inférieur à meta_title_max (${s.meta_title_max})`);
  if (s.meta_desc_min >= s.meta_desc_max) errors.push(`meta_desc_min (${s.meta_desc_min}) doit être inférieur à meta_desc_max (${s.meta_desc_max})`);
  /* Un filtre par défaut sur un département non couvert ouvrirait la console sur
     une file qui ne peut rien contenir d'habilité. */
  if (s.console_default_dept && s.zones_covered && !parseZones(s.zones_covered).includes(s.console_default_dept)) {
    errors.push(`console_default_dept (${s.console_default_dept}) doit faire partie des zones couvertes`);
  }
  if (s.schedule_times != null) {
    const t = parseTimes(s.schedule_times);
    if (t.error) errors.push(`schedule_times : ${t.error}`);
  }
  if (s.competitors_scan_times != null) {
    const t = parseTimes(s.competitors_scan_times);
    if (t.error) errors.push(`competitors_scan_times : ${t.error}`);
  }
  if (errors.length) throw Object.assign(new Error(`Paramètres incohérents : ${errors.join(" ; ")}.`), { status: 400 });
}

/* L'icône du site (src/lib/siteIcon.js) partage la table mais pas l'historique :
   ses 300 Ko seraient recopiés à chaque enregistrement du formulaire. */
async function readSettingsWith(client) {
  const { rows } = await client.query("SELECT key, value FROM settings WHERE key <> $1", [SITE_ICON_KEY]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/* --- sources ----------------------------------------------------------------
   Deux référentiels lus par harvest/daily : public (institutions, collectivités)
   et privé (entreprises). Le parking (kind = 'parked') n'est jamais lu, et ne
   doit jamais être touché par une écriture. */

export function deriveType(s) {
  if (s.rssUrl) return "rss";
  if (s.listUrl || s.pressUrl) return "article";
  if (s.siteUrl) return "site";
  return "none";
}

export function normalizeSource(s, i) {
  const out = {};
  const id = String(s.id || `s${i + 1}`).trim();
  out.id = id;
  out.name = String(s.name || id).trim();
  out.kind = s.kind === "private" ? "private" : "public";
  if (s.category) out.category = String(s.category).trim();
  if (s.commune) out.commune = String(s.commune).trim();
  // organisation : l'émetteur, pour grouper les sources d'une même mairie (M3-59)
  if (s.organisation && String(s.organisation).trim()) out.organisation = String(s.organisation).trim();
  /* Zone de la source (M3-78) : niveau, département, région. Tout département
     français est admis — il n'était borné à la Nouvelle-Aquitaine que parce que
     le périmètre l'était. Un code inconnu est retiré plutôt que gardé faux. */
  const dept = String(s.dept ?? "").trim().toUpperCase();
  if (DEPARTEMENTS[dept]) out.dept = dept;
  if (SCOPE_LEVELS[s.scopeLevel]) out.scopeLevel = s.scopeLevel;
  // région : saisie au seul niveau régional ; ailleurs, elle se déduit du département
  const region = String(s.region ?? "").trim();
  if (REGIONS[region] && (out.scopeLevel === "region" || !out.dept)) out.region = region;
  for (const u of ["siteUrl", "listUrl", "pressUrl", "rssUrl"]) {
    const v = String(s[u] || "").trim();
    if (v && /^https?:\/\//i.test(v)) out[u] = v;
  }
  if (s.selector) out.selector = String(s.selector).trim();
  if (s.frequency) out.frequency = String(s.frequency).trim();
  // intervalDays : au plus une récolte tous les N jours (M3-58). Absent = déduit de `frequency`.
  if (s.intervalDays != null && String(s.intervalDays).trim() !== "") {
    const n = Math.round(Number(s.intervalDays));
    if (Number.isFinite(n) && n >= 0) out.intervalDays = Math.min(n, 365);
  }
  if (s.priority) out.priority = String(s.priority).trim().toUpperCase().slice(0, 1);
  if (s.method) out.method = String(s.method).trim();
  out.type = s.type ? String(s.type).trim() : deriveType(out);
  out.active = s.active != null ? !!s.active : (out.priority === "A" || out.priority === "B");
  if (s.lastCheck) out.lastCheck = s.lastCheck;
  // zone : champ conservé mais vidé — le géo-tag d'un article vient de son contenu (geo.js),
  // plus de la source. On garde l'emplacement au cas où une source aurait un ancrage fiable.
  out.zone = s.zone && typeof s.zone === "object" && !Array.isArray(s.zone) ? s.zone : {};
  return out;
}

/* Public d'abord puis privé, chacun dans l'ordre de son référentiel : c'est
   l'ordre que le back-office affiche, et les ids sont opaques. */
const SOURCE_ORDER = "ORDER BY (kind = 'private'), position, id";

const rowToSource = (r) => ({
  id: r.id, name: r.name, kind: r.kind, category: r.category, commune: r.commune,
  organisation: r.organisation, intervalDays: r.interval_days, dept: r.dept, type: r.type,
  scopeLevel: r.scope_level, region: r.region,
  siteUrl: r.site_url, listUrl: r.list_url, pressUrl: r.press_url, rssUrl: r.rss_url,
  selector: r.selector, frequency: r.frequency, priority: r.priority, method: r.method,
  active: r.active,
  lastCheck: r.last_check,
  zone: r.zone,
});

async function readSourcesWith(client) {
  const { rows } = await client.query(`SELECT * FROM sources WHERE kind <> 'parked' ${SOURCE_ORDER}`);
  return rows.map((r, i) => normalizeSource(rowToSource(r), i));
}

export async function readSources() {
  const { rows } = await query(`SELECT * FROM sources WHERE kind <> 'parked' ${SOURCE_ORDER}`);
  return rows.map((r, i) => normalizeSource(rowToSource(r), i));
}

const UPSERT_SOURCE = `
  INSERT INTO sources (id, name, kind, category, commune, dept, type,
                       site_url, list_url, press_url, rss_url, selector,
                       frequency, priority, method, active, last_check, zone, position,
                       organisation, interval_days, scope_level, region)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23)
  ON CONFLICT (id) DO UPDATE SET
    organisation = EXCLUDED.organisation, interval_days = EXCLUDED.interval_days,
    scope_level = EXCLUDED.scope_level, region = EXCLUDED.region,
    name = EXCLUDED.name, kind = EXCLUDED.kind, category = EXCLUDED.category,
    commune = EXCLUDED.commune, dept = EXCLUDED.dept, type = EXCLUDED.type,
    site_url = EXCLUDED.site_url, list_url = EXCLUDED.list_url,
    press_url = EXCLUDED.press_url, rss_url = EXCLUDED.rss_url,
    selector = EXCLUDED.selector, frequency = EXCLUDED.frequency,
    priority = EXCLUDED.priority, method = EXCLUDED.method,
    active = EXCLUDED.active, last_check = EXCLUDED.last_check,
    zone = EXCLUDED.zone, position = EXCLUDED.position`;

const sourceParams = (s, position) => [
  s.id, s.name, s.kind, s.category ?? null, s.commune ?? null, s.dept ?? null, s.type,
  s.siteUrl ?? null, s.listUrl ?? null, s.pressUrl ?? null, s.rssUrl ?? null,
  s.selector ?? null, s.frequency ?? null, s.priority ?? null, s.method ?? null,
  s.active, s.lastCheck ? JSON.stringify(s.lastCheck) : null,
  JSON.stringify(s.zone ?? {}), position, s.organisation ?? null, s.intervalDays ?? null,
  s.scopeLevel ?? null, s.region ?? null,
];

/* Écrit la liste complète, répartie public / privé selon `kind`.

   A2 : l'API envoie toujours la liste ENTIÈRE, donc supprimer une source
   consiste à ne plus l'envoyer. Une simple boucle d'upsert laisserait la ligne
   en base et la source continuerait d'être moissonnée, sans le moindre signal.
   D'où le DELETE préalable — restreint aux kinds public/privé, le parking ne
   doit jamais être touché. Le tout dans une transaction : à aucun moment la
   base ne doit être vue amputée de ses sources. */
export async function writeSources(list, { author = null } = {}) {
  const normalized = (list || []).map(normalizeSource);
  const seen = new Set();
  for (const s of normalized) {
    if (seen.has(s.id)) throw new Error(`id de source en double : ${s.id}`);
    seen.add(s.id);
  }
  const pub = normalized.filter((s) => s.kind !== "private");
  const priv = normalized.filter((s) => s.kind === "private");

  await withTransaction(async (c) => {
    await snapshot(c, "sources", await readSourcesWith(c), author);
    await c.query("DELETE FROM sources WHERE kind <> 'parked' AND id <> ALL($1::text[])",
                  [normalized.map((s) => s.id)]);
    for (const group of [pub, priv]) {
      let i = 0;
      for (const s of group) await c.query(UPSERT_SOURCE, sourceParams(s, i++));
    }
  });
  return normalized;
}

/* Restaure les deux référentiels depuis config/sources.{public,private}.baseline.yml
   (fichiers figés dans l'image). Remplace public + privé, laisse le parking intact.
   Lève une erreur si une baseline est absente. */
export async function restoreSourcesFromBaseline({ author = null } = {}) {
  const all = [];
  for (const kind of ["public", "private"]) {
    const doc = parse(await readFile(configPath(`sources.${kind}.baseline.yml`), "utf8")) || {};
    const list = Array.isArray(doc.sources) ? doc.sources : [];
    all.push(...list.map((s, i) => normalizeSource({ ...s, kind }, i)));
  }
  /* Les baselines datent d'avant le champ `organisation` (M3-59) et n'en portent
     pas. Restaurer ne doit pas effacer un regroupement saisi à la main : une
     source restaurée garde son organisation actuelle, sauf si la baseline en
     donne une. Le reste est restauré tel quel. */
  /* Même règle pour l'intervalle de récolte (M3-58) et la zone (M3-78), eux
     aussi absents des baselines. */
  const current = new Map((await readSources()).map((s) => [s.id, s]));
  for (const s of all) {
    const cur = current.get(s.id);
    if (!cur) continue;
    if (!s.organisation && cur.organisation) s.organisation = cur.organisation;
    if (s.intervalDays == null && cur.intervalDays != null) s.intervalDays = cur.intervalDays;
    if (!s.scopeLevel && cur.scopeLevel) s.scopeLevel = cur.scopeLevel;
    if (!s.dept && cur.dept) s.dept = cur.dept;
    if (!s.region && cur.region) s.region = cur.region;
  }
  await writeSources(all, { author });
  return readSources();
}

/* --- users ------------------------------------------------------------------ */

const ROLES = ["administrateur", "super_utilisateur", "relecteur"];

export async function readUsers() {
  const { rows } = await query(
    `SELECT id, name, login, role, (password_hash IS NOT NULL) AS can_login
       FROM users ORDER BY position, id`
  );
  /* canLogin est en lecture seule : writeUsers l'ignore, le mot de passe se
     définit par POST /api/users/:id/password. */
  return rows.map((r) => ({ id: r.id, name: r.name, login: r.login, role: r.role, canLogin: r.can_login }));
}

async function readUsersWith(client) {
  const { rows } = await client.query("SELECT id, name, login, role FROM users ORDER BY position, id");
  return rows.map((r) => ({ id: r.id, name: r.name, login: r.login, role: r.role }));
}

/* Remplacement total, même raisonnement qu'en A2 pour les sources : le
   back-office envoie la liste entière, retirer un utilisateur c'est ne plus
   l'envoyer. */
export async function writeUsers(list, { author = null } = {}) {
  const normalized = (list || []).map((u, i) => ({
    id: String(u.id || `u-${Date.now()}-${i}`),
    name: String(u.name || "Sans nom"),
    login: String(u.login || ""),
    role: ROLES.includes(u.role) ? u.role : "relecteur",
  }));
  await withTransaction(async (c) => {
    await snapshot(c, "users", await readUsersWith(c), author);
    await c.query("DELETE FROM users WHERE id <> ALL($1::text[])", [normalized.map((u) => u.id)]);
    let i = 0;
    for (const u of normalized) {
      await c.query(
        `INSERT INTO users (id, name, login, role, position) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, login = EXCLUDED.login,
           role = EXCLUDED.role, position = EXCLUDED.position`,
        [u.id, u.name, u.login, u.role, i++]
      );
    }
  });
  return readUsers();
}
