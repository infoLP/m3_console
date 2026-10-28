import "server-only";
import { action } from "@/pont";
import * as llm from "@/api/llm.js";
import * as meta from "@/api/meta.js";
import type { Moteurs, PromptsLLM } from "./gererMoteursIA.regles";

const liste = action<Moteurs>(llm.list);
const reglages = action<{ settings: Record<string, unknown> }>(meta.settings);
const prompts = action<PromptsLLM>(llm.prompts);

/* Le registre, plus le moteur de secours (M3-88) et celui de relecture (M3-89)
   désignés dans les réglages : l'onglet LLM montre ainsi le rôle de chacun.
   Réglages illisibles : l'onglet s'affiche sans l'indication. */
export async function lireMoteurs(appel: Parameters<typeof liste>[0] = {}): Promise<Moteurs> {
  const [m, r] = await Promise.all([liste(appel), reglages({}).catch(() => null)]);
  const txt = (k: string) => String(r?.settings?.[k] ?? "").trim();
  const id = txt("llm_fallback_provider");
  const relectureActive = r?.settings?.llm_review_enabled === "oui";
  const rel = relectureActive ? txt("llm_review_provider") : "";
  return {
    ...m,
    secoursId: id && id !== "aucun" ? id : null,
    relectureId: rel && rel !== "aucun" ? rel : null,
    relectureActive,
    /* Moteur + modèle (M3-88, M3-89) : vide = modèle par défaut du moteur. */
    secoursModel: txt("llm_fallback_model") || null,
    relectureModel: txt("llm_review_model") || null,
  };
}

/* Prompts de génération (M3-56) : versions courantes, variables, défaut du
   code et format verrouillé. Null si la lecture échoue (table pas encore
   migrée, base injoignable) : l'onglet affiche les moteurs et le dit. */
export async function lirePrompts(appel: Parameters<typeof prompts>[0] = {}): Promise<PromptsLLM | null> {
  return prompts(appel).catch(() => null);
}
