import { send } from "../lib/http.js";
import { readCollection, writeCollection, pushCollection, filterCollection } from "../lib/store.js";
import { readUsers, writeUsers, readSettings, readSettingsState, writeSettings, resetSettings as resetSettingsStore, SETTING_SPECS } from "../lib/yamlStore.js";
import { listProviders } from "../lib/llmProviders.js";
import { estRouteur, planRelance } from "../../shared/moteurs.js";
import { DEFAULT_SETTINGS, PROMPT_DEFAULTS } from "../../shared/model.js";
import { PERMISSIONS, ROLES, can, roleAtLeast } from "../../shared/model.js";
import { featsFor, notificationVisible } from "../../shared/feats.js";
import { SCOPE_LEVELS } from "../../shared/zones.js";
import { SOURCE_TYPES } from "../../shared/sources.js";
import { REGIONS, DEPARTEMENTS } from "../../shared/geoFrance.js";
import { journal, readJournal } from "../lib/journal.js";
import { readSiteIcon, writeSiteIcon, deleteSiteIcon } from "../lib/siteIcon.js";
import { lireEtatMoteur } from "../lib/demandes.js";

/* Réglages envoyés à la console (/api/me → moi.scoring) : ceux de la grille
   (DEFAULT_SETTINGS, dont slug_max_words et breve_signs_min) et du prompt
   (PROMPT_DEFAULTS) — le panneau Preuves affiche l'attendu d'un article ancien
   d'après les Paramètres actuels (M3-113) —, plus les deux réglages des preuves
   « fraîcheur de la source » et « doublon », ni dans la grille ni dans le prompt. */
export const scoringDe = (settings) => Object.fromEntries(
  [...Object.keys({ ...DEFAULT_SETTINGS, ...PROMPT_DEFAULTS }), "window_hours", "dedup_threshold"].map((k) => [k, settings[k]]),
);

/* `role` est le rôle EFFECTIF, déjà calculé par le serveur : celui du compte, sauf
   pour un administrateur qui a demandé un « Voir comme ». `user` est le compte réel. */
export async function me({ res, role, user }) {
  const r = ROLES[role] ? role : "relecteur";
  /* « Voir comme » : un administrateur qui exerce un autre rôle. /api/me est
     rappelé à chaque bascule et à chaque chargement de page pendant ce temps. */
  if (user && r !== user.role) journal("connexion", "voir comme", { detail: { role: r } });
  const runs = await readCollection("runs");
  const lastGen = runs.find((x) => x.kind === "generation");
  const settings = await readSettings();
  const scoring = scoringDe(settings);
  /* Moteur LLM effectif (T20c) : écrit par le worker dans moteur/etat, sans la
     clé. Worker arrêté ou état absent : « inconnu » plutôt qu'un mock supposé. */
  const llm = (await lireEtatMoteur().catch(() => ({}))).llm || null;
  send(res, 200, {
    role: r,
    roleLabel: ROLES[r],
    permissions: PERMISSIONS[r],
    roles: Object.entries(ROLES).map(([k, v]) => ({ key: k, label: v })),
    user: user ? { id: user.id, name: user.name, login: user.login, role: user.role } : null,
    /* Seul un administrateur peut endosser un autre rôle (« Voir comme »). */
    canSwitchRole: !!user && user.role === "administrateur",
    scoring,
    /* L'accueil se règle au back-office (home_min_role). C'est le serveur qui
       tranche et n'envoie qu'un booléen : le client n'a pas à connaître la
       hiérarchie des rôles ni à la réimplémenter une seconde fois. */
    canSeeHome: roleAtLeast(r, settings.home_min_role),
    /* FEAT ouvertes à ce rôle (M3-83). Calculées ici, comme canSeeHome : le
       client n'a pas à réimplémenter la hiérarchie des rôles. */
    feats: featsFor(r, settings),
    /* Département filtré à l'ouverture de la console (M3-74), ou null. */
    defaultDept: settings.console_default_dept || null,
    /* Zones couvertes : la console reclasse un article dont on corrige le
       département à la main (scripts/edit.js) sans attendre le serveur. */
    zonesCovered: settings.zones_covered,
    /* Les bornes du clavier, telles quelles : c'est le client qui les combine à
       ses préférences de poste (resolveShortcuts, shared/shortcuts.js). On envoie
       les bornes et non le résultat, parce que l'écran de réglage doit pouvoir
       DIRE pourquoi une action est indisponible, pas seulement la masquer. */
    keys: {
      keys_enabled: settings.keys_enabled,
      keys_decisions: settings.keys_decisions,
      keys_confirm: settings.keys_confirm,
    },
    llmProvider: llm?.provider || "inconnu",
    llmProviderLabel: llm?.label || "moteur inconnu (worker arrêté ?)",
    llmModel: llm?.model || null,
    llmLastRun: lastGen ? {
      at: lastGen.at,
      provider: lastGen.stats?.provider || null,
      fallbacks: lastGen.stats?.fallbacks || 0,
      error: lastGen.stats?.llmError || null,
      cap: lastGen.stats?.cap || null,
    } : null,
  });
}

export async function users({ res }) {
  send(res, 200, { users: await readUsers() });
}
export async function saveUsers({ res, body, role }) {
  if (!can(role, "manage_users")) return send(res, 403, { error: "réservé à l'administrateur" });
  if (!Array.isArray(body.users)) return send(res, 400, { error: "corps attendu : { users: [...] }" });
  const saved = await writeUsers(body.users, { author: role });
  journal("action", "utilisateurs enregistrés", { detail: { comptes: saved.length } });
  send(res, 200, { ok: true, users: saved });
}

/* `stored` (M3-109, B2) : clés réglées ici, c'est-à-dire présentes en base ; les
   autres prennent la valeur du moteur (le défaut du code). Ajout seul : `settings`
   garde sa forme, l'Accueil et d'autres écrans le lisent. */
export async function settings({ res }) {
  const { settings: s, stored } = await readSettingsState();
  send(res, 200, { settings: s, specs: SETTING_SPECS, stored });
}

/* Auteur d'une version de config_history (M3-109, B2) : la personne et le rôle
   exercé, et non plus le seul rôle. Sans compte (outil, test) : le rôle. */
export function settingsAuthor(user, role) {
  const who = user?.login || user?.name || user?.id || null;
  return who ? `${who} (${role})` : role ?? null;
}

/* Ce qui a changé, réglage par réglage : { clé: { avant, apres } } (M3-109,
   décision 8). Qui et quand sont les colonnes de la ligne du journal (actor_*,
   at), posées depuis le contexte de requête. Avant : la chaîne « avant → après ». */
export function settingsChanges(before, after) {
  return Object.fromEntries(Object.keys(after).filter((k) => String(before[k]) !== String(after[k]))
    .map((k) => [k, { avant: before[k], apres: after[k] }]));
}

/* llm_regen_engines (M3-55) contrôlé à l'enregistrement : chaque entrée doit
   désigner un moteur du registre (onglet LLM), ni le mock ni un routeur — les
   deux exclusions de describeEngine (src/llm/index.js), qu'une relance
   n'apprendrait sinon qu'au moment de servir. Même lecture de la liste que la
   relance (planRelance), même règle de routeur (estRouteur). Un moteur
   désactivé ou sans clé reste accepté : il se répare dans l'onglet LLM, et la
   relance le saute alors avec son motif. Vide : aucune relance, accepté. */
export function regenEnginesErrors(value, providers = []) {
  const byId = new Map((providers || []).map((p) => [p.id, p]));
  const errors = [];
  for (const { id, model } of planRelance({ llm_regen_engines: value }).engines) {
    const nom = model ? `${id}:${model}` : id;
    if (id === "mock") { errors.push(`llm_regen_engines : « ${nom} » est le moteur factice (mock), exclu des relances`); continue; }
    const p = byId.get(id);
    if (!p) { errors.push(`llm_regen_engines : « ${id} » n'est pas un moteur du registre`); continue; }
    const effectif = model || p.defaultModel;
    if (estRouteur(effectif)) {
      errors.push(`llm_regen_engines : « ${nom} » est un routeur${model ? "" : ` (modèle par défaut ${effectif})`} : modèle variable, exclu des relances`);
    }
  }
  return errors;
}

export async function saveSettings({ res, body, role, user }) {
  if (!can(role, "manage_settings")) return send(res, 403, { error: "réservé à l'administrateur" });
  const patch = body || {};
  const before = await readSettings();
  /* Contrôlé seulement s'il change : un moteur retiré du registre depuis ne doit
     pas bloquer l'enregistrement d'un autre réglage. */
  if (Object.hasOwn(patch, "llm_regen_engines") && String(patch.llm_regen_engines ?? "").trim() !== String(before.llm_regen_engines ?? "")) {
    let providers;
    try { providers = (await listProviders()).providers; }
    catch (err) { return send(res, 503, { error: `llm_regen_engines : registre des moteurs illisible (${err.message})` }); }
    const errors = regenEnginesErrors(patch.llm_regen_engines, providers);
    if (errors.length) return send(res, 400, { error: errors.join(" ; ") });
  }
  const after = await writeSettings(patch, { author: settingsAuthor(user, role) });
  const changes = settingsChanges(before, after);
  if (Object.keys(changes).length) journal("action", "paramètres modifiés", { detail: changes });
  const { stored } = await readSettingsState();
  send(res, 200, { ok: true, settings: after, stored });
}

/* « Revenir au défaut » (M3-109, B2) : la ligne est SUPPRIMÉE de la table, le
   réglage reprend la valeur du moteur. Mêmes droits, même instantané, même
   journal qu'un enregistrement. Corps : { keys: [...] } ou { key }. */
export async function resetSettings({ res, body, role, user }) {
  if (!can(role, "manage_settings")) return send(res, 403, { error: "réservé à l'administrateur" });
  const keys = Array.isArray(body?.keys) ? body.keys : body?.key != null ? [body.key] : [];
  const unknown = keys.filter((k) => typeof k !== "string" || !Object.hasOwn(SETTING_SPECS, k));
  if (!keys.length || unknown.length) {
    return send(res, 400, { error: keys.length ? `réglage inconnu : ${unknown.map(String).join(", ")}` : "corps attendu : { keys: [...] }" });
  }
  const before = await readSettings();
  const removed = await resetSettingsStore(keys, { author: settingsAuthor(user, role) });
  const { settings: after, stored } = await readSettingsState();
  if (removed.length) {
    const detail = Object.fromEntries(removed.map((k) => [k, { avant: before[k], apres: after[k] }]));
    journal("action", "paramètres remis au défaut", { detail });
  }
  send(res, 200, { ok: true, removed, settings: after, stored });
}

/* Icône du site (src/lib/siteIcon.js). Hors de PUT /api/settings : c'est un
   fichier, pas un scalaire, et le journal n'en garde que le format et le poids. */
export async function siteIcon({ res }) {
  const icon = await readSiteIcon();
  send(res, 200, { icon: icon ? { type: icon.type, bytes: icon.buf.length, etag: icon.etag } : null });
}
export async function saveSiteIcon({ res, body, role }) {
  if (!can(role, "manage_settings")) return send(res, 403, { error: "réservé à l'administrateur" });
  const saved = await writeSiteIcon(body?.dataUrl);
  journal("action", "icône du site changée", { detail: { format: saved.type, octets: saved.bytes } });
  send(res, 200, { ok: true, icon: saved });
}
export async function removeSiteIcon({ res, role }) {
  if (!can(role, "manage_settings")) return send(res, 403, { error: "réservé à l'administrateur" });
  if (await deleteSiteIcon()) journal("action", "icône du site retirée");
  send(res, 200, { ok: true });
}

export async function tickets({ res }) {
  send(res, 200, { tickets: await readCollection("tickets") });
}
/* Demande d'ajout de source (M3-92). La FEAT « Demander une source » la ferme par
   rôle : l'entrée disparaît de la console, et le refus est ici, pas seulement à
   l'écran. Les champs reprennent ceux d'une source du back-office, pour que
   l'administrateur la crée sans ressaisir ; ils restent tous facultatifs sauf
   le nom et l'adresse — un relecteur ne connaît pas forcément le volet ou le
   niveau de rattachement. */
const TICKET_TEXT = { organisation: 120, commune: 80, frequency: 80, category: 60, note: 2000 };
export async function createTicket({ res, body, role, user }) {
  if (!featsFor(role, await readSettings()).demandeSource)
    return send(res, 403, { error: "demande de source fermée à votre rôle" });
  const name = String(body.label || body.name || "").trim().slice(0, 160);
  const url = String(body.url || "").trim().slice(0, 500);
  if (!name || !url) return send(res, 400, { error: "nom et adresse de la source requis" });
  if (!/^https?:\/\//i.test(url)) return send(res, 400, { error: "adresse attendue en http(s)://" });
  const t = { id: `tk-${Date.now()}`, kind: "ajout_source", label: name, url };
  for (const [k, max] of Object.entries(TICKET_TEXT)) {
    const v = String(body[k] ?? "").trim().slice(0, max);
    if (v) t[k] = v;
  }
  /* Clés PROPRES seulement : « constructor » ou « __proto__ » passeraient un simple
     `OBJET[clé]`, et un tableau ["11"] aussi. */
  const key = (v, obj) => typeof v === "string" && Object.hasOwn(obj, v);
  if (body.sourceKind === "public" || body.sourceKind === "private") t.sourceKind = body.sourceKind;
  if (typeof body.type === "string" && SOURCE_TYPES.includes(body.type)) t.type = body.type;
  if (key(body.scopeLevel, SCOPE_LEVELS)) t.scopeLevel = body.scopeLevel;
  const dept = typeof body.dept === "string" ? body.dept.trim().toUpperCase() : "";
  if (key(dept, DEPARTEMENTS)) t.dept = dept;
  else if (key(body.region, REGIONS)) t.region = body.region;
  /* L'auteur vient de la session, pas du corps : la console envoyait le libellé
     de son rôle, que n'importe qui pouvait remplacer. */
  t.requestedBy = user?.name || user?.login || ROLES[role] || role;
  t.requestedById = user?.id || null;
  t.status = "ouvert";
  t.at = new Date().toISOString();
  await pushCollection("tickets", t);
  /* M3-96 : seule la console appelle createTicket (« Demander une source ») ; sans
     origine, le filtre de l'onglet Journal la rangeait sous « Back-office ». */
  journal("action", "demande de source", { target: name, detail: { origine: "console", ticket: t.id, source: name } });
  send(res, 201, { ok: true, ticket: t });
}
export async function resolveTicket({ res, params, role }) {
  if (!can(role, "manage_sources")) return send(res, 403, { error: "réservé à l'administrateur" });
  const list = await readCollection("tickets");
  const t = list.find((x) => x.id === params[0]);
  if (!t) return send(res, 404, { error: "ticket introuvable" });
  t.status = "traite";
  t.resolvedAt = new Date().toISOString();
  await writeCollection("tickets", list);
  send(res, 200, { ok: true, ticket: t });
}

export async function notifications({ res, role }) {
  const settings = await readSettings();
  const list = (await readCollection("notifications")).filter((n) => notificationVisible(n, role, settings));
  send(res, 200, { notifications: list, unread: list.filter((n) => !n.read).length });
}
/* Onglet Journal (M3-81) : réservé à l'administrateur — il porte des noms, des
   identifiants tronqués et des traces d'erreur. */
export async function journalList({ res, query: params, role }) {
  if (!can(role, "manage_settings")) return send(res, 403, { error: "réservé à l'administrateur" });
  send(res, 200, await readJournal(params || {}));
}

/* Purge des notifications lues (M3-80). Réservée à l'administrateur : la liste est
   commune, et ce qu'on efface disparaît pour tout le monde. */
export async function purgeReadNotifications({ res, role }) {
  if (!can(role, "manage_settings")) return send(res, 403, { error: "réservé à l'administrateur" });
  const removed = await filterCollection("notifications", (n) => !n.read);
  journal("action", "notifications lues purgées", { detail: { supprimees: removed } });
  send(res, 200, { ok: true, removed });
}

export async function readNotification({ res, params }) {
  const list = await readCollection("notifications");
  const n = list.find((x) => x.id === params[0]);
  if (n) { n.read = true; await writeCollection("notifications", list); }
  send(res, 200, { ok: true });
}
