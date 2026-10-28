/* /auth/login — premier rebond du SSO Entra (M3-42). Navigation ouverte sans
   session, qui répond 302 : le pont la fait passer telle quelle. */
import { navigation } from "@/pont";
import { authStart } from "@/api/authEntra.js";

export const GET = navigation(authStart);
