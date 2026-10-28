// Règles pures de l'onglet Journal (M3-81) : les filtres, dans l'URL, et la
// requête qu'ils produisent.


export interface Filtres {
  category: string;
  level: string;
  /** "" (toutes), "console" ou "backoffice" (M3-96). */
  origine: string;
  q: string;
  days: number;
}

export interface Entree {
  id: number;
  at: string;
  category: string;
  level: "info" | "warn" | "error" | string;
  event: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
  actorName?: string | null;
  actorRole?: string | null;
}

export interface Journal {
  items: Entree[];
  counts: Record<string, number>;
  nextCursor: string | null;
  retentionDays: number;
}

export const JOURNAL_TABS: ReadonlyArray<readonly [string, string]> = [
  ["", "Tout"], ["connexion", "Connexions"], ["action", "Actions"], ["erreur", "Erreurs"], ["chaine", "Chaînes automatiques"],
];
export const PERIODES: ReadonlyArray<readonly [string, string]> = [["1", "24 h"], ["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"]];
/* Origine d'une action (M3-96) : la console marque les siennes (detail.origine),
   le reste des actions vient du back-office. */
export const ORIGINES: ReadonlyArray<readonly [string, string]> = [["", "Toutes origines"], ["console", "Console"], ["backoffice", "Back-office"]];
export const NIVEAUX: ReadonlyArray<readonly [string, string]> = [["", "Tous niveaux"], ["error", "Erreurs seulement"], ["warn", "Avertissements"], ["info", "Informations"]];
export const CAT_LABEL: Record<string, string> = Object.fromEntries(JOURNAL_TABS.filter(([k]) => k));
export function filtresDepuis(sp: Record<string, string | string[] | undefined>): Filtres {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const days = Number(s("days") || 7);
  const origine = ORIGINES.some(([v]) => v && v === s("origine")) ? s("origine") : "";
  return { category: s("category"), level: s("level"), origine, q: s("q"), days: PERIODES.some(([v]) => Number(v) === days) ? days : 7 };
}

export function paramsDe(f: Filtres): string {
  const p = new URLSearchParams();
  if (f.category) p.set("category", f.category);
  if (f.level) p.set("level", f.level);
  if (f.origine) p.set("origine", f.origine);
  if (f.q) p.set("q", f.q);
  if (f.days !== 7) p.set("days", String(f.days));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/* Paramètres de GET /api/journal pour ces filtres. */
export function journalQuery(f: Filtres, cursor?: string | null, now = Date.now()): Record<string, string> {
  const q: Record<string, string> = { limit: "100" };
  if (f.category) q.category = f.category;
  if (f.level) q.level = f.level;
  if (f.origine) q.origine = f.origine;
  if (f.q) q.q = f.q;
  q.since = new Date(now - Number(f.days || 7) * 86400000).toISOString();
  if (cursor) q.cursor = cursor;
  return q;
}

/* Une action faite dans la console (journalConsole, M3-96). */
export const depuisConsole = (e: Entree) => e.category === "action" && e.detail?.origine === "console";

export const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
