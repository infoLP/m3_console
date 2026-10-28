import "server-only";
import { action } from "@/pont";
import * as meta from "@/api/meta.js";
import * as llm from "@/api/llm.js";
import { avecMoteurs, type Icone, type Specs } from "./gererReglages.regles";

const lire = action<{ settings: Record<string, unknown>; specs: Specs; stored: string[] }>(meta.settings);
const lireMoteurs = action<{ providers: { id: string }[] }>(llm.list);

/* Les réglages qui désignent un moteur (secours, relecture) s'affichent en
   liste des moteurs du registre. Registre illisible : la page s'affiche quand
   même, ces réglages restent saisissables. */
export async function lireReglages(appel: Parameters<typeof lire>[0] = {}) {
  const [r, m] = await Promise.all([lire(appel), lireMoteurs({}).catch(() => null)]);
  return { ...r, specs: avecMoteurs(r.specs, m?.providers || [], r.settings) };
}
export const lireIcone = action<{ icon: Icone | null }>(meta.siteIcon);
