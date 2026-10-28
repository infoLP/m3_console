import { lireMoteurs, lirePrompts } from "@/gererMoteursIA/gererMoteursIA.requetes";
import { CartesMoteurs } from "./CartesMoteurs";
import { PromptsGeneration } from "./PromptsGeneration";
import { exigerDroit } from "@/session";

export default async function PageMoteurs() {
  /* La page rend en parallèle du layout : elle se garde elle-même (lecture de
     session mémoïsée par requête, donc sans coût). */
  await exigerDroit("backoffice", "/admin");
  const [moteurs, prompts] = await Promise.all([lireMoteurs({}), lirePrompts({})]);
  return (
    <>
      <CartesMoteurs moteurs={moteurs} />
      {/* Prompts de génération (M3-56) : sous les moteurs, qu'ils surchargent. */}
      <PromptsGeneration data={prompts} moteurs={moteurs.providers} />
    </>
  );
}
