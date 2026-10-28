/* /api/history — généré pour la transition (docs/plans/PLAN-nextjs-migration.md, phase 2) :
   le handler de src/api reste le même, le pont le fait tourner sous Next.js.
   Session exigée par le pont. */
import { route } from "@/pont";
import * as articles from "@/api/articles.js";

export const GET = route(articles.history);
