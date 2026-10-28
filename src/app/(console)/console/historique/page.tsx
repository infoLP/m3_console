// /console/historique — rechargé à chaque ouverture : l'outil est partagé, une
// décision prise entre-temps dans une autre session doit apparaître. Les filtres
// (catégorie, recherche) sont dans l'URL (M3-109) ; la pagination n'y est pas.

import { exigerUtilisateur } from "@/session";
import { lireHistorique } from "@/consulterHistorique/consulterHistorique.requetes";
import { filtresHistoriqueDepuis } from "@/consulterHistorique/consulterHistorique.regles";
import { Historique } from "./Historique";

export default async function PageHistorique({ searchParams }: PageProps<"/console/historique">) {
  await exigerUtilisateur("/console/historique");
  const filtres = filtresHistoriqueDepuis(await searchParams);
  const initial = await lireHistorique(filtres);
  return <Historique initial={initial} filtres={filtres} />;
}
