// Lectures faites DEPUIS le navigateur, sur les routes conservées (le pont) :
// le sondage de la file, le rechargement de l'index, l'article qu'on ouvre, la
// page suivante de l'historique, les statistiques d'une autre période. Même
// règle qu'avant : une réponse 401 renvoie vers la connexion en mémorisant la
// page. Les mutations, elles, sont des actions serveur (*.action.ts).

import type { Article, Ligne } from "./relireArticles.regles";

async function lire<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (res.status === 401) {
    /* Navigation complète, à dessein : la session est tombée, l'état client doit
       repartir de zéro — ce que router.push() ne ferait pas. */
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
    return new Promise<T>(() => {});           // la navigation est en cours : ne jamais résoudre
  }
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw Object.assign(new Error((data as { error?: string })?.error || `HTTP ${res.status}`), { status: res.status, data });
  return data as T;
}

export interface VersionIndex { generated_at: string; total: number }

/* Sonde de version : une seule ligne, pour savoir s'il faut recharger. */
export const versionIndex = () => lire<VersionIndex>("/api/articles?limit=1");

export async function indexComplet(): Promise<{ articles: Ligne[]; generated_at: string; total: number }> {
  let cursor: string | null = null;
  let out: Ligne[] = [];
  let head: { generated_at: string; total: number } | null = null;
  let pages = 0;
  do {
    const cur: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const p = await lire<{ articles: Ligne[]; generated_at: string; total: number; nextCursor: string | null }>(`/api/articles?limit=500${cur}`);
    head = head || p;
    out = out.concat(p.articles || []);
    cursor = p.nextCursor;
  } while (cursor && ++pages < 200);
  return { generated_at: head!.generated_at, total: head!.total, articles: out };
}

export const article = (id: string) => lire<Article>(`/api/articles/${encodeURIComponent(id)}`);

export function historique(opts: Record<string, string | null | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) if (v !== "" && v != null) qs.set(k, v);
  return lire<import("@/consulterHistorique/consulterHistorique.regles").Historique>(`/api/history${qs.toString() ? "?" + qs : ""}`);
}

export const stats = (range: string) => lire<import("@/consulterSuivi/consulterSuivi.regles").Stats>(`/api/stats?range=${encodeURIComponent(range || "semaine")}`);
export const notifications = () => lire<{ notifications: import("@/suivreNotifications/suivreNotifications.regles").Notification[]; unread: number }>("/api/notifications");
