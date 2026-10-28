/* Libellés et explications des réglages de l'onglet Paramètres du back-office.

   Séparés de SETTING_SPECS (src/lib/yamlStore.js), qui porte le type, les bornes
   et le défaut — ce que le SERVEUR applique. Ici, ce que l'administrateur doit
   COMPRENDRE avant de toucher : à quoi sert la valeur, qui la lit, ce que la
   changer provoque. Chaque texte a été écrit en relisant le code qui lit la clé.

   Un réglage absent d'ici s'affiche quand même, sous « Autres », avec sa seule
   clé : en ajouter un ne casse rien, mais il mérite sa ligne. */

import { FEATS } from "./feats.js";

export const SETTING_SECTIONS = [
  { id: "planification", title: "Planification", note: "La chaîne récolte puis génération se lance seule aux horaires indiqués. Un clic « Lancer » pendant une chaîne en cours est refusé, et inversement. Les articles programmés passent en « publié » à leur heure dans tous les cas." },
  { id: "zones", title: "Zones couvertes", note: "Le département est l'unité du périmètre : géo-tag, rattachement des sources et filtre de la console le manipulent tous. La région n'est qu'un raccourci de saisie." },
  { id: "recolte", title: "Récolte des sources" },
  { id: "concurrents", title: "Scan des concurrents", note: "Lit les derniers articles des sites de Sources → Concurrents et relève les domaines qu'ils citent, proposés comme sources candidates. Tourne à part de la chaîne récolte puis génération." },
  { id: "notation", title: "Notation des articles", note: "Lus par la grille de conformité ET cités dans le prompt de génération : le modèle reçoit la consigne que la grille vérifie. Après un changement, « Recalculer les scores » (onglet Dernier run) pour le stock." },
  { id: "prompt", title: "Prompt de génération seulement", note: "Cités dans la consigne envoyée au modèle ; la grille ne les contrôle pas." },
  { id: "llm", title: "Appels LLM" },
  { id: "plafond", title: "Plafond de dépense LLM", note: "0 = désactivé. Vérifié avant chaque appel : il peut être dépassé d'un appel. La limite de crédit posée sur la clé OpenRouter reste le seul plafond sûr." },
  { id: "publication", title: "Publication" },
  { id: "console", title: "Console" },
  { id: "feat", title: "FEAT — fonctions expérimentales", note: "Chacun active une FEAT pour soi dans les Préférences de la console ; ici, l'administrateur décide qui peut le faire. Une FEAT fermée disparaît des Préférences et cesse de s'appliquer, même si un poste l'avait activée. Effet au prochain chargement de la page." },
  { id: "clavier", title: "Clavier", note: "Ces réglages BORNENT : chacun choisit ensuite ses propres touches dans les Préférences de la console, sans jamais pouvoir se rouvrir ce qui est fermé ici." },
];

export const SETTING_HELP = {
  /* --- planification (M3-58) --- */
  schedule_enabled: { section: "planification", label: "Chaîne automatique",
    help: "oui : récolte puis génération aux horaires ci-dessous, sans intervention. non : rien ne se lance seul. Activer ne déclenche rien sur-le-champ : la première chaîne part au prochain horaire." },
  schedule_times: { section: "planification", label: "Horaires (heure de Paris)",
    help: "Un ou plusieurs horaires HH:MM séparés par des virgules, par exemple « 06:30, 13:30 ». Éviter 3 h 15, prévu pour la sauvegarde de la base. Un horaire manqué pendant un arrêt du serveur est rattrapé au redémarrage s'il date de moins de 6 h. En planifié, chaque source n'est interrogée que si son intervalle (colonne « Intervalle » des sources) est écoulé." },

  /* --- scan des concurrents (M3-121, M3-122) --- */
  competitors_scan_enabled: { section: "concurrents", label: "Scan automatique",
    help: "oui : le scan des concurrents se lance seul aux horaires ci-dessous. non (par défaut) : rien ne se lance seul. Activer ne déclenche rien sur-le-champ : le premier scan part au prochain horaire. Le bouton « Lancer le scan » de Sources → Concurrents marche dans les deux cas, même désactivé." },
  competitors_scan_times: { section: "concurrents", label: "Horaires du scan (heure de Paris)",
    help: "Un ou plusieurs horaires HH:MM séparés par des virgules, par exemple « 02:30, 14:30 ». Éviter 3 h 15, prévu pour la sauvegarde de la base." },
  competitors_max_articles: { section: "concurrents", label: "Articles lus par concurrent",
    help: "Nombre maximal d'articles lus sur chaque concurrent, à chaque scan (1 à 50). Le relever allonge le scan et multiplie les requêtes vers chaque site." },

  /* --- récolte --- */
  window_hours: { section: "recolte", label: "Fenêtre de récupération (heures)",
    help: "Un contenu publié avant cette fenêtre est ignoré à la récolte. Sert aussi au contrôle de date : un article plus ancien que la fenêtre (+ 7 jours) est signalé « date à vérifier ». 48 à 72 h en quotidien ; 336 (14 jours) est une valeur de démonstration." },
  request_timeout_ms: { section: "recolte", label: "Délai par source (ms)",
    help: "Temps maximal accordé à une source pour répondre. Au-delà, la source est comptée en échec pour cette récolte, sans bloquer les autres." },
  max_items_per_source: { section: "recolte", label: "Contenus max. par source",
    help: "Nombre maximal de contenus retenus par source et par récolte. Le relever augmente la mémoire consommée et le nombre d'appels LLM qui suivent." },

  /* --- zones couvertes (M3-74) --- */
  zones_covered: { section: "zones", label: "Départements couverts",
    help: "Le périmètre éditorial. Un article situé dans un département coché est « habilité » ; ailleurs, il est « hors zone ». Cocher une région coche tous ses départements. La liste est aussi citée au modèle comme zone de référence. Après un changement, « Recalculer les scores » (onglet Dernier run) reclasse les articles déjà produits." },
  generate_out_of_zone: { section: "zones", label: "Générer les sujets hors zone",
    help: "non : un sujet manifestement hors zone est écarté juste après l'extraction, sans payer l'appel de génération. Une notification garde le lien de la source. oui : il est rédigé comme les autres, puis signalé « non habilité » pour le relecteur. Dans le doute (aucun lieu net), le sujet est toujours généré." },
  console_default_dept: { section: "zones", label: "Département affiché par défaut",
    help: "Filtre posé à l'ouverture de la console, pour tout le monde. Chacun peut le lever d'un clic. Doit faire partie des départements couverts. Vide : aucun filtre." },
  dedup_threshold: { section: "recolte", label: "Seuil anti-doublon (0 à 1)",
    help: "Similarité de sujet (titre + début du texte) à partir de laquelle un contenu est écarté comme doublon d'un article existant, avant tout appel LLM. Plus bas = plus de contenus écartés. 0,5 par défaut." },

  /* --- notation (grille + prompt) --- */
  signs_max: { section: "notation", label: "Longueur maximale (signes)",
    help: "Au-dessus, l'article échoue au critère de longueur. Le prompt l'annonce aussi comme plafond d'un article." },
  h2_above_signs: { section: "notation", label: "Seuil des intertitres (signes)",
    help: "Au-delà de cette longueur, un article doit porter des intertitres H2 (grille) et le modèle est prié d'en mettre (prompt). En deçà, c'est une brève, sans intertitre. Doit rester inférieur ou égal à la longueur maximale." },
  outline_h2_min: { section: "notation", label: "Intertitres H2 minimum",
    help: "Nombre de H2 exigés au-delà du seuil des intertitres. 0 = les intertitres deviennent facultatifs, pour la grille comme pour le prompt." },
  meta_title_min: { section: "notation", label: "Balise titre min. (caractères)",
    help: "Longueur minimale de la balise titre (SEO). Doit rester inférieure au maximum." },
  meta_title_max: { section: "notation", label: "Balise titre max. (caractères)",
    help: "Longueur maximale de la balise titre (SEO). Au-delà, le SEO est « à revoir »." },
  meta_desc_min: { section: "notation", label: "Méta-description min. (caractères)",
    help: "Longueur minimale de la méta-description. Doit rester inférieure au maximum." },
  meta_desc_max: { section: "notation", label: "Méta-description max. (caractères)",
    help: "Longueur maximale de la méta-description." },
  keywords_min: { section: "notation", label: "Mots-clés minimum",
    help: "Nombre minimal de mots-clés pour que le SEO soit conforme." },
  ranking_threshold: { section: "notation", label: "Seuil du ranking éditorial (0 à 100)",
    help: "Ranking à partir duquel un article est « aligné » et passe le critère de conformité. Il ne figure pas dans le prompt : le ranking est fixé par le relecteur." },
  signs_per_minute: { section: "notation", label: "Vitesse de lecture (signes/min)",
    help: "Sert seulement à afficher le temps de lecture estimé d'un article. Ce n'est pas un temps de relecture : vérifications et corrections n'y sont pas." },

  /* --- prompt seulement --- */
  title_min: { section: "prompt", label: "Titre min. (caractères)",
    help: "Longueur minimale du titre demandée au modèle. Doit rester inférieure au titre max." },
  title_max: { section: "prompt", label: "Titre max. (caractères)",
    help: "Longueur maximale du titre demandée au modèle." },
  h2_title_max: { section: "prompt", label: "Intertitre max. (caractères)",
    help: "Longueur maximale d'un intertitre demandée au modèle." },
  breve_signs_min: { section: "prompt", label: "Brève minimale (signes)",
    help: "Longueur plancher demandée au modèle, pour une brève comme pour un article. Doit rester inférieure au seuil des intertitres." },
  title_source_pct: { section: "prompt", label: "Titre visé (% du titre de la source)",
    help: "Longueur du titre et de la balise titre demandée au modèle, en pourcentage du titre de la source, bornée par leurs minimum et maximum. 0 = règle désactivée : seul le maximum compte, comme avant." },
  meta_source_pct: { section: "prompt", label: "Méta-description visée (% du chapô)",
    help: "Longueur de la méta-description demandée au modèle, en pourcentage du chapô (à défaut, du premier paragraphe) de la source, bornée par la méta-description min. et max. 0 = règle désactivée, comme avant." },
  slug_max_words: { section: "prompt", label: "Slug : mots max.",
    help: "Nombre maximal de mots du slug (l'adresse de l'article). 0 = sans limite." },
  length_source_pct: { section: "prompt", label: "Longueur visée (% de la source)",
    help: "Longueur demandée au modèle, en pourcentage des signes utiles de la source (mentions légales retirées), bornée par la brève minimale et la longueur maximale : une source courte donne le minimum, une source longue le maximum. Le modèle reçoit cette cible à ±20 %, et l'article qui en sort est contrôlé sur la même fenêtre. 0 = règle désactivée : la consigne redevient « proportionnée à la matière »." },

  /* --- appels LLM --- */
  llm_max_tokens: { section: "llm", label: "Sortie max. (tokens)",
    help: "Plafond de la réponse du modèle, par appel. 4 096 tokens couvrent environ 15 000 caractères. Sans lui, une sortie qui part en boucle se paierait jusqu'à la limite du modèle." },
  llm_timeout_ms: { section: "llm", label: "Délai par tentative (ms)",
    help: "Temps maximal d'un appel au modèle, lecture de la réponse comprise. Au-delà, l'appel est coupé et l'article passe en mock. À relever si « délai dépassé » revient souvent." },
  llm_test_concurrency: { section: "llm", label: "Test des modèles : appels simultanés",
    help: "« Récupérer la liste » (onglet LLM) teste ensuite chaque modèle du catalogue par un appel d'un token. Nombre d'appels menés en même temps : plus haut, le test finit plus vite, mais une passerelle comme OpenRouter peut répondre 429 à notre propre rafale, et le modèle passe alors pour indisponible à tort." },

  rules_retry_max: { section: "llm", label: "Relances si une règle n'est pas tenue",
    help: "Chaque article généré est contrôlé sur les règles chiffrées ci-dessus (titre, intertitres, longueur visée, méta-description, mots-clés, intertitres exigés). Une règle manquée : l'article est redemandé au modèle, avec la liste des écarts, jusqu'à ce nombre de fois. Chaque relance se paie comme une génération et s'arrête au plafond de dépense. Écart persistant : l'article est signalé « Règles non tenues ». 0 = contrôle et signalement sans relance." },

  llm_fallback_provider: { section: "llm", label: "Moteur de secours",
    help: "Moteur de l'onglet LLM appelé quand le moteur actif échoue (erreur réseau, 5xx, quota, relances épuisées, modèle refusé). Après une bascule, la run reste sur le secours ; la suivante redonne sa chance au moteur actif. La bascule est notifiée et tracée dans la run. Il lui faut une clé et un modèle, et il doit être activé. « aucun » : repli direct sur le mock, comme avant." },

  llm_fallback_model: { section: "llm", label: "Modèle de secours",
    help: "Modèle du moteur de secours à appeler à la place de son modèle par défaut. Permet un secours sur le même moteur que l'actif avec un autre modèle (ex. OpenRouter mistral small en principal, openai en secours). Vide : modèle par défaut du moteur. Le modèle doit passer la liste blanche." },

  llm_review_enabled: { section: "llm", label: "Relecture automatique",
    help: "oui : chaque article généré est comparé à sa source par le moteur de relecture ci-dessous (hallucinations, fautes), et le verdict est gardé avec l'article. Seul un verdict « rejet » signale l'article ; les suggestions de consigne sont relevées dans la run, pour affiner le prompt. Chaque relecture se paie comme un appel et s'arrête au plafond de dépense. non : aucune relecture." },
  llm_review_provider: { section: "llm", label: "Moteur de relecture",
    help: "Moteur de l'onglet LLM qui relit les articles, de préférence plus puissant que le moteur de génération. Il lui faut une clé et un modèle. « mock » : relecture mécanique gratuite (nombres absents de la source, typographie), pour essayer la chaîne sans payer — elle ne juge ni le sens ni la langue." },
  llm_regen_max: { section: "llm", label: "Relances sur hallucination",
    help: "Quand la relecture rejette un article (hallucination), il est redemandé au plus ce nombre de fois, aux moteurs de la liste ci-dessous pris dans l'ordre. Chaque relance se paie comme une génération et s'arrête au plafond de dépense. Rejet persistant : l'article est signalé et une notification est émise. 0 = aucune relance." },
  llm_regen_engines: { section: "llm", label: "Moteurs des relances",
    help: "Liste ordonnée « moteur:modèle, moteur:modèle » des moteurs à qui redemander un article rejeté par la relecture. Chaque moteur doit exister dans l'onglet LLM ; le mock et les routeurs (openrouter/auto, modèles « ~… » ou « …router ») sont refusés à l'enregistrement, leur modèle réel variant d'un appel à l'autre. Vide : aucune relance, quel que soit le nombre ci-dessus." },
  llm_review_model: { section: "llm", label: "Modèle de relecture",
    help: "Modèle du moteur de relecture à appeler à la place de son modèle par défaut, par exemple un modèle plus puissant du même fournisseur. Vide : modèle par défaut du moteur. Le modèle doit passer la liste blanche." },

  /* --- plafond de dépense --- */
  llm_cap_run_usd: { section: "plafond", label: "Par run ($)",
    help: "Dépense maximale d'une génération, en dollars OpenRouter. Une régénération à la demande compte comme une run." },
  llm_cap_run_tokens: { section: "plafond", label: "Par run (tokens)",
    help: "Même plafond en tokens : le seul qui borne un moteur qui ne renvoie pas de coût (Anthropic, modèle gratuit)." },
  llm_cap_day_usd: { section: "plafond", label: "Par jour ($)",
    help: "Dépense cumulée maximale sur la journée, heure de Paris, régénérations comprises." },
  llm_cap_day_tokens: { section: "plafond", label: "Par jour (tokens)",
    help: "Même plafond journalier, en tokens." },
  llm_cap_month_usd: { section: "plafond", label: "Par mois ($)",
    help: "Dépense cumulée maximale sur le mois calendaire, heure de Paris." },
  llm_cap_month_tokens: { section: "plafond", label: "Par mois (tokens)",
    help: "Même plafond mensuel, en tokens." },
  llm_cap_action: { section: "plafond", label: "Au plafond",
    help: "stop : plus aucun appel ; les contenus restants attendent la run suivante et une régénération est refusée. mock : la génération continue avec des articles factices, signalés comme tels. Dans les deux cas, notification « Plafond LLM atteint »." },

  /* --- publication --- */
  wp_target: { section: "publication", label: "Site WordPress cible",
    help: "Adresse du site de destination. La publication est encore simulée : l'adresse sert à construire le lien affiché (adresse/slug), rien n'est envoyé." },

  /* --- console --- */
  home_min_role: { section: "console", label: "Écran d'accueil à partir du rôle",
    help: "Rôle minimal qui voit l'écran d'accueil (état de la veille). Les rôles en dessous ouvrent directement sur la Relecture." },

  /* --- clavier --- */
  keys_enabled: { section: "clavier", label: "Raccourcis clavier",
    help: "non : plus aucun raccourci pour personne, sauf « ? » et Échap. Chacun peut déjà les couper pour lui-même dans ses Préférences ; ce réglage sert à les couper pour tous." },
  keys_decisions: { section: "clavier", label: "Décider au clavier",
    help: "non : seule la navigation dans la file reste au clavier. Renvoyer à l'IA, remettre dans la file, envoyer en parution et classer redeviennent accessibles à la souris seulement. Utile si l'équipe préfère que toute décision passe par un clic." },
  keys_confirm: { section: "clavier", label: "Double frappe exigée",
    help: "risquees : parution et classement demandent deux frappes, le reste part du premier coup — c'est le réglage conseillé. toutes : toute action au clavier demande confirmation. aucune : plus aucune confirmation, y compris pour envoyer en parution — une frappe de trop au milieu d'une série devient alors irrattrapable." },

  /* --- archivage automatique (M3-102) --- */
  feat_archivage_auto: { section: "feat", label: "Archivage automatique des articles non traités",
    help: "oui : les articles Brouillon, À revoir et Signalé plus vieux que la durée ci-dessous (comptée depuis leur génération) passent en Archivé, une fois par heure, au nom du système. Visible dans l'Historique (Par : Archivage automatique) et dans le Journal. non : rien n'est archivé automatiquement." },
  archivage_auto_heures: { section: "feat", label: "Archivage automatique : délai (heures)",
    help: "Âge, depuis la génération, au-delà duquel un article non traité est archivé quand l'archivage automatique est à oui. Un passage par heure : un article peut donc attendre jusqu'à une heure de plus." },
  purge_retention_days: { section: "feat", label: "Effacement des articles purgés (jours)",
    help: "Après ce nombre de jours, un article PURGÉ est effacé. Sa fiche minimale (UUID, source, titre, dates, auteurs) reste, et se retrouve par son UUID dans l'Historique : le même contenu source n'est pas régénéré. 0 (par défaut) : jamais effacé." },

  /* --- crawlers de repli de la récolte (M3-57) --- */
  harvest_render_fallback: { section: "feat", label: "Crawlers de repli (récolte)",
    help: "non : récolte actuelle seule (HTML statique). playwright : quand une page liste ne donne rien (refus 403, aucun lien, aucun article, page construite en JavaScript), elle est rechargée avec ses articles dans un Chromium headless, sous l'identité M3 et sans camouflage. Un site qui refuse encore reste en échec. Compter environ 20 s par source concernée et 150 Mo de mémoire pendant la récolte ; nécessite Playwright et Chromium dans l'image du worker : avec crawlee, l'image passe de 784 Mo à 1,48 Go (mesuré le 26/10). furtif : déclenché seulement sur un refus 403, la page est redemandée avec camouflage, en imitant un vrai navigateur (crawlee, en Node). C'est un contournement des protections anti-robot. Une source dont l'essai réussit entre d'elle-même dans la liste blanche et sera récoltée ainsi ensuite ; si l'essai échoue, elle est mise de côté et une alerte est levée. Nécessite crawlee dans l'image du worker. Sans installation, la valeur est sans effet et la récolte le signale dans le diagnostic de la source. Mesure du 26/10 sur les 4 sources en 403 : playwright 0 article ; seuls les crawlers camouflés en récupèrent 3, sur 2 sources (CCI, ADEME)." },

  /* --- FEAT (M3-83) : une ligne par fonction expérimentale, tirée du registre --- */
  ...Object.fromEntries(Object.values(FEATS).map((f) => [f.setting, { section: "feat", label: f.label,
    help: `${f.help} Rôle minimal qui y a accès ; « aucun » la ferme à tous, administrateur compris.` }])),
};
