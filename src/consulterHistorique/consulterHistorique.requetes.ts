import "server-only";
import { action } from "@/pont";
import * as articles from "@/api/articles.js";
import type { Historique } from "./consulterHistorique.regles";

const lister = action<Historique>(articles.history);

export const lireHistorique = (opts: { category?: string; q?: string; uuid?: string; cursor?: string | null } = {}) => {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts)) if (v) query[k] = String(v);
  return lister({ query });
};
