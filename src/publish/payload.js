/* Charge utile de publication — ce qui part réellement du prototype vers le site
 * cible. Assemblée ICI et nulle part ailleurs : le publisher simulé et le futur
 * publisher WordPress doivent envoyer la même chose, faute de quoi la simulation
 * cesse de prouver quoi que ce soit.
 *
 * Constat du 2026-09-17 (relecture utilisateur) : la barre SEO laissait modifier
 * la balise titre, la méta-description et les mots-clés sans qu'aucun de ces
 * champs ne quitte l'application — le publisher n'emportait qu'un identifiant,
 * un titre, un slug et une cible. Le corps de l'article lui-même n'y était pas.
 * Même défaut que le plan Hn traité le matin : un champ qu'on édite, qu'on
 * enregistre, et que personne ne relit.
 *
 * La forme suit l'API REST de WordPress (POST /wp-json/wp/v2/posts) pour que le
 * câblage se réduise au transport. Une réserve, documentée dans `seo` :
 * WordPress core n'a NI balise titre NI méta-description — ce sont des champs de
 * greffon (Yoast : `_yoast_wpseo_title` / `_yoast_wpseo_metadesc` ; Rank Math :
 * `rank_math_title` / `rank_math_description` ; SEOPress : encore d'autres).
 * Elles voyagent ici sous un nom neutre ; la traduction vers les clés du greffon
 * réglé (`wp_seo_plugin`) se fait au transport, par seoPlugins.js (M3-53).
 */

import { bodyHtml, outlineOf } from "../../shared/model.js";
import { readSeoPluginId } from "./wpConfig.js";

export function buildPayload(article, settings, { scheduledAt = null } = {}) {
  const seo = article.seo || {};
  return {
    /* Champs natifs de l'API WordPress — transposables tels quels. */
    title: article.title,
    slug: seo.slug,
    content: bodyHtml(article),
    excerpt: article.chapo || "",
    status: scheduledAt ? "future" : "publish",
    date: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    categories: [article.cat].filter(Boolean),
    tags: seo.keywords || [],
    /* Illustration telle que posée par le relecteur (M3-66). WordPress attend un
       `featured_media` numérique : la traduction (lien médiathèque réutilisé ou
       URL téléversée) se fait au transport, par illustration.js. */
    illustration: String(article.illustration?.url || "").trim()
      ? { url: String(article.illustration.url).trim(), credit: String(article.illustration.credit || "").trim() }
      : null,

    /* Champs de greffon SEO, sous des noms neutres. Ils partent même sans
       greffon réglé : les omettre ici les rendrait invisibles, et l'on ne
       corrige pas ce qu'on ne voit pas. `_plugin` dit vers quel greffon. */
    seo: {
      metaTitle: seo.metaTitle || "",
      metaDescription: seo.metaDescription || "",
      outline: outlineOf(article).map((o) => `${o.t} ${o.x}`),
      _plugin: readSeoPluginId(settings),
    },

    /* Contexte propre à M3, jamais envoyé à WordPress : sert au journal. */
    _target: settings.wp_target,
    _articleId: article.id,
  };
}
