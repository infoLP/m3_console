// Conséquence écrite de « Purger les lues » (M3-109, B4). Le serveur supprime
// toutes les notifications marquées lues de la liste commune (purgeReadNotifications).

export function consequencePurge(nLues: number): string {
  const n = nLues > 1 ? `Les ${nLues} notifications lues seront supprimées` : "La notification lue sera supprimée";
  return `${n} pour tous les utilisateurs, définitivement. Les notifications non lues sont conservées.`;
}
