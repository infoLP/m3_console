/* Provider LLM "mock" — déterministe, sans réseau.
   Exécute réellement tout le pipeline (extraction heuristique, gabarit de rédaction,
   calcul de proximité anti-plagiat) pour que le prototype tourne sans clé.
   Règle : la longueur suit la matière disponible — pas de remplissage, pas de
   méta-commentaire sur ce qu'est un communiqué de presse. */

import { substantiveSentences, splitSentences } from "../generate/quality.js";
import { classifyCategory } from "../generate/classify.js";
import { stripDateNoise } from "../generate/dates.js";

function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/* rubrique via le classifieur partagé (tokenisé, pas de faux positif « équipements »→« équipe ») */
function pickCategory(text) {
  const c = classifyCategory(text);
  return c.score > 0 ? c.cat : "Société";
}

function slugify(str) {
  return String(str)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .split("-").slice(0, 8).join("-");
}

function trigrams(str) {
  const s = String(str).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
  return set;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function extractFromSource(rawText, { sourceType } = {}) {
  // On ne garde que les phrases porteuses d'information (boilerplate juridique retiré).
  let ss = substantiveSentences(rawText);
  if (ss.length === 0) {
    const all = splitSentences(rawText);
    ss = all.length ? [all[0]] : ["Information transmise par la source."];
  }
  const quotes = [];
  const qre = /[«"“]([^»"”]{15,240})[»"”]/g;
  let m;
  while ((m = qre.exec(String(rawText))) && quotes.length < 4) {
    const t = m[1].trim();
    if (t.split(" ").length >= 3) quotes.push({ speaker: "un porte-parole", text: t });
  }
  const entities = Array.from(new Set(
    (String(rawText).match(/\b([A-ZÀ-Þ][a-zà-ÿ]+(?:[ -][A-ZÀ-Þ][a-zà-ÿ]+){0,3})\b/g) || [])
  )).filter((e) => e.length > 4).slice(0, 8);

  const facts = ss.slice(0, 7).map(cleanFact);
  const titleHint = makeTitleHint(facts[0] || "Information locale");
  const communes = (String(rawText).match(/\b(La Rochelle|Rochefort|Saintes|Royan|Niort|Angoulême|Périgueux|Bordeaux)\b/gi) || []);
  return {
    title_hint: titleHint,
    facts,
    quotes,
    entities,
    locality: communes[0] || "",
    angle: firstWords(facts[0] || "", 26) || "Un fait d'actualité local.",
    suggested_category: pickCategory(facts.join(" ")),
    substance: facts.length <= 2 ? "mince" : "riche",
    _sourceType: sourceType || "inconnu",
  };
}

const CONNECTORS = [
  "Dans le détail, ", "Concrètement, ", "Par ailleurs, ",
  "Du côté des acteurs concernés, ", "À noter, ",
];

const MOCK_H2 = [
  "Ce que dit la source",
  "Les enjeux pour le territoire",
  "Le calendrier annoncé",
  "Les suites attendues",
];
const MOCK_H2_EVERY = 2;

export async function generateArticle(extracted, { mode, region, altPrompt } = {}) {
  const facts = (extracted.facts || []).slice(0, 7).map((f) => cleanFact(String(f).replace(/\s+/g, " ").trim()));
  const cat = extracted.suggested_category || pickCategory(facts.join(" ")) || "Société";
  const seed = hashInt(JSON.stringify(facts) + (altPrompt || ""));
  const thin = facts.length <= 2 || extracted.substance === "mince";

  /* Un paragraphe par fait ; connecteur en préfixe une fois sur deux (jamais sur le 1er).
     Un intertitre est posé toutes les MOCK_H2_EVERY paragraphes, jamais avant le
     premier : le mock doit produire la même FORME que le vrai moteur, sinon il ne
     sert plus de repli fidèle — c'est précisément ce qui avait laissé passer
     l'absence d'intertitres. */
  const body = [];
  facts.forEach((f, i) => {
    let para = mode === "press" ? paraphrase(f, seed + i) : f;
    if (i > 0 && !thin && (seed + i) % 2 === 0) para = CONNECTORS[(seed + i) % CONNECTORS.length] + lower1(para);
    if (!/[.!?…]$/.test(para)) para += ".";
    if (extracted.quotes[i] && !thin) para += ` « ${extracted.quotes[i].text} », précise ${extracted.quotes[i].speaker}.`;
    if (!thin && i > 0 && i % MOCK_H2_EVERY === 0) {
      body.push({ type: "h2", text: MOCK_H2[((seed + i) / MOCK_H2_EVERY | 0) % MOCK_H2.length] });
    }
    body.push({ type: "p", text: para });
  });
  if (body.length === 0) body.push({ type: "p", text: "Information transmise par la source, sans détail supplémentaire." });

  const title = capitalize(cleanTitle(mode === "press" ? reformulate(extracted.title_hint, seed) : extracted.title_hint));
  const chapo = clampSentence(firstWords(facts[0] || extracted.angle || title, 32), 240);
  const kw = keywordsFrom(extracted, cat);
  const metaDesc = buildMetaDesc(chapo, facts[1] || facts[0]);

  return {
    title,
    chapo,
    body,
    category: cat,
    suggested_ranking: thin ? 40 + (seed % 22) : 55 + (seed % 33),
    ranking_reason: `Sujet ${cat.toLowerCase()} ${thin ? "à matière limitée" : "à ancrage local"} ; ${mode === "press" ? "réécriture d'un article de presse" : "issu d'une source officielle"}. Alignement estimé automatiquement (mock).`,
    seo: {
      metaTitle: title.slice(0, 60),
      metaDescription: metaDesc,
      slug: slugify(title),
      keywords: kw,
    },
  };
}

export async function checkPlagiarism(sourceText, generatedText) {
  const a = trigrams(sourceText);
  const b = trigrams(generatedText);
  const score = Math.round(jaccard(a, b) * 100) / 100;
  const verdict = score > 0.35 ? "risque" : "ok";
  const spans = [];
  if (verdict === "risque") {
    for (const s of splitSentences(generatedText)) {
      if (jaccard(trigrams(s), a) > 0.5) spans.push(s.slice(0, 180));
      if (spans.length >= 3) break;
    }
  }
  return { score, verdict, spans };
}

/* Relecture (M3-89), version déterministe : sert aux tests et à essayer la
   chaîne sans payer de second modèle. Elle ne relève qu'une hallucination
   mécanique — un nombre de l'article absent de la source — et deux fautes de
   typographie. Elle ne juge ni le sens ni la langue : son verdict ne remplace
   pas celui d'un vrai modèle. */
export async function reviewArticle(sourceText, article) {
  const src = String(sourceText || "");
  const text = [article?.title, article?.chapo, ...(Array.isArray(article?.body) ? article.body.map((b) => (typeof b === "string" ? b : b?.text)) : [])]
    .filter(Boolean).join("\n");
  const srcNums = new Set((src.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) || []));
  const nums = [...new Set(text.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1").match(/\d+(?:[.,]\d+)?/g) || [])];
  const hallucinations = nums.filter((n) => !srcNums.has(n)).slice(0, 5)
    .map((n) => ({ extrait: n, explication: "nombre absent de la source (contrôle mécanique du mock)" }));
  const fautes = [];
  if (/ {2,}/.test(text)) fautes.push({ extrait: "double espace", correction: "une seule espace" });
  if (/\s,/.test(text)) fautes.push({ extrait: "espace avant la virgule", correction: "pas d'espace avant « , »" });
  const verdict = hallucinations.length ? "rejet" : fautes.length ? "a_corriger" : "ok";
  return {
    verdict,
    fidelite: Math.max(0, 100 - 20 * hallucinations.length),
    hallucinations,
    fautes,
    resume: verdict === "ok" ? "Aucun écart mécanique relevé (relecture mock)." : `${hallucinations.length} nombre(s) absent(s) de la source, ${fautes.length} faute(s) de typographie (relecture mock).`,
    suggestionPrompt: "",
  };
}

/* --- helpers --- */
/* Retire le tunnel juridique / identifiants boursiers d'une phrase de fait. */
function cleanFact(s) {
  return stripDateNoise(String(s))
    .replace(/\s*\(\s*euronext[^)]*\)/gi, "")
    .replace(/\s*[–-]?\s*isin\s*:?\s*[a-z]{2}\s?[\d ]{6,}/gi, "")
    .replace(/,?\s*annonce\s+(?:aujourd['’]hui\s+)?avoir\b/gi, " a")
    .replace(/,?\s*annonce\s+(?:aujourd['’]hui\s+)?(?=\w)/gi, " annonce ")
    .replace(/\s+[ée]mises?\s+par\s+la\s+soci[ée]t[ée][^.]*/gi, "")
    .replace(/\s+conform[ée]ment\s+au\s+r[èe]glement[^.]*/gi, "")
    .replace(/\s+,/g, ",").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ")
    .trim();
}
function firstWords(s, n) {
  const w = String(s).replace(/\s+/g, " ").trim().split(" ");
  if (w.length <= n) return w.join(" ");
  let head = w.slice(0, n);
  while (head.length > 8 && /^(de|du|des|la|le|les|un|une|à|en|pour|par|et|d['’]|au|aux|dans|sur|avec|qui|que)$/i.test(head[head.length - 1])) head.pop();
  return head.join(" ").replace(/[,;:]$/, "") + "…";
}
function clampSentence(s, max) {
  let t = String(s).replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return t + (/[…!?]$/.test(t) ? "" : ".");
}
function buildMetaDesc(chapo, extraFact) {
  let d = chapo.replace(/[.…]+$/, "");
  if (d.length < 70 && extraFact) {
    const add = String(extraFact).replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
    if (!d.includes(add.slice(0, 30))) d += ". " + add;
  }
  if (d.length > 158) d = d.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return d.replace(/[.…]*$/, ".");
}
function makeTitleHint(sentence) {
  let s = String(sentence)
    .replace(/^\s*(publié le[^.]*?\d{4}|actualités?|communiqué de presse|à la une)\s*[:–-]?\s*/i, "")
    .replace(/\(euronext[^)]*\)/gi, "")
    .replace(/[–-]?\s*isin\s*:?\s*[a-z]{2}\s?[\d ]{6,}/gi, "")
    .replace(/\bS\.?A\.?\b/g, "")
    .replace(/,?\s*annonce\s+aujourd['’]hui\s+avoir\b/gi, " a")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(" ");
  if (words.length > 13) {
    let w = words.slice(0, 13);
    while (w.length > 6 && /^(de|du|des|la|le|les|un|une|à|en|pour|par|et|d['’]|au|aux|dans|sur|avec)$/i.test(w[w.length - 1])) w.pop();
    s = w.join(" ").replace(/[,;:]$/, "") + "…";
  }
  return s.replace(/[.]+$/, "").slice(0, 90) || "Information locale";
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function lower1(s) { return s.charAt(0).toLowerCase() + s.slice(1); }
function cleanTitle(s) { return String(s).replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/[.]+$/, "").trim().slice(0, 90); }
function paraphrase(s, seed) {
  const words = String(s).replace(/[«»""]/g, "").replace(/\s+/g, " ").trim().replace(/[.]$/, "").split(" ");
  const lead = ["D'après nos informations", "Selon plusieurs sources locales", "Il apparaît que", "On retiendra que"][seed % 4];
  const core = words.slice(0, Math.max(8, Math.round(words.length * 0.75))).join(" ");
  return `${lead}, ${lower1(core)}.`;
}
function reformulate(s, seed) {
  const prefixes = ["", "Local : ", "Territoire — "];
  return prefixes[seed % prefixes.length] + s;
}
function keywordsFrom(extracted, cat) {
  const base = [cat.toLowerCase()];
  for (const e of extracted.entities || []) {
    const w = e.toLowerCase();
    if (w.length > 4 && !base.includes(w)) base.push(w);
    if (base.length >= 5) break;
  }
  while (base.length < 3) base.push(["local", "charente-maritime", "actualité"][base.length % 3]);
  return base.slice(0, 6);
}
