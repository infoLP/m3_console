/* /auth/callback — retour de Microsoft (M3-42). Pose le cookie de session et
   redirige vers la page demandée ; M3_PUBLIC_URL construit le redirect_uri, rien
   ne change pour l'app registration. */
import { navigation } from "@/pont";
import { authCallback } from "@/api/authEntra.js";

export const GET = navigation(authCallback);
