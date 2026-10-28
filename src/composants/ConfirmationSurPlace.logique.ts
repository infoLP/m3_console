// Logique de ConfirmationSurPlace (axe B4), sans React ni DOM, pour être testée.
//
//   repos ──ouvrir──▶ confirmation ──confirmer──▶ en_cours ──reussite──▶ repos
//                       │  ▲                          │
//      annuler / Échap  │  └──────────echec───────────┘  (l'erreur s'affiche,
//                       ▼                                  on peut réessayer)
//                     repos
//
// Pendant en_cours, ni Annuler ni Échap n'agissent : l'action est partie, la
// fermer ferait croire qu'elle est annulée.

export type EtatConfirmation =
  | { phase: "repos" }
  | { phase: "confirmation"; erreur: string | null }
  | { phase: "en_cours" };

export type EvenementConfirmation =
  | { type: "ouvrir" }
  | { type: "annuler" }
  | { type: "touche"; touche: string }
  | { type: "confirmer" }
  | { type: "reussite" }
  | { type: "echec"; message: string };

export const ETAT_INITIAL: EtatConfirmation = { phase: "repos" };

export function transition(etat: EtatConfirmation, ev: EvenementConfirmation): EtatConfirmation {
  switch (etat.phase) {
    case "repos":
      return ev.type === "ouvrir" ? { phase: "confirmation", erreur: null } : etat;
    case "confirmation":
      if (ev.type === "annuler" || (ev.type === "touche" && ev.touche === "Escape")) return { phase: "repos" };
      if (ev.type === "confirmer") return { phase: "en_cours" };
      return etat;
    case "en_cours":
      if (ev.type === "reussite") return { phase: "repos" };
      if (ev.type === "echec") return { phase: "confirmation", erreur: ev.message };
      return etat;
  }
}

/** Où poser le focus après une transition : sur Annuler à l'ouverture, sur le
 *  déclencheur au retour au repos, nulle part sinon (on ne déplace pas le focus
 *  sous les doigts de quelqu'un sans raison). */
export function cibleFocus(avant: EtatConfirmation, apres: EtatConfirmation): "annuler" | "declencheur" | null {
  if (avant.phase === "repos" && apres.phase === "confirmation") return "annuler";
  if (avant.phase === "en_cours" && apres.phase === "confirmation") return "annuler";
  if (avant.phase !== "repos" && apres.phase === "repos") return "declencheur";
  return null;
}

/** Texte d'erreur lisible à partir de ce que onConfirm a rejeté. */
export function messageEchec(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  return "L'action a échoué. Rien n'a été modifié de votre côté : vous pouvez réessayer.";
}
