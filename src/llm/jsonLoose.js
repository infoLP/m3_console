/* Lecture tolérante d'une réponse censée être du JSON.

   Tous les modèles ne respectent pas `response_format: json_object` — Anthropic
   ne connaît pas ce paramètre du tout, et beaucoup de modèles ouverts servis par
   une passerelle l'ignorent. Ils encadrent alors l'objet d'un ```json … ``` ou
   d'une phrase de politesse.

   Plutôt que de laisser l'appel échouer et retomber sur le mock pour une simple
   enveloppe, on récupère l'objet. Rend `null` si rien d'exploitable : l'appelant
   distingue ainsi « pas du JSON » d'un JSON valide mais vide. */

export function parseJsonLoose(content) {
  const raw = String(content || "").trim();
  if (!raw) return null;

  const tries = [raw];

  /* Bloc de code, avec ou sans étiquette de langage. */
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) tries.push(fenced[1].trim());

  /* Dernier recours : du premier { au dernier }. Sur du texte encadrant une
     réponse bien formée, cela suffit ; sur deux objets collés, cela échoue —
     et c'est préféré à un découpage qui inventerait une structure. */
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) tries.push(raw.slice(first, last + 1));

  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
    } catch { /* on essaie la forme suivante */ }
  }
  return null;
}
