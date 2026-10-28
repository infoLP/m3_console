/* /api/stats — généré pour la transition (docs/plans/PLAN-nextjs-migration.md, phase 2) :
   le handler de src/api reste le même, le pont le fait tourner sous Next.js.
   Session exigée par le pont. */
import { route } from "@/pont";
import * as ops from "@/api/ops.js";

export const GET = route(ops.stats);
