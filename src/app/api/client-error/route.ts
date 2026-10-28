/* /api/client-error — généré pour la transition (docs/plans/PLAN-nextjs-migration.md, phase 2) :
   le handler de src/api reste le même, le pont le fait tourner sous Next.js.
   Route OUVERTE sans session (cf. OUVERTES dans src/pont.ts). */
import { route } from "@/pont";
import * as clientError from "@/api/clientError.js";

export const POST = route(clientError.receive);
