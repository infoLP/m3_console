import { filtresDepuis } from "@/consulterJournal/consulterJournal.regles";
import { lireJournal } from "@/consulterJournal/consulterJournal.requetes";
import { TableauJournal } from "./TableauJournal";
import { exigerDroit } from "@/session";

export default async function PageJournal({ searchParams }: PageProps<"/admin/journal">) {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const filtres = filtresDepuis(await searchParams);
  const journal = await lireJournal(filtres);
  /* La clé force un nouvel état client quand les filtres changent : la page
     suivante chargée pour d'autres filtres ne doit pas survivre. */
  return <TableauJournal key={JSON.stringify(filtres)} filtres={filtres} initial={journal} />;
}
