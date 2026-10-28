import "server-only";
import { action } from "@/pont";
import * as articles from "@/api/articles.js";
import * as sources from "@/api/sources.js";
import type { Article, Ligne, SourceRef } from "./relireArticles.regles";

interface PageIndex { articles: Ligne[]; generated_at: string; total: number; nextCursor: string | null }
const page = action<PageIndex>(articles.list);
const un = action<Article>(articles.get);
const referentiel = action<{ sources: (SourceRef & Record<string, unknown>)[] }>(sources.list);

/* L'index COMPLET, en enchaînant les pages du serveur : la console calcule ses
   filtres et tous ses badges dessus, une page partielle les rendrait faux. */
export async function lireIndexComplet(): Promise<{ articles: Ligne[]; generated_at: string; total: number }> {
  let cursor: string | null = null;
  let out: Ligne[] = [];
  let head: PageIndex | null = null;
  let pages = 0;
  do {
    const q: Record<string, string> = { limit: "500" };
    if (cursor) q.cursor = cursor;
    const p: PageIndex = await page({ query: q });
    head = head || p;
    out = out.concat(p.articles || []);
    cursor = p.nextCursor;
  } while (cursor && ++pages < 200);
  return { generated_at: head!.generated_at, total: head!.total, articles: out };
}

export const lireArticle = (id: string) => un({ params: [id] });

/* Le référentiel des sources (M3-59), réduit à ce que le filtre du rail montre :
   ni URL ni sélecteur ne partent vers le navigateur. */
export async function lireReferentielSources(): Promise<SourceRef[]> {
  const { sources: liste } = await referentiel({});
  return (liste || []).map((s) => ({
    id: String(s.id), name: String(s.name || ""), kind: s.kind, organisation: s.organisation || undefined,
    active: s.active !== false, dept: s.dept || undefined,
  }));
}
