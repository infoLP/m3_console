// Suivre une demande au moteur (T17) : règles pures de l'écran. Une demande
// longue (régénération, publication, récolte) rend 202 et son id ; le
// navigateur la relit jusqu'à sa fin (composants/SuiviDemande).

export type Demande = {
  id: number;
  kind: string;
  requestedBy: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
};

export type EtatDemande = "attente" | "cours" | "finie" | "echec";

export function etatDemande(d: Pick<Demande, "startedAt" | "finishedAt" | "error">): EtatDemande {
  if (d.finishedAt) return d.error ? "echec" : "finie";
  return d.startedAt ? "cours" : "attente";
}

export const LIBELLE_ETAT: Record<EtatDemande, string> = {
  attente: "En attente du moteur",
  cours: "En cours",
  finie: "Terminée",
  echec: "Échec",
};

export const TON_ETAT: Record<EtatDemande, "neutre" | "brand" | "go" | "stop"> = {
  attente: "neutre",
  cours: "brand",
  finie: "go",
  echec: "stop",
};

export function estFinie(d: Pick<Demande, "finishedAt"> | null): boolean {
  return !!d?.finishedAt;
}

// Sondage : vite au début (une demande interactive finit en quelques
// secondes), puis toutes les 5 s pour une génération qui en prend vingt minutes.
export function delaiSondage(tentative: number): number {
  if (tentative < 10) return 1000;
  if (tentative < 40) return 2000;
  return 5000;
}
