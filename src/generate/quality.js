/* Filtre qualité d'un item récupéré avant génération.
   Écarte les pages d'index, les embeds tiers, le contenu non francophone ou trop court.
   Fournit aussi un détecteur de boilerplate (mentions légales / communiqué) réutilisé
   par l'extraction du provider mock et par le pipeline. */

const FR_MARKERS = [" le ", " la ", " les ", " des ", " une ", " un ", " et ", " à ", " pour ", " dans ", " est ", " qui ", " sur "];
const JUNK_MARKERS = [
  "transform your documents", "cookie", "javascript", "enable javascript",
  "connect calaméo", "lorem ipsum", "©", "tous droits réservés",
];

/* langage publicitaire / promo → pas un contenu éditorial */
const PROMO_RE = /(\bofferts?\b.{0,40}\b(pour tout|dès|à partir)|code\s+promo|🎁|offre\s+valable|devis\s+gratuit|remboursé\s+à\s+\d|=\s*vos\b.{0,30}\boffert)/i;

/* Détection de contenu commercial / publicitaire — appliquée AVANT génération
   pour ne pas dépenser d'appels LLM sur une page marchande.
   Approche pondérée + seuil : un seul mot ne suffit jamais (« musée gratuit »,
   « cantine à 1 € », « subvention » sont de l'info locale légitime). */
const ADVERT_STRONG = [
  "code promo", "devis gratuit", "devis en ligne", "livraison offerte", "livraison gratuite",
  "essai gratuit", "sans engagement", "satisfait ou remboursé", "paiement en plusieurs fois",
  "abonnez-vous", "abonnez vous", "souscrivez dès", "commandez en ligne", "achetez en ligne",
  "profitez de l'offre", "offre speciale", "offre exceptionnelle", "offre de lancement",
  "jusqu'a epuisement des stocks", "voir conditions en magasin", "prix casses", "au meilleur prix",
  "contenu sponsorise", "article sponsorise", "publi-redactionnel", "publireportage", "publiredactionnel",
  "en partenariat commercial", "🎁", "€/mois", "€ / mois", "ttc/mois", "remise immediate",
];
const ADVERT_SOFT = [
  "promotion", "en promo", "soldes", "bon plan", "bon d'achat", "cash back", "cashback",
  "reservez des maintenant", "reservez vite", "reservez maintenant", "profitez-en", "profitez en",
  "decouvrez notre", "decouvrez nos offres", "nos offres", "notre boutique", "notre catalogue",
  "cliquez ici", "contactez-nous pour", "prendre rendez-vous en ligne", "tarif preferentiel",
  "a prix reduit", "cadeau offert", "reduction de", "-50%", "-30%", "-20%", "-10%",
];
const PRICE_RE = /(?:^|[\s(])-\d{1,3}\s?%|\d{1,4}(?:[.,]\d{2})?\s?€(?:\s?(?:ttc|ht|\/\s?mois|par\s?mois))?/gi;

function deacc(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function advertScore(raw) {
  const t = deacc(raw).slice(0, 6000);
  let score = 0;
  const hits = [];
  for (const m of ADVERT_STRONG) if (t.includes(deacc(m))) { score += 2; hits.push(m); }
  for (const m of ADVERT_SOFT) if (t.includes(deacc(m))) { score += 1; hits.push(m); }
  const prices = (String(raw || "").match(PRICE_RE) || []).length;
  if (prices >= 3) score += 2; else if (prices >= 1) score += 1;
  if (PROMO_RE.test(String(raw || "").slice(0, 1500))) score += 2;
  return { score, hits: hits.slice(0, 6), prices };
}

/* Contenu de partenaire (M3-85) : supplément co-édité, contenu de marque. SIGNALÉ,
   jamais écarté — « en partenariat avec » est d'abord une formule d'information
   légitime (« la mairie, en partenariat avec l'ADEME, lance… »). Seul, il ne
   suffit donc pas : il lui faut un supplément ou un dossier à côté. La page qui a
   motivé ce contrôle : « Découvrez le supplément de Nice-Matin en partenariat avec
   VINCI Autoroutes » (13/10). Le publireportage avoué, lui, reste écarté par
   ADVERT_STRONG ci-dessus. */
const PARTNER_STRONG = [
  "contenu de marque", "brand content", "contenu partenaire", "contenu propose par",
  "publi-information", "publiinformation", "realise en partenariat avec", "edite en partenariat avec",
];
const PARTNER_CONTEXT = ["supplement", "dossier special", "hors-serie", "hors serie", "cahier special"];

export function partnerContent(raw) {
  const t = deacc(raw).slice(0, 6000);
  const hits = PARTNER_STRONG.filter((m) => t.includes(deacc(m)));
  if (t.includes("en partenariat avec")) {
    const ctx = PARTNER_CONTEXT.filter((m) => t.includes(m));
    if (ctx.length) hits.push("en partenariat avec", ...ctx);
  }
  return { partner: hits.length > 0, hits: [...new Set(hits)].slice(0, 4) };
}

/* Le signalement posé sur l'article — le même à la génération et à la régénération. */
export function partnerFlag(p) {
  return p.partner
    ? { type: "contenu_partenaire", detail: `Contenu de partenaire ou de marque (${p.hits.join(", ")}) : à publier comme tel, ou à classer.`, at: new Date().toISOString() }
    : null;
}

/* Verdict : contenu clairement commercial ? Plus strict sur un texte court. */
export function isAdvert(raw) {
  const a = advertScore(raw);
  const len = String(raw || "").length;
  if (a.score >= 4) return { advert: true, ...a };
  if (a.score >= 3 && len < 1800) return { advert: true, ...a };
  return { advert: false, ...a };
}

/* Phrases de « tunnel juridique » d'un communiqué : à ignorer, jamais à reformuler.
   Marqueurs sans ambiguïté seulement (pas « euronext » / « isin » seuls : une vraie
   info peut les citer — le nettoyage de la phrase s'en charge, cf cleanFact). */
export const BOILERPLATE_RE = /d[ée]clarations?\s+(?:et\s+informations?\s+)?prospectives?|informations?\s+privil[ée]gi[ée]es|communiqu[ée]\s+de\s+presse\s+constitue|le\s+pr[ée]sent\s+communiqu[ée]|conform[ée]ment\s+au\s+r[èe]glement|r[èe]glement\s+d['’]ex[ée]cution\s*\(?\s*ue|forward[- ]looking|n['’]assume\s+aucune\s+obligation|sous\s+r[ée]serve\s+de\s+la\s+r[ée]glementation|mentions?\s+l[ée]gales|clause\s+de\s+non[- ]responsabilit[ée]|ce\s+communiqu[ée]\s+peut\s+contenir|les\s+lecteurs\s+sont\s+avertis|ne\s+sont\s+pas\s+des\s+garanties\s+de\s+performances?\s+futures?|terminologie\s+prospective/i;

export function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
}

/* Phrases porteuses d'information réelle (boilerplate retiré). */
export function substantiveSentences(text) {
  return splitSentences(text).filter((s) => !BOILERPLATE_RE.test(s));
}

/* Signes utiles d'une source : ses phrases porteuses d'information, mentions
   légales et bribes de menu retirées. C'est la base de la longueur visée
   (M3-86, src/llm/lengthTarget.js) : la longueur brute compterait le
   boilerplate d'un communiqué comme de la matière à rédiger. */
export function sourceSignsOf(text) {
  return substantiveSentences(text).join(" ").length;
}

/* Mesures de la source pour les titres et la méta-description (M3-86) :
   `source_title_chars` règle le titre et la balise titre, `source_lead_chars`
   la méta-description. Le chapô est le premier paragraphe porteur
   d'information ; une source sans saut de ligne (texte d'un seul bloc) donne
   ses deux premières phrases. Boilerplate exclu, comme sourceSignsOf. 0 = mesure
   inconnue : fieldTargets rend alors null et la règle d'avant s'applique. */
export function sourceFieldMeasuresOf({ title = "", text = "" } = {}) {
  const paras = String(text || "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
  let lead = "";
  if (paras.length > 1) {
    for (const p of paras) { lead = substantiveSentences(p).join(" "); if (lead) break; }
  } else {
    lead = substantiveSentences(text).slice(0, 2).join(" ");
  }
  return {
    source_title_chars: String(title || "").replace(/\s+/g, " ").trim().length,
    source_lead_chars: lead.length,
  };
}

export function assessItem(item) {
  const raw = String(item.rawText || "");
  const text = raw.toLowerCase();
  const len = text.length;
  if (len < 500) return { ok: false, reason: "contenu_insuffisant", detail: `${len} caractères extraits` };

  const frHits = FR_MARKERS.reduce((n, m) => n + (text.includes(m) ? 1 : 0), 0);
  if (frHits < 4) return { ok: false, reason: "hors_langue", detail: "contenu probablement non francophone" };

  const junk = JUNK_MARKERS.filter((m) => text.includes(m));
  if (junk.length >= 2 || text.slice(0, 200).includes("transform your documents")) {
    return { ok: false, reason: "page_non_editoriale", detail: "page d'index / embed / mentions" };
  }
  const adv = isAdvert(raw);
  if (adv.advert) {
    return {
      ok: false, reason: "publicite",
      detail: `contenu commercial (score ${adv.score}${adv.hits.length ? " — " + adv.hits.join(", ") : ""})`,
    };
  }

  // « soupe de menu » : suite de titres tronqués (plusieurs « … » en tête, phrases courtes)
  const head = raw.slice(0, 400);
  const ellipses = (head.match(/…|\.\.\./g) || []).length;
  const parts = splitSentences(raw);
  const shortRatio = parts.length ? parts.filter((s) => s.length < 70).length / parts.length : 1;
  if ((ellipses >= 2 && parts.length < 6) || (shortRatio > 0.6 && parts.length < 8 && ellipses >= 1)) {
    return { ok: false, reason: "page_non_editoriale", detail: "liste de titres tronqués (menu de navigation)" };
  }
  return { ok: true };
}
