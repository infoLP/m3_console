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
  attente?: Attente | null;
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

// T19c : ce qu'une demande pas encore démarrée attend (suivreDemande.api.js).
export type Attente = {
  vivant: boolean;
  voie: string;
  enCours: { id: number; kind: string; depuis: string | null } | null;
};

const TRAVAIL: Record<string, string> = {
  harvest: "une récolte",
  generate: "une génération",
  regenerate: "une autre régénération",
  rescore: "un recalcul des scores",
  test_models: "un test des modèles",
  restore_sources: "une restauration des sources",
  publish: "une autre publication",
};

// Phrase à afficher pendant l'attente, ou null s'il n'y a rien à expliquer.
export function texteAttente(d: (Pick<Demande, "id" | "startedAt" | "finishedAt"> & { attente?: Attente | null }) | null): string | null {
  if (!d || d.startedAt || d.finishedAt || !d.attente) return null;
  if (!d.attente.vivant) return "Le moteur ne répond pas : la demande partira à son redémarrage.";
  const e = d.attente.enCours;
  if (!e) return null;
  return `En attente : le moteur termine ${TRAVAIL[e.kind] || `une demande « ${e.kind} »`} (n° ${e.id}), la vôtre partira ensuite.`;
}

// Refus « bail tenu » (src/lib/runLock.js du moteur) : une routine planifiée ou
// une exécution manuelle tient la chaîne. Dit en clair, sans le détail technique.
export const BAIL_TENU = /^Une exécution est déjà en cours/;

export function messageEchec(d: Pick<Demande, "kind" | "error"> | null): string | null {
  if (!d?.error) return null;
  if (BAIL_TENU.test(d.error)) {
    const quoi = d.kind === "regenerate" ? "La régénération n'a pas été lancée" : "La demande n'a pas été lancée";
    return `${quoi} : une routine (récolte et génération) est en cours sur le moteur. Réessayez quand elle sera terminée.`;
  }
  return d.error;
}
