"use server";

// Actions serveur de la connexion. Même forme que M2_Console/src/seConnecter :
// (état précédent, FormData) → nouvel état, ou redirection. Le travail réel
// reste dans src/api/auth.js (tentatives, scrypt, session, journal), appelé par
// le pont en mode action : rien de l'authentification n'est réécrit ici.

import { redirect } from "next/navigation";
import { action } from "@/pont";
import * as auth from "@/api/auth.js";
import { champsConnexion, cheminInterne } from "./seConnecter.regles";

export interface EtatConnexion {
  erreur?: string;
}

const connexion = action<{ ok: boolean }>(auth.login, { ouverte: true });
const deconnexion = action<{ ok: boolean }>(auth.logout);

export async function seConnecter(_etat: EtatConnexion, donnees: FormData): Promise<EtatConnexion> {
  const retour = cheminInterne(donnees.get("next"));
  const champs = champsConnexion({ login: donnees.get("login"), password: donnees.get("password") });
  if ("erreur" in champs) return { erreur: champs.erreur };
  try {
    await connexion({ body: champs });
  } catch (err) {
    /* Le handler répond par un message volontairement indistinct (401) ; 429
       quand il y a trop de tentatives, 403 en mode entra. On l'affiche tel quel. */
    const e = err as { message?: string; status?: number };
    return { erreur: e.status === 503 ? "Serveur injoignable." : e.message || "La connexion a échoué." };
  }
  /* redirect() lève : hors du try, pour ne pas l'attraper. */
  redirect(retour);
}

export async function seDeconnecter(): Promise<void> {
  try { await deconnexion({}); } catch { /* déjà déconnecté : on va à la page de connexion quand même */ }
  redirect("/login");
}
