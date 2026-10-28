// La session courante, côté Next.js. Mêmes noms que M2_Console/src/session.ts
// (utilisateurCourant, exigerUtilisateur…), implémentés au-dessus de
// src/lib/auth.js : le cookie m3_session, la table sessions, le hachage scrypt
// et le SSO Entra restent ceux de M3. C'est l'API commune qui rendra les écrans
// échangeables à la fusion, pas le stockage.

import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, COOKIE_NAME } from "@/lib/auth.js";
import { ROLES, can } from "@shared/model.js";

export interface Utilisateur {
  id: string;
  login: string;
  name: string;
  role: "administrateur" | "super_utilisateur" | "relecteur";
}

export type Role = Utilisateur["role"];

/* « Voir comme » (commodité de recette, à retirer avec le SSO) : l'ancien front
   envoyait l'en-tête X-M3-Role à chaque appel ; une action serveur n'en porte
   pas, le choix vit donc aussi dans ce cookie. L'en-tête garde la priorité. */
export const COOKIE_VOIR_COMME = "m3_voir_comme";

/* L'utilisateur du cookie, ou null. Une base injoignable lève : l'appelant
   répond 503 plutôt que de servir sans pouvoir vérifier (cf. legacy/server.js).
   Mémoïsé par requête (cache de React) : le layout, la page et les lectures par
   le pont partagent une seule lecture de la table sessions. */
export const utilisateurCourant = cache(async (): Promise<Utilisateur | null> => {
  const jeton = (await cookies()).get(COOKIE_NAME)?.value ?? null;
  if (!jeton) return null;
  return (await readSession(jeton)) as Utilisateur | null;
});

/* Le rôle sous lequel la requête est traitée. Un administrateur peut en endosser
   un autre le temps d'une requête (« Voir comme », en-tête X-M3-Role) : commodité
   de recette, à retirer avec le SSO. Pour tout autre compte, l'en-tête est ignoré. */
export async function roleEffectif(u: Utilisateur | null): Promise<Role> {
  if (!u) return "relecteur";
  if (u.role !== "administrateur") return u.role;
  const demande = ((await headers()).get("x-m3-role") || (await cookies()).get(COOKIE_VOIR_COMME)?.value || "").toLowerCase();
  return demande in ROLES ? (demande as Role) : u.role;
}

/* Page réservée aux connectés : redirige vers la connexion sinon, en mémorisant
   d'où l'on vient. `next` n'accepte qu'un chemin interne. */
export async function exigerUtilisateur(retour = "/"): Promise<Utilisateur> {
  const u = await utilisateurCourant();
  if (!u) redirect(`/login?next=${encodeURIComponent(cheminInterne(retour))}`);
  return u;
}

/* Page réservée à un droit (table PERMISSIONS de shared/model.js), évalué sur le
   rôle du COMPTE : « Voir comme » ne change pas ce qu'on a le droit d'ouvrir. */
export async function exigerDroit(droit: string, retour = "/"): Promise<Utilisateur> {
  const u = await exigerUtilisateur(retour);
  if (!can(u.role, droit)) redirect("/console");
  return u;
}

/* Au moins un des droits (M3-120 : la coque /admin s'ouvre avec « backoffice » OU
   « manage_competitors »). Chaque page sous la coque garde sa propre garde. */
export async function exigerUnDesDroits(droits: readonly string[], retour = "/"): Promise<Utilisateur> {
  const u = await exigerUtilisateur(retour);
  if (!droits.some((d) => can(u.role, d))) redirect("/console");
  return u;
}

/* Un chemin interne seulement : jamais une URL fournie de l'extérieur, qui
   servirait de tremplin (même règle que legacy/public/login.html). */
export function cheminInterne(brut: string | null | undefined): string {
  const s = String(brut || "/");
  return s === "/" || /^\/[^/\\]/.test(s) ? s : "/";
}
