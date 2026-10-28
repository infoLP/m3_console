/* GET /api/articles/:id — l'article ouvert dans la console (lecture faite depuis
   le navigateur, relireArticles.client.ts). La modification passe par une action
   serveur (editerArticle.action.ts), plus par PATCH. */
import { route } from "@/pont";
import * as articles from "@/api/articles.js";

export const GET = route(articles.get);
