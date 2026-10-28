"use server";

import { action } from "@/pont";
import * as articles from "@/api/articles.js";
import { tenter } from "@/resultat";
import { utilisateurCourant } from "@/session";
import { journalConsole } from "@/lib/journal.js";
import type { Article } from "@/relireArticles/relireArticles.regles";
import type { Patch } from "./editerArticle.regles";

const patcher = action<Article>(articles.patch);

/* L'enregistrement différé des saisies (et immédiat des choix structurels). */
export async function patcherArticle(id: string, patch: Patch) {
  return journalConsole("édition", await tenter(patcher({ params: [id], body: patch })), { user: await utilisateurCourant(), detail: { champs: Object.keys(patch || {}) } });
}
