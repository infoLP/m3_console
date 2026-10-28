/* Accueil cumulatif par rôle (M3-108, axe C7 de M3-99) — règles pures, lues par
   la page serveur (ce qu'elle lit et envoie), par l'écran (ce qu'il montre) et
   par les tests. En JavaScript : les tests de câblage tournent sans TypeScript.

   Décision de l'utilisateur (2026-10-15) : chaque palier AJOUTE au précédent.
   - relecteur : sa file et ce qui cloche ;
   - super utilisateur : + ce qui a tourné cette nuit ;
   - administrateur : + les coûts (FEAT coutRoutines, M3-105) et les alertes.
   Exception (M3-57, décision de l'utilisateur du 2026-10-26) : le super utilisateur
   voit l'alerte « source mise à l'écart », et elle seule (ALERTES_SUPER).
   Le palier ne décide que du contenu. Qui a l'Accueil reste réglé par
   home_min_role (meta.me → canSeeHome). */

export const PALIERS = ["relecteur", "super_utilisateur", "administrateur"];

/* Types d'alerte ouverts au super utilisateur ; l'administrateur les voit toutes.
   Sans lien : la liste des notifications est au back-office, qu'il n'ouvre pas. */
export const ALERTES_SUPER = new Set(["source_ecartee"]);

/* Rang du rôle effectif (« Voir comme » compris). Inconnu : le plus bas. */
export function palier(role) {
  const i = PALIERS.indexOf(role);
  return i < 0 ? 0 : i;
}

/* Ce que la page lit et montre pour ce rôle. `coutsOuverts` : la FEAT
   coutRoutines, que le serveur a déjà évaluée — elle reste la seule règle des
   coûts, le palier administrateur ne fait que poser la section. */
export function sectionsAccueil(role, { coutsOuverts = false } = {}) {
  const p = palier(role);
  return { file: true, cloche: true, nuit: p >= 1, couts: p >= 2 && !!coutsOuverts, alertes: p >= 1 };
}

/* « Cette nuit » : la dernière chaîne PLANIFIÉE (choix de l'utilisateur), lue
   dans l'état de l'ordonnanceur, et la récolte qu'elle a laissée. */
export function cetteNuit(schedule, harvest) {
  const last = schedule?.lastRun || null;
  if (!last) return { statut: "aucune", planifiee: !!schedule?.enabled, prochaine: schedule?.next || null };
  const sources = Array.isArray(harvest?.sources) ? harvest.sources : [];
  /* La récolte du fichier n'est celle de la nuit que si la chaîne a récolté :
     sinon c'est une récolte plus ancienne ou manuelle, qu'on ne lui attribue pas. */
  const recolteDeLaNuit = !!last.harvest;
  const echecs = recolteDeLaNuit ? sources.filter((s) => !s.ok) : [];
  const muettes = recolteDeLaNuit ? sources.filter((s) => s.ok && !s.count) : [];
  const plafond = !!last.generation?.cap;
  const statut = last.error ? (last.harvest ? "echec" : "partielle") : plafond || echecs.length ? "partielle" : "ok";
  return {
    statut, slot: last.slot || null, erreur: last.error || null,
    recolte: last.harvest ? { items: Number(last.harvest.items) || 0, echecs: echecs.map((s) => s.name || "—"), muettes: muettes.map((s) => s.name || "—") } : null,
    generation: last.generation ? { crees: Number(last.generation.created) || 0, plafond } : null,
    prochaine: schedule?.next || null,
  };
}

export const FENETRE_ALERTES_MS = 24 * 3600000;
export const ATTENTE_WORKER_MS = 5 * 60000;

/* Ce qui mérite l'œil de l'administrateur (décision Q2) : plafond LLM atteint,
   sources écartées, parutions bloquées (M3-72), chaîne en échec, moteur dégradé…
   — les notifications non lues d'erreur ou d'avertissement des dernières 24 h,
   regroupées par type ; plus une demande au worker qui attend depuis plus de
   5 min, signe d'un worker arrêté (rien ne le notifie ailleurs). */
const ORDRE_GRAVITE = { error: 0, warning: 1 };
/** @param {{ notifications?: any[], jobs?: any[], now?: number, libelle?: (n: any) => string, href?: string | null }} [o] */
export function alertes({ notifications = [], jobs = [], now = Date.now(), libelle = (n) => n.type, href = "/admin/notifications" } = {}) {
  const parType = new Map();
  for (const n of notifications) {
    if (n.read || !(n.severity in ORDRE_GRAVITE)) continue;
    const t = Date.parse(n.at);
    if (!Number.isFinite(t) || now - t > FENETRE_ALERTES_MS) continue;
    const g = parType.get(n.type);
    if (!g) parType.set(n.type, { cle: n.type, ton: n.severity === "error" ? "stop" : "amber", titre: libelle(n), nombre: 1, dernier: n, href });
    else {
      g.nombre++;
      if (n.severity === "error") g.ton = "stop";
      if (Date.parse(g.dernier.at) < t) g.dernier = n;
    }
  }
  const out = [...parType.values()].map((g) => ({ cle: g.cle, ton: g.ton, titre: g.titre, nombre: g.nombre, texte: g.dernier.detail || g.dernier.sourceName || g.dernier.error || "", at: g.dernier.at, href: g.href }));
  const enAttente = jobs.filter((j) => !j.startedAt && !j.finishedAt && now - Date.parse(j.requestedAt) > ATTENTE_WORKER_MS);
  if (enAttente.length) {
    const plusVieille = enAttente.reduce((a, b) => (Date.parse(a.requestedAt) < Date.parse(b.requestedAt) ? a : b));
    out.push({ cle: "worker", ton: "stop", titre: "Worker arrêté ?", nombre: enAttente.length,
      texte: `${enAttente.length} demande${enAttente.length > 1 ? "s" : ""} en attente depuis plus de 5 min : le worker ne les prend pas.`,
      at: plusVieille.requestedAt, href: "/admin/executions" });
  }
  return out.sort((a, b) => (a.ton === b.ton ? Date.parse(b.at) - Date.parse(a.at) : a.ton === "stop" ? -1 : 1));
}

/* Ce que la page serveur lit et envoie, selon le palier (M3-108). Les lecteurs
   sont injectés (page.tsx passe les requêtes des tranches) : un palier
   n'APPELLE PAS les lectures des paliers au-dessus — rien à filtrer ensuite,
   rien qui puisse partir par erreur vers le navigateur. Une lecture qui échoue
   rend « indisponible » pour son seul bloc. */
/** @param {{ role: string, coutsOuverts?: boolean, now?: number, libelle?: (n: any) => string,
 *   lire: { stats: () => Promise<any>, executions: () => Promise<any>, couts: () => Promise<any>, notifications: () => Promise<any> } }} o */
export async function composerAccueil({ role, coutsOuverts = false, now = Date.now(), libelle, lire }) {
  const sections = sectionsAccueil(role, { coutsOuverts });
  /* Super utilisateur : les seules alertes ALERTES_SUPER, filtrées ICI, avant que
     rien ne parte vers le navigateur ; ni l'alerte worker ni le lien du back-office. */
  const admin = palier(role) >= 2;
  const [stats, runs, couts, notifs] = await Promise.all([
    lire.stats().catch(() => null),
    sections.nuit || sections.alertes ? lire.executions().catch(() => null) : null,
    sections.couts ? lire.couts().catch(() => null) : null,
    sections.alertes ? lire.notifications().catch(() => null) : null,
  ]);
  return {
    sections,
    rythme: stats?.pace ?? null,
    nuit: sections.nuit ? (runs ? cetteNuit(runs.schedule, runs.harvest) : "indisponible") : null,
    couts: sections.couts ? couts : null,
    alertes: sections.alertes
      ? (runs || notifs ? alertes({
        notifications: (notifs?.notifications || []).filter((n) => admin || ALERTES_SUPER.has(n.type)),
        jobs: admin ? runs?.jobs || [] : [],
        now, libelle, href: admin ? "/admin/notifications" : null,
      }) : "indisponible")
      : null,
  };
}
