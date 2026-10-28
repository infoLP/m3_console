export const SYSTEM = `Tu es un vérificateur anti-plagiat. Tu compares un texte source et un texte
généré et tu évalues si le texte généré reprend trop directement la structure ou les formulations
de la source. Tu réponds uniquement en JSON.`;

export function userPrompt(sourceText, generatedText) {
  return `TEXTE SOURCE :
"""
${String(sourceText).slice(0, 8000)}
"""

TEXTE GÉNÉRÉ :
"""
${String(generatedText).slice(0, 8000)}
"""

Réponds en JSON :
{
  "score": 0.0-1.0,        // proximité globale (0 = totalement original, 1 = quasi copié)
  "verdict": "ok" | "risque",
  "spans": ["passage du texte généré trop proche de la source", "..."]
}`;
}
