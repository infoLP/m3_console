// Conséquences écrites des actions destructives de l'onglet LLM (M3-109, B4).
// Lues dans le code : supprimer un moteur retire sa ligne et sa clé ; s'il est
// le moteur actif, le premier moteur activé le remplace, sinon il n'y a plus de
// moteur et la génération tourne sur le mock (deleteProvider, llmProviders.js).

export function consequenceSuppressionMoteur(label: string, actif: boolean): string {
  const base = `Le moteur « ${label} » et sa clé d'API enregistrée seront supprimés définitivement.`;
  return actif
    ? `${base} C'est le moteur actif : le premier moteur activé prendra sa place, à défaut la génération passera sur le mock.`
    : base;
}

export function consequenceRetraitCle(label: string): string {
  return `La clé d'API de « ${label} » sera effacée de la base. Le moteur ne pourra plus appeler le fournisseur tant qu'une nouvelle clé n'aura pas été saisie.`;
}

export function consequenceRetraitSecours(label: string): string {
  return `« ${label} » ne sera plus le moteur de secours : si le moteur actif échoue, la génération repassera directement sur le mock.`;
}
