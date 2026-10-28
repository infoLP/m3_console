// Conséquences écrites des actions destructives de l'onglet Utilisateurs (M3-109, B4).

const nom = (u: { name?: string; login?: string }) => u.name || u.login || "ce compte";

/* « Retirer » ne fait que sortir la ligne du tableau : le DELETE part à « Enregistrer ». */
export function consequenceRetraitCompte(u: { name?: string; login?: string }): string {
  return `Le compte « ${nom(u)} » sera supprimé à l'enregistrement. Tant que vous n'avez pas cliqué sur Enregistrer, rien n'est supprimé.`;
}

/* definirMotDePasse ferme les sessions ouvertes du compte (sessionsFermees). */
export function consequenceMotDePasse(u: { name?: string; login?: string }): string {
  return `Le mot de passe de « ${nom(u)} » sera remplacé immédiatement, et toutes ses sessions ouvertes seront fermées : la personne devra se reconnecter.`;
}
