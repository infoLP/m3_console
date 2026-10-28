export const SYSTEM = `Tu es un documentaliste de presse. À partir d'un contenu source brut (communiqué,
page institutionnelle, article, PDF), tu extrais les éléments factuels utiles à la rédaction d'un
article de presse local en français. Tu ne rédiges pas l'article. Tu réponds uniquement en JSON.`;

export function userPrompt(rawText, { sourceType } = {}) {
  return `Type de source : ${sourceType || "inconnu"}.

CONTENU SOURCE :
"""
${String(rawText).slice(0, 12000)}
"""

Consignes d'extraction :
- Exclus tout le boilerplate : mentions légales, disclaimers, déclarations prospectives,
  définition du communiqué lui-même, cadre réglementaire (Règlement UE, ISIN, Euronext,
  « le présent communiqué… »), et les mentions « Publié le … » / « Mis à jour le … ».
- Si la source ne contient qu'une information réelle, renvoie UN SEUL fait dans "facts".
- Ne complète jamais avec des généralités ou des suppositions.
- "locality" : la commune ou le département RÉELLEMENT concerné par le fait (pas
  celui de l'émetteur). Si le fait est national ou ne cite aucun lieu précis,
  réponds "national" ou "inconnu".
- "title_hint" : une accroche courte avec un verbe, pas la 1re phrase recopiée.

Réponds en JSON avec ce schéma :
{
  "title_hint": "titre de travail court, sans code ISIN ni forme juridique",
  "facts": ["fait 1 daté et chiffré", "fait 2", "..."],
  "quotes": [{"speaker": "fonction ou nom", "text": "citation exacte"}],
  "entities": ["organisations, lieux, personnes citées"],
  "locality": "commune ou département concerné, ou 'national' / 'inconnu'",
  "angle": "angle local pressenti en une phrase",
  "suggested_category": "Économie|Culture|Environnement|Société|Sport",
  "substance": "riche" | "mince"
}`;
}
