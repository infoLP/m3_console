import { SCOPE_LEVELS, zoneText } from "@shared/zones.js";
import type { Demande } from "@/gererSources/gererSources.regles";

export type { Demande };

/* Détail d'une demande (M3-92) : les champs d'une source, ceux que le
   demandeur a remplis seulement. */
export function detailsDemande(t: Demande): string[] {
  const niveaux = SCOPE_LEVELS as Record<string, string>;
  return [
    t.organisation && `Organisation : ${t.organisation}`,
    t.sourceKind && `Volet : ${t.sourceKind === "private" ? "privé" : "public"}`,
    t.type && `Type : ${t.type}`,
    t.category && `Catégorie : ${t.category}`,
    t.commune && `Commune : ${t.commune}`,
    t.scopeLevel && `Niveau : ${niveaux[t.scopeLevel] || t.scopeLevel}`,
    (t.dept || t.region) && `Zone : ${zoneText(t)}`,
    t.frequency && `Fréquence : ${t.frequency}`,
  ].filter((x): x is string => Boolean(x));
}
