// Page de connexion. Composant serveur : les moyens d'entrer (formulaire, SSO)
// sont lus directement dans src/lib/oidc.js, plus besoin de l'appel
// GET /api/auth/modes que faisait l'ancienne page au chargement.

import type { Metadata } from "next";
import "../../../styles/login.css";
import { authMode, localEnabled, entraEnabled } from "@/lib/oidc.js";
import { utilisateurCourant } from "@/session";
import { cheminInterne, messageErreurSso } from "@/seConnecter/seConnecter.regles";
import { FormulaireConnexion } from "./FormulaireConnexion";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Connexion — M3" };

export default async function PageConnexion({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const retour = cheminInterne(typeof sp.next === "string" ? sp.next : null);
  /* Déjà connecté : pas de formulaire, on va là où l'on allait. */
  let deja = null;
  try { deja = await utilisateurCourant(); } catch { /* base injoignable : la page s'affiche, la soumission dira « Serveur injoignable » */ }
  if (deja) redirect(retour === "/" ? "/console" : retour);

  void authMode();
  const modes = { local: Boolean(localEnabled()), entra: Boolean(entraEnabled()) };
  const erreur = messageErreurSso(typeof sp.err === "string" ? sp.err : null);

  return (
    <main className="cr lg">
      <FormulaireConnexion modes={modes} retour={retour} erreurInitiale={erreur} />
    </main>
  );
}
