/* Choix des liens d'articles sur une page « liste » — fonctions pures.

   Avant (2026-10-14) l'heuristique prenait les six premiers liens dont l'URL ou
   le texte contenait « actualite », « presse », « 2026 »… dans l'ordre du HTML :
   menus et bandeaux d'abord (« Espace Presse », « Services et aires »,
   « Catalogue Carrelage »), toujours les mêmes, donc toujours déjà vus. 17
   sources actives sur 34 n'avaient rien rapporté en quatre récoltes.

   Désormais : on écarte ce qui est navigation (nav/header/footer/aside, pages
   de rubrique, fichiers, autres sites), on note chaque lien, et on garde les
   meilleurs dans l'ordre de la page. */

const LINK_HINT = /(actualite|actualites|actu|communique|presse|nouvelle|news|article|agenda|blog|20\d\d)/i;

/* Zones de navigation : un lien qui s'y trouve n'est pas un article. */
export const NAV_ZONES = "nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], .menu, .breadcrumb, .pagination, .pager";

/* Derniers segments qui désignent une rubrique ou un utilitaire, pas un contenu. */
const UTILITY_RE = /\/(contact|contacts|mentions-legales|mentions|plan-du-site|plan-site|sitemap|recherche|search|connexion|login|compte|panier|cart|faq|accessibilite|cookies|rgpd|donnees-personnelles|newsletter|abonnement|espace-presse|presse|salle-de-presse|actualites|actualite|actus|news|communiques|communiques-de-presse|agenda|blog|category|categorie|categories|tag|tags|rubrique|page|auteur|author)\/?$/i;
const FILE_RE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|#|$)/i;
const PAGINATION_RE = /[?&](page|p|start|offset)=\d+|\/page\/\d+\/?$/i;
const DATE_RE = /(20\d\d)[-/](0?[1-9]|1[0-2])([-/]\d{1,2})?/;

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/* Même site : même domaine, sous-domaines compris (presse.exemple.fr ~ exemple.fr). */
export function sameSite(a, b) {
  const ha = hostOf(a), hb = hostOf(b);
  if (!ha || !hb) return false;
  return ha === hb || ha.endsWith("." + hb) || hb.endsWith("." + ha);
}

/* Note d'un lien candidat ; null = écarté. `text` est le texte du lien. */
export function scoreLink(abs, text, listUrl) {
  let u;
  try { u = new URL(abs); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (!sameSite(abs, listUrl)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path || path === new URL(listUrl).pathname.replace(/\/+$/, "")) return null;
  if (FILE_RE.test(u.pathname) || PAGINATION_RE.test(u.pathname + u.search)) return null;
  if (UTILITY_RE.test(path.replace(/\.(html?|php|aspx?)$/i, "") + "/")) return null;
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length < 15) return null;

  let score = 0;
  const segs = path.split("/").filter(Boolean);
  const last = segs[segs.length - 1] || "";
  if (segs.length >= 2) score += 1;
  if ((last.match(/-/g) || []).length >= 3) score += 2;      // slug de titre
  if (/\d{3,}/.test(last) || /^\d+$/.test(last)) score += 1; // identifiant de contenu
  if (DATE_RE.test(u.pathname)) score += 2;
  if (LINK_HINT.test(u.pathname + " " + t)) score += 1;
  if (t.length >= 30) score += 1;
  if (t.split(" ").length >= 5) score += 1;
  return score;
}

/* Une URL de sitemap n'a pas de libellé ni de place dans une page : seule son
   adresse dit si c'est une actualité. Sans indice dans le chemin, on écarte —
   sinon « Vos élus », « Espace presse » ou une page touristique remise à jour
   passent pour des articles récents. */
export function newsPath(abs) {
  try {
    const p = new URL(abs).pathname;
    return LINK_HINT.test(p) || DATE_RE.test(p);
  } catch { return false; }
}

/* Liens retenus, sans doublon, dans l'ordre de la page, note >= minScore.
   `candidates` : [{ href, text }] déjà extraits du HTML, hors zones de navigation. */
export function pickArticleLinks(candidates, listUrl, { minScore = 3 } = {}) {
  const seen = new Set();
  const out = [];
  for (const { href, text } of candidates) {
    let abs;
    try { abs = new URL(href, listUrl).toString().replace(/#.*$/, ""); } catch { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    const score = scoreLink(abs, text, listUrl);
    if (score != null && score >= minScore) out.push(abs);
  }
  return out;
}
