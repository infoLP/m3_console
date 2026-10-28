// /admin/concurrents — sous-onglet Sources → Concurrents (M3-120, lot 1 de M3-119) :
// les sites concurrents dont on analysera les articles pour y trouver des
// sources. Ouvert à l'administrateur et au superutilisateur (droit
// manage_competitors) ; les autres rôles sont renvoyés à la console, et l'API
// leur répond 403.
// M3-122 : bandeau du scan, bouton « Lancer le scan », domaines candidats.

import { lireCandidats, lireConcurrents, lireEtatScan } from "@/gererConcurrents/gererConcurrents.requetes";
import { exigerDroit } from "@/session";
import { SousNavSources } from "./SousNavSources";
import { BandeauScan } from "./BandeauScan";
import { TableauConcurrents } from "./TableauConcurrents";
import { DomainesCandidats } from "./DomainesCandidats";

export default async function PageConcurrents() {
  /* La page rend en parallèle du layout : elle se garde elle-même. */
  const compte = await exigerDroit("manage_competitors", "/admin/concurrents");
  const [{ competitors }, { scan }, { candidates }] = await Promise.all([
    lireConcurrents({}), lireEtatScan({}), lireCandidats({ query: { status: "nouveau" } }),
  ]);
  return (
    <>
      <SousNavSources role={compte.role} />
      <BandeauScan initial={scan} role={compte.role} />
      {/* Clé = dernier scan : à la fin d'un scan, router.refresh() relit la page et
          les deux listes repartent des données neuves (leur état local vient de
          ces propriétés au premier rendu seulement). */}
      <TableauConcurrents key={`c-${scan?.last?.at ?? ""}`} initiaux={competitors} />
      <DomainesCandidats key={`d-${scan?.last?.at ?? ""}`} initiaux={candidates} role={compte.role} />
    </>
  );
}
