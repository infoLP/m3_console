// Règles pures des comptes : un nouveau compte, la longueur d'un mot de passe,
// ce qui n'est pas encore enregistré.

export interface Compte {
  id: string;
  name: string;
  login: string;
  role: string;
  /* Lecture seule : le mot de passe se définit à part. Absent d'un compte
     jamais enregistré. */
  canLogin?: boolean;
}

export const nouveauCompte = (): Compte => ({ id: "u-" + Date.now(), name: "Nouvel utilisateur", login: "", role: "relecteur" });

export const MOT_DE_PASSE_MIN = 8;

export function motDePasseAcceptable(mdp: string): string | null {
  return mdp.length >= MOT_DE_PASSE_MIN ? null : `${MOT_DE_PASSE_MIN} caractères minimum.`;
}

/* Comparés à la référence lue au chargement, champ à champ ; canLogin n'entre
   pas dans « modifié » : définir un mot de passe ne touche pas aux champs. */
export function comptesModifies(comptes: Compte[], reference: Compte[]): boolean {
  const cle = (l: Compte[]) => JSON.stringify(l.map(({ id, name, login, role }) => ({ id, name, login, role })));
  return cle(comptes) !== cle(reference);
}
