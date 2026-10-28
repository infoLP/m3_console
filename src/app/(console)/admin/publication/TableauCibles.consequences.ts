// Conséquences écrites des gestes destructeurs de l'onglet Publication (M3-53).

export function consequenceDesactivation(nom: string, parDefaut: boolean): string {
  return `La cible « ${nom} » ne recevra plus d'article et ne sera plus proposée.${parDefaut ? " Elle est la cible par défaut : il faudra en désigner une autre." : ""} Les publications déjà faites gardent l'adresse du site. Vous pourrez la réactiver.`;
}

export function consequenceSuppression(nom: string): string {
  return `La cible « ${nom} » et son mot de passe d'application enregistré seront supprimés définitivement. Les publications déjà faites gardent l'adresse du site. Les articles déjà envoyés restent sur WordPress.`;
}
