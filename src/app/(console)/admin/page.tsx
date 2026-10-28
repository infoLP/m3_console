// /admin — onglet Sources (premier onglet, comme avant). `?demande=<id>` arrive
// de l'onglet Tickets : la source pré-remplie est proposée en tête, non
// enregistrée, et la demande reste ouverte jusqu'à « marquer traité ».
// `?candidat=<id>` arrive de Sources → Concurrents (M3-122, « Créer la source ») :
// même brouillon, et le candidat passe à « ajouté » quand la source est enregistrée.
// Filtres et recherche vivent dans l'URL (M3-110, B3) : lus ici pour le premier
// rendu, tenus à jour ensuite par le client sans rechargement.

import { lireSourcesDatees } from "@/gererSources/gererSources.requetes";
import { lireDemandes } from "@/traiterDemandes/traiterDemandes.requetes";
import { filtresDepuisUrl, memeAdresse, sourceDepuisDemande, type Source } from "@/gererSources/gererSources.regles";
import { TableauSources } from "./TableauSources";
import { exigerDroit } from "@/session";
import { SousNavSources } from "./concurrents/SousNavSources";
import { lireCandidats } from "@/gererConcurrents/gererConcurrents.requetes";
import { sourceDepuisCandidat, sourcePourDomaine, STATUTS } from "@/gererConcurrents/gererConcurrents.regles";

export default async function PageSources({ searchParams }: PageProps<"/admin">) {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  const compte = await exigerDroit("backoffice", "/admin");
  const sp = await searchParams;
  const { sources, reliability, lueA } = await lireSourcesDatees();
  let brouillon: Source | null = null;
  let message: string | null = null;
  const idDemande = typeof sp.demande === "string" ? sp.demande : null;
  if (idDemande) {
    const { tickets } = await lireDemandes({});
    const t = tickets.find((x) => x.id === idDemande);
    if (t && memeAdresse(sources, t)) message = "Une source à cette adresse existe déjà dans l'onglet Sources";
    else if (t) { brouillon = sourceDepuisDemande(t); message = "Source pré-remplie depuis la demande, inactive — relisez-la, puis « Enregistrer »"; }
  }
  const idCandidat = typeof sp.candidat === "string" ? Number(sp.candidat) : NaN;
  if (!brouillon && Number.isInteger(idCandidat)) {
    /* Le candidat peut être nouveau ou déjà proposé par le superutilisateur. */
    const listes = await Promise.all(STATUTS.filter(([k]) => k === "nouveau" || k === "propose")
      .map(([status]) => lireCandidats({ query: { status } })));
    const c = listes.flatMap((l) => l.candidates).find((x) => x.id === idCandidat);
    if (!c) message = "Ce domaine candidat n'est plus à traiter (déjà ajouté ou écarté)";
    else if (sourcePourDomaine(sources, c.domain)) message = `Une source du domaine ${c.domain} existe déjà dans l'onglet Sources`;
    else { brouillon = sourceDepuisCandidat(c); message = "Source pré-remplie depuis le domaine candidat, inactive — relisez-la, puis « Enregistrer »"; }
  }
  return (
    <>
      {/* M3-120 : Sources | Concurrents. */}
      <SousNavSources role={compte.role} />
      <TableauSources initiales={sources} fiabilite={reliability || {}} brouillon={brouillon} messageBrouillon={message}
        filtresInitiaux={filtresDepuisUrl(sp)} maintenant={lueA} />
    </>
  );
}
