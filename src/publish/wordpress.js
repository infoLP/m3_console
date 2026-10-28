/* Publication réelle via l'API REST WordPress (M3-94), éprouvée sur le
   WordPress de test local (docker-compose.wordpress.yml, docs/passation/PROTOTYPE-wordpress.md).
   Même signature et MÊME charge utile que le publisher simulé
   (src/publish/simulated.js) : buildPayload() reste l'unique source.

   Les deux arbitrages de M3-53, tranchés par le prototype :
   1. Greffon SEO : réglable (`wp_seo_plugin`), et tout ce qui en dépend est
      dans la table de correspondance seoPlugins.js. Yoast écrit la balise titre
      et la méta-description dans la requête de création ; Rank Math par sa
      propre route, appelée AVANT la mise en ligne.
   2. Rubriques et mots-clés : libellés résolus en identifiants (terms.js),
      mots-clés absents créés, rubrique absente → erreur nommée.

   Ordre des requêtes, pour qu'aucun lecteur ne voie un article à moitié posé :
     a. résoudre les termes (avant toute écriture d'article), puis l'illustration
        (illustration.js : média réutilisé ou téléversé, jamais bloquant) ;
     b. créer l'article en BROUILLON (Yoast : méta SEO comprises) ;
     c. Rank Math : écrire ses méta SEO sur le brouillon ;
     d. passer en `publish` (ou `future` à la date prévue).
   Un échec en b-d laisse au pire un brouillon, que l'erreur identifie. */

import { resolveFeaturedMedia } from "./illustration.js";
import { buildPayload } from "./payload.js";
import { seoPlugin, seoMetaFor } from "./seoPlugins.js";
import { resolveTerms } from "./terms.js";
import { createWpClient } from "./wpClient.js";
import { readWpConfig } from "./wpConfig.js";

/* Corps de POST /wp/v2/posts tiré de la charge utile : les champs natifs, sans
   `seo` ni le contexte M3 (`_target`, `_articleId`). */
export function wpPostBody(payload, terms, { seoPluginId = "none", featuredMedia = null } = {}) {
  const plugin = seoPlugin(seoPluginId);
  const body = {
    title: payload.title,
    slug: payload.slug,
    content: payload.content,
    excerpt: payload.excerpt,
    status: "draft",
    categories: terms.categories,
    tags: terms.tags,
    ...(Number.isInteger(featuredMedia) && featuredMedia > 0 ? { featured_media: featuredMedia } : {}),
  };
  if (plugin.via === "core-meta") {
    const meta = seoMetaFor(seoPluginId, payload.seo, payload.tags);
    if (Object.keys(meta).length) body.meta = meta;
  }
  return body;
}

/* Réglage d'un site cible enregistré (src/lib/wpTargets.js, resolveForPublish) :
   mêmes champs que readWpConfig, plus le statut d'arrivée. Sans cible, la
   configuration vient de l'environnement (M3_WP_*), et l'article est mis en ligne. */
function configOf(target, settings, env) {
  if (!target) return { ...readWpConfig(settings, env), publishStatus: "publish" };
  return {
    url: target.url, user: target.user, appPassword: target.appPassword, seoPlugin: target.seoPlugin,
    createCategories: !!target.createCategories, publishStatus: target.publishStatus === "publish" ? "publish" : "draft",
    missing: [], configured: true,
  };
}

export async function publish(article, settings, { scheduledAt = null, by = "inconnu", byRole = null, env = process.env, fetch, getImage, lookup, journal, target = null } = {}) {
  const cfg = configOf(target, settings, env);
  if (!cfg.configured) {
    throw new Error(`Publication WordPress non configurée : il manque ${cfg.missing.join(", ")}.`);
  }
  const plugin = seoPlugin(cfg.seoPlugin);
  const payload = buildPayload(article, { ...settings, wp_target: cfg.url, wp_seo_plugin: cfg.seoPlugin }, { scheduledAt });
  const client = createWpClient({ url: cfg.url, user: cfg.user, appPassword: cfg.appPassword, fetch });

  const terms = await resolveTerms(client, { categories: payload.categories, tags: payload.tags }, { createCategories: cfg.createCategories });

  /* Illustration (M3-66) : lien médiathèque réutilisé ou URL téléversée, AVANT
     l'article pour qu'il naisse avec son image. Un échec ne bloque pas : l'article
     part sans image, `illustrationError` le dit au relecteur. */
  const media = await resolveFeaturedMedia(client, payload.illustration, { siteUrl: cfg.url, ...(getImage ? { get: getImage } : {}), ...(lookup ? { lookup } : {}) });

  const draft = await client.post("/wp/v2/posts", wpPostBody(payload, terms, { seoPluginId: cfg.seoPlugin, featuredMedia: media?.mediaId }));
  const seoMeta = seoMetaFor(cfg.seoPlugin, payload.seo, payload.tags);
  try {
    if (plugin.via === "rankmath-endpoint" && Object.keys(seoMeta).length) {
      await client.post(plugin.endpoint, { objectType: "post", objectID: draft.id, meta: seoMeta });
    }
  } catch (e) {
    e.message = `${e.message} — l'article est resté en brouillon (WordPress #${draft.id}).`;
    throw e;
  }
  /* Cible « brouillon » : l'article reste brouillon dans WordPress, un humain le met
     en ligne là-bas. Rien n'est mis en ligne, ni planifié, par M3. */
  const asDraft = cfg.publishStatus === "draft";
  const final = asDraft
    ? draft
    : await client.post(`/wp/v2/posts/${draft.id}`, {
        status: payload.status,
        ...(payload.date ? { date_gmt: payload.date } : {}),
      });

  const now = new Date().toISOString();
  const record = {
    id: `pub-${Date.now()}`,
    articleId: article.id,
    title: article.title,
    slug: final.slug || payload.slug,
    target: cfg.url,
    scheduledAt: payload.date,
    /* Une cible « brouillon » reçoit l’article à l’instant : c’est la date d’envoi, `sentAsDraft` dit qu’il n’est pas encore en ligne. */
    publishedAt: payload.date ? null : now,
    url: final.link || `${cfg.url}/?p=${draft.id}`,
    wpId: draft.id,
    wpStatus: final.status,
    sentAsDraft: asDraft,
    targetId: target?.id ?? null,
    targetName: target?.name ?? null,
    terms,
    seoPlugin: cfg.seoPlugin,
    /* Dit ce qui n'a PAS pu partir, plutôt que de le taire. */
    illustration: media,
    illustrationError: media?.error || null,
    seoSkipped: plugin.via === "none" && (payload.seo.metaTitle || payload.seo.metaDescription) ? "aucun greffon SEO réglé : balise titre et méta-description non transmises" : null,
    payload,
    by,
    byRole,
    simulated: false,
  };
  const push = journal || (await import("../lib/store.js")).pushCollection;
  await push("publications", record);
  return record;
}
