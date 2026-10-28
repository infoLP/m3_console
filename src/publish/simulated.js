/* Publication simulée : aucun appel réseau, on journalise dans publications.json.
   Même signature que le futur publisher WordPress (src/publish/wordpress.js), et
   surtout MÊME charge utile — assemblée par buildPayload(). Une simulation qui
   n'emporte pas ce que l'envoi réel emporterait ne simule rien. */

import { pushCollection } from "../lib/store.js";
import { buildPayload } from "./payload.js";

/* `by` identifie la PERSONNE (son login), pas son rôle : jusqu'au 2026-09-16 on
   recevait ici « Administrateur », ce qui rendait le journal des publications
   inexploitable pour savoir qui avait envoyé quoi. `byRole` garde le rôle
   effectif à côté, « Voir comme » compris. */
export async function publish(article, settings, { scheduledAt = null, by = "inconnu", byRole = null } = {}) {
  const now = new Date().toISOString();
  const payload = buildPayload(article, settings, { scheduledAt });
  const record = {
    id: `pub-${Date.now()}`,
    articleId: article.id,
    title: article.title,
    slug: article.seo.slug,
    target: settings.wp_target,
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    publishedAt: scheduledAt ? null : now,
    url: `${settings.wp_target}/${article.seo.slug}`,
    /* Le journal porte la charge utile complète. Avant le 2026-09-17 il n'y avait
       ici ni corps, ni méta, ni mots-clés : impossible d'y constater qu'un champ
       édité en console ne partait nulle part. */
    payload,
    by,
    byRole,
    simulated: true,
  };
  await pushCollection("publications", record);
  return record;
}
