/* Relecture automatique (M3-89) : un second modèle compare l'article généré à
   sa source, juge et explique. Il ne réécrit pas : son verdict sert à affiner
   l'agent de génération (prompt, réglages, choix du modèle — M3-88), pas à
   corriger les articles un par un. */

import { asBlocks } from "../../../shared/model.js";

/* Une source très longue coûterait cher à chaque relecture ; la matière utile
   d'un communiqué tient bien en deçà. */
export const SOURCE_MAX_CHARS = 12000;

/* Consignes de rédaction confiées à la relecture (M3-113, décision 5) : rien
   d'autre ne les mesure. Clés fixes, dans l'ordre du panneau, avec la consigne
   telle que le prompt de relecture la résume (template.js:107-137). */
export const CONSIGNES = [
  ["style_phrases_creuses", "aucune phrase creuse"],
  ["chapo_factuel", "chapô factuel, non répété au 1er paragraphe"],
  ["fin_concrete", "fin sur un fait concret"],
  ["angle", "ouvre sur ce qui touche le lecteur, pas l'ordre de la source"],
  ["communique_non_explique", "n'explique pas ce qu'est un communiqué"],
  ["date_redigee", "date explicite si la source la donne, pas « récemment », année juste"],
  ["partenaire_signale", "contenu partenaire dit comme tel ; null sinon"],
];
export const CLES_CONSIGNES = CONSIGNES.map(([k]) => k);

export const SYSTEM = `Tu es secrétaire de rédaction dans un média local français. Tu relis un article
rédigé par une IA à partir d'une source, et tu le compares à cette source. Tu ne réécris pas
l'article : tu juges, tu cites les passages fautifs et tu expliques. Tu es exigeant sur la
fidélité aux faits et sur la langue française. Tu réponds uniquement en JSON.`;

function articleText(a) {
  const body = asBlocks(a?.body).map((b) => (b.type === "p" ? b.text : `[${b.type}] ${b.text}`)).join("\n");
  return `TITRE : ${a?.title || ""}\nCHAPÔ : ${a?.chapo || ""}\nCORPS :\n${body}`;
}

export function userPrompt(sourceText, article) {
  const src = String(sourceText || "");
  const cut = src.length > SOURCE_MAX_CHARS ? `${src.slice(0, SOURCE_MAX_CHARS)}\n[… source tronquée]` : src;
  return `SOURCE :
${cut}

ARTICLE GÉNÉRÉ :
${articleText(article)}

Vérifie :
1. HALLUCINATIONS : toute information de l'article absente de la source ou contraire à elle —
   chiffre, date, lieu, nom, fonction, citation (une citation doit être MOT POUR MOT dans la
   source), lien de cause, ou portée locale ajoutée.
2. FAUTES : orthographe, grammaire, accords, typographie française (espaces avant « ; : ! ? »,
   guillemets « », majuscules), répétitions lourdes.
3. Le verdict : « ok » (publiable en l'état), « a_corriger » (fautes ou imprécisions
   mineures), « rejet » (au moins une hallucination, ou contresens).
4. Une suggestion concrète pour améliorer la CONSIGNE donnée au rédacteur (pas l'article),
   ou une chaîne vide si rien n'est à changer.
5. CONSIGNES : ok true (tenue), false (enfreinte : cite l'extrait), null (sans objet).
${CONSIGNES.map(([k, d]) => `   ${k} : ${d}`).join("\n")}

Réponds en JSON :
{
  "verdict": "ok|a_corriger|rejet",
  "fidelite": 0-100,
  "hallucinations": [{"extrait": "passage de l'article", "explication": "ce que dit la source"}],
  "fautes": [{"extrait": "passage fautif", "correction": "forme correcte"}],
  "resume": "diagnostic en une ou deux phrases",
  "suggestion_prompt": "...",
  "consignes": [{"cle": "...", "ok": true|false|null, "extrait": "si false"}]
}`;
}

const VERDICTS = ["ok", "a_corriger", "rejet"];
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* Verdict par consigne (M3-113). Tolérant : sans tableau, ou sans entrée
   reconnue → undefined (le panneau dit « non mesuré ») ; clé inconnue ou en
   double ignorée ; ok autre qu'un booléen → null. Ne touche pas au verdict. */
export function normalizeConsignes(list) {
  if (!Array.isArray(list)) return undefined;
  const vus = new Map();
  for (const c of list) {
    const cle = String(c?.cle ?? "");
    if (!CLES_CONSIGNES.includes(cle) || vus.has(cle)) continue;
    const ok = typeof c.ok === "boolean" ? c.ok : null;
    const extrait = ok === false ? str(c?.extrait, 300) : "";
    vus.set(cle, extrait ? { cle, ok, extrait } : { cle, ok });
  }
  return vus.size ? CLES_CONSIGNES.filter((k) => vus.has(k)).map((k) => vus.get(k)) : undefined;
}

/* Réponse du modèle → verdict borné. Un verdict inconnu ne passe pas pour
   « ok » : une relecture illisible ne vaut pas validation. Une hallucination
   relevée impose au moins « rejet », quoi qu'en dise le champ verdict. */
export function normalizeReview(j) {
  const hallucinations = (Array.isArray(j?.hallucinations) ? j.hallucinations : []).slice(0, 10)
    .map((h) => ({ extrait: str(h?.extrait, 300), explication: str(h?.explication, 400) }))
    .filter((h) => h.extrait || h.explication);
  const fautes = (Array.isArray(j?.fautes) ? j.fautes : []).slice(0, 20)
    .map((f) => ({ extrait: str(f?.extrait, 200), correction: str(f?.correction, 200) }))
    .filter((f) => f.extrait);
  let verdict = VERDICTS.includes(j?.verdict) ? j.verdict : "a_corriger";
  if (hallucinations.length) verdict = "rejet";
  const n = Number(j?.fidelite);
  const consignes = normalizeConsignes(j?.consignes);
  return {
    verdict,
    fidelite: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null,
    hallucinations,
    fautes,
    resume: str(j?.resume, 600),
    suggestionPrompt: str(j?.suggestion_prompt, 600),
    ...(consignes ? { consignes } : {}),
  };
}

/* Recadrage d'une relance (M3-55) : ce que la relecture précédente a reproché,
   ajouté APRÈS le prompt de génération rendu — même place que la correction des
   règles (M3-87), donc quel que soit le modèle de prompt du moteur. Les
   hallucinations sont citées nommément : c'est ce qu'il ne faut plus écrire. */
export function recadragePrompt(review) {
  const h = (review?.hallucinations || []).slice(0, 10)
    .map((x) => `- « ${x.extrait} »${x.explication ? ` : ${x.explication}` : ""}`);
  return `

RECADRAGE OBLIGATOIRE — une version précédente de cet article a été REJETÉE par la
relecture (verdict : ${review?.verdict || "rejet"}), car elle contenait des informations
absentes de la source ou contraires à elle.
${h.length ? `Passages en cause :\n${h.join("\n")}\n` : ""}${review?.resume ? `Diagnostic : ${review.resume}\n` : ""}${review?.suggestionPrompt ? `Consigne : ${review.suggestionPrompt}\n` : ""}Écris l'article en t'en tenant STRICTEMENT aux faits de la source : aucun chiffre, date,
lieu, nom, fonction, citation ou lien de cause qui n'y figure pas.`;
}
