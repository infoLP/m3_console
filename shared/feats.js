/* Fonctions expérimentales (« FEAT ») — partagé backend + navigateur (M3-83).

   Une FEAT est une préférence de poste que chacun active pour soi dans la
   console. L'administrateur règle, pour chacune, le rôle MINIMAL qui y a accès
   (onglet Paramètres, section FEAT), sur le modèle de home_min_role. Une FEAT
   fermée disparaît des Préférences et cesse de s'appliquer, même si le poste
   l'avait activée.

   Toutes ne sont pas des préférences : depuis le weekly du 13/10, une FEAT peut
   aussi montrer une partie de la console (M3-91, M3-92) ou ouvrir un droit
   (M3-93). Le principe reste le même — un rôle minimal par FEAT — mais le
   défaut n'est plus forcément « ouvert à tous » : `default` le précise.

   Ajouter une FEAT : une entrée ici (le réglage, sa ligne d'aide et l'envoi au
   navigateur en découlent), puis lire `state.feats.<id>` là où elle agit — et,
   si elle ouvre un droit, `featOpen` côté serveur : l'écran ne protège rien. */

import { roleAtLeast, hasImage } from "./model.js";

export const FEAT_ROLES = ["relecteur", "super_utilisateur", "administrateur", "aucun"];

export const FEATS = {
  dark: {
    label: "Mode sombre",
    setting: "feat_dark_min_role",
    help: "Thème sombre de la console et du back-office, activé par chacun dans ses Préférences.",
  },
  antiPlagiat: {
    label: "Contrôle anti-plagiat systématique",
    setting: "feat_antiplagiat_min_role",
    help: "Case des Préférences. ⚠ Aujourd'hui, aucun traitement ne la lit (audit des récits du 12/10, M3-10) : la fermer ne fait que la retirer de l'écran.",
  },
  /* M3-91 : le relecteur ne voit plus la partie SEO local (weekly du 13/10). */
  seoLocal: {
    label: "SEO et rattachement dans la console",
    setting: "feat_seo_local_min_role",
    default: "super_utilisateur",
    help: "Panneau « SEO — suggestions modifiables » (balise titre, méta-description, slug, mots-clés, structure Hn), mention SEO du bandeau de l'article et carte « Rattachement » (zone, département, région). Fermée : la console ne les montre pas ; la ligne « SEO complet » du contrôle de conformité reste, puisqu'elle compte dans les cinq critères.",
  },
  /* M3-92 : l'entrée « Demander une source » de la console. */
  demandeSource: {
    label: "Demander une source",
    setting: "feat_demande_source_min_role",
    help: "Entrée « Demander une source » de la console : la demande arrive dans l'onglet Tickets du back-office. Fermée : l'entrée disparaît et le serveur refuse la demande.",
  },
  /* M3-93 : l'illustration devient obligatoire pour les rôles sous le seuil. La
     FEAT est le droit de s'en passer ; ouverte à tous par défaut, elle ne change
     rien à ce qui se faisait avant. */
  sansIllustration: {
    label: "Parution sans illustration",
    setting: "feat_sans_illustration_min_role",
    help: "Rôle minimal qui peut envoyer en parution un article sans image (URL d'illustration vide). En dessous, la parution est refusée tant qu'aucune image n'est posée. « relecteur » : personne n'y est obligé, comme avant ; « aucun » : l'illustration est obligatoire pour tous.",
  },
  /* Test des modèles (onglet LLM) : le modèle déjà choisi d'un moteur échoue au
     test du catalogue. L'avertissement sur la carte est toujours là ; la
     notification est optionnelle, fermée par défaut. */
  alerteModeleDefaut: {
    label: "Notification : modèle choisi en échec au test",
    setting: "feat_alerte_modele_min_role",
    default: "aucun",
    notification: "llm_modele_ko",
    help: "Quand « Récupérer la liste » (onglet LLM) teste le catalogue et que le modèle déjà choisi d'un moteur ne répond pas (429, crédit, modèle retiré), une notification est émise, visible des rôles à partir de ce seuil. Le modèle n'est pas changé. « aucun » : pas de notification, seul l'avertissement de la carte LLM le signale.",
  },
  /* M3-97 : le relecteur ne voit pas les articles purgés dans l'Historique. Tenu
     par la requête (src/api/articles.js, history) : les lignes ne partent pas. */
  historiquePurges: {
    label: "Articles purgés dans l'Historique",
    setting: "feat_historique_purges_min_role",
    default: "super_utilisateur",
    help: "Rôle minimal qui voit, dans l'onglet Historique, les articles purgés : leurs lignes, la puce « Purgé · était … », le filtre et le compteur « Purgés ». En dessous, le serveur ne les envoie pas du tout.",
  },
  /* M3-105 : coût LLM des routines, à l'Accueil et au back-office. Tenu côté
     serveur : sous le seuil, les coûts ne partent pas. */
  coutRoutines: {
    label: "Coût des routines",
    setting: "feat_cout_routines_min_role",
    default: "administrateur",
    help: "Rôle minimal qui voit le coût LLM des routines (récolte et génération, planifiées ou manuelles) : carte à l'Accueil de la console, détail au back-office (Exécutions). En dessous, le serveur n'envoie rien. « aucun » : masqué à tous.",
  },
  /* M3-121, M3-122 : le scan des concurrents relève de nouveaux domaines sources
     candidats. Notification réservée à l'administrateur et au super
     utilisateur, comme la page Sources → Concurrents. */
  notifConcurrents: {
    label: "Notification : nouveaux candidats du scan des concurrents",
    setting: "feat_notif_concurrents",
    default: "super_utilisateur",
    notification: "competitors_candidates",
    help: "Quand un scan des concurrents relève de nouveaux domaines sources candidats, une notification est émise, visible des rôles à partir de ce seuil. Les candidats eux-mêmes restent dans Sources → Concurrents. « aucun » : pas de notification.",
  },
};

/* Notifications réservées à une FEAT : invisibles des rôles sous son seuil. */
export function notificationVisible(n, role, settings) {
  const f = Object.values(FEATS).find((x) => x.notification && x.notification === n?.type);
  return !f || featOpen(role, settings?.[f.setting] ?? f.default);
}

/* Refus quand la FEAT « Parution sans illustration » est fermée au rôle (M3-93).
   Une illustration sans URL ne compte pas (hasImage, model.js). */
export const ILLUSTRATION_REFUSAL = "Illustration obligatoire pour votre rôle : posez une image (URL) avant d'envoyer en parution.";
export { hasImage };

/* « aucun » ferme la FEAT à tous, administrateur compris. */
export function featOpen(role, minRole) {
  return minRole !== "aucun" && roleAtLeast(role, minRole || "relecteur");
}

/* FEAT ouvertes pour un rôle, d'après les réglages : { dark: true, … }. Un réglage
   absent vaut le défaut de la FEAT — pas « ouvert à tous » : sans quoi une base
   qui n'a jamais enregistré le réglage montrerait au relecteur ce qu'on lui cache. */
export function featsFor(role, settings) {
  return Object.fromEntries(Object.entries(FEATS).map(([id, f]) =>
    [id, featOpen(role, settings?.[f.setting] ?? f.default)]));
}

/* Le droit de publier sans image, côté serveur (réglages + rôle effectif). */
export function illustrationMissing(a, role, settings) {
  const f = FEATS.sansIllustration;
  return !hasImage(a) && !featOpen(role, settings?.[f.setting] ?? f.default);
}
/* Même règle côté console, qui ne reçoit que le résultat de featsFor. */
export const illustrationBlocked = (a, feats) => !hasImage(a) && feats?.sansIllustration === false;
