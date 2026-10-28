/* Libellé affiché dans la pastille d'une demande d'ajout de source. Le statut
   stocké (src/api/meta.js : « ouvert », « traite ») est une clé, pas un texte
   pour l'écran. Un statut inconnu s'affiche tel quel plutôt que de disparaître.
   Vit ici et non dans traiterDemandes.regles.ts, hors du périmètre de M3-99. */
const LIBELLES: Record<string, string> = {
  ouvert: "à traiter",
  traite: "traitée",
};

export function libelleStatut(statut: string): string {
  return LIBELLES[statut] ?? statut;
}
