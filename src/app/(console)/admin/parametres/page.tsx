import { lireIcone, lireReglages } from "@/gererReglages/gererReglages.requetes";
import { FormulaireReglages } from "./FormulaireReglages";
import { exigerDroit } from "@/session";

export default async function PageReglages() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const [{ settings, specs, stored }, { icon }] = await Promise.all([lireReglages({}), lireIcone({})]);
  return <FormulaireReglages settings={settings} specs={specs} stored={stored} icone={icon} />;
}
