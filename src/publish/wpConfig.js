/* M3-53 / M3-94 — Configuration de la publication WordPress, lue ICI et nulle
   part ailleurs. Ces réglages n'existent pas encore dans les Paramètres ni dans
   src/config.ts : à la fusion, il suffira de les y déclarer, cette fonction
   les lit déjà dans `settings` avant de retomber sur l'environnement.

   Ordre : réglage (`settings`) > environnement > défaut.
     wp_url            M3_WP_URL            — défaut : `wp_target` (cible fictive)
     wp_user           M3_WP_USER           — identifiant WordPress
     (secret)          M3_WP_APP_PASSWORD   — mot de passe d'APPLICATION, jamais en base
     wp_seo_plugin     M3_WP_SEO_PLUGIN     — yoast | rankmath | none (défaut : none)
     wp_create_categories M3_WP_CREATE_CATEGORIES — oui/non (défaut : non)
     publish_mode      M3_PUBLISH_MODE      — simulated | wordpress (défaut : simulated)

   Le mot de passe d'application ne vient QUE de l'environnement : un secret n'a
   rien à faire dans un réglage éditable à l'écran ni dans un journal. */

import { SEO_PLUGINS } from "./seoPlugins.js";

const pick = (settings, key, env, envKey) => {
  const s = settings?.[key];
  if (s !== undefined && s !== null && s !== "") return s;
  const e = env?.[envKey];
  return e !== undefined && e !== "" ? e : undefined;
};

const yes = (v) => v === true || /^(1|true|oui|yes|on)$/i.test(String(v ?? "").trim());

export function readSeoPluginId(settings = {}, env = process.env) {
  const id = String(pick(settings, "wp_seo_plugin", env, "M3_WP_SEO_PLUGIN") ?? "none").trim().toLowerCase();
  return SEO_PLUGINS[id] ? id : "none";
}

export function readPublishMode(settings = {}, env = process.env) {
  const m = String(pick(settings, "publish_mode", env, "M3_PUBLISH_MODE") ?? "simulated").trim().toLowerCase();
  return m === "wordpress" ? "wordpress" : "simulated";
}

export function readWpConfig(settings = {}, env = process.env) {
  const url = String(pick(settings, "wp_url", env, "M3_WP_URL") ?? settings?.wp_target ?? "").replace(/\/+$/, "");
  const user = String(pick(settings, "wp_user", env, "M3_WP_USER") ?? "");
  const appPassword = String(env?.M3_WP_APP_PASSWORD ?? "");
  const missing = [];
  if (!/^https?:\/\//.test(url)) missing.push("URL du site (M3_WP_URL)");
  if (!user) missing.push("identifiant (M3_WP_USER)");
  if (!appPassword) missing.push("mot de passe d'application (M3_WP_APP_PASSWORD)");
  return {
    url,
    user,
    appPassword,
    seoPlugin: readSeoPluginId(settings, env),
    createCategories: yes(pick(settings, "wp_create_categories", env, "M3_WP_CREATE_CATEGORIES")),
    missing,
    configured: missing.length === 0,
  };
}
