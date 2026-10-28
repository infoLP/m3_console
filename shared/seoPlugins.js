/* M3-53 — Où vont la balise titre et la méta-description, selon le greffon SEO
   du site cible. WordPress core n'a NI l'une NI l'autre : ce sont des champs de
   greffon, que chacun range sous ses propres noms et écrit par son propre chemin.

   Le site cible réel n'est pas connu : le choix reste un RÉGLAGE (`wp_seo_plugin`,
   cf. wpConfig.js), et tout ce qui dépend du greffon vit dans cette table — en
   ajouter un, c'est ajouter une entrée, pas toucher au transport.

   Constaté sur le prototype (M3-94, WordPress 6.9.4) :
   - Yoast SEO 28.7 enregistre `_yoast_wpseo_title`, `_yoast_wpseo_metadesc` et
     `_yoast_wpseo_focuskw` avec `show_in_rest` : ils s'écrivent dans le champ
     `meta` de POST /wp/v2/posts, DANS la requête qui crée l'article.
   - Rank Math 1.0.280 ne les expose pas à l'API core (WordPress ignorerait en
     silence un `meta` inconnu) mais fournit sa propre route, celle de son
     éditeur : POST /rankmath/v1/updateMeta {objectType, objectID, meta}.
     D'où une seconde requête, faite AVANT la mise en ligne (cf. wordpress.js).

   `via` dit le chemin ; `fields` relie les champs neutres de la charge utile
   (payload.js → `seo`) aux clés du greffon. */

export const SEO_PLUGINS = {
  yoast: {
    label: "Yoast SEO",
    via: "core-meta",
    fields: {
      metaTitle: "_yoast_wpseo_title",
      metaDescription: "_yoast_wpseo_metadesc",
      focusKeyword: "_yoast_wpseo_focuskw",
    },
  },
  rankmath: {
    label: "Rank Math",
    via: "rankmath-endpoint",
    endpoint: "/rankmath/v1/updateMeta",
    fields: {
      metaTitle: "rank_math_title",
      metaDescription: "rank_math_description",
      focusKeyword: "rank_math_focus_keyword",
    },
  },
  /* Pas de greffon : la balise titre et la méta-description n'ont aucune
     destination. On publie quand même, et le résultat le DIT (`seoSkipped`). */
  none: { label: "aucun greffon SEO", via: "none", fields: {} },
};

export const SEO_PLUGIN_IDS = Object.keys(SEO_PLUGINS);

export function seoPlugin(id) {
  const p = SEO_PLUGINS[id];
  if (!p) throw new Error(`Greffon SEO inconnu : « ${id} » (attendu : ${SEO_PLUGIN_IDS.join(", ")})`);
  return p;
}

/* Champs neutres → clés du greffon. Une valeur vide n'est pas envoyée : chez
   Rank Math, une valeur vide EFFACE la clé, ce qui n'est jamais l'intention ici. */
export function seoMetaFor(id, seo = {}, keywords = []) {
  const { fields } = seoPlugin(id);
  const values = {
    metaTitle: seo.metaTitle,
    metaDescription: seo.metaDescription,
    focusKeyword: keywords[0],
  };
  const meta = {};
  for (const [neutral, key] of Object.entries(fields)) {
    const v = typeof values[neutral] === "string" ? values[neutral].trim() : "";
    if (v) meta[key] = v;
  }
  return meta;
}
