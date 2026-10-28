/* Classifieur de rubrique par mots-clés — garde-fou sur le choix du LLM.
   5 rubriques du preREADME : Économie, Culture, Environnement, Société, Sport. */

const SIGNALS = {
  "Économie": [
    "entreprise", "entreprises", "emploi", "emplois", "embauche", "recrutement", "chiffre d'affaires",
    "investissement", "chantier", "usine", "commerce", "commerçant", "commerçants", "industrie", "artisan",
    "artisanat", "pme", "startup", "start-up", "croissance", "marché", "économie", "économique", "financement",
    "subvention", "obligations", "chômage", "salariés", "cci", "cma", "zone d'activité", "immobilier", "loyer",
    "loyers", "logement", "logements", "bailleur", "btp", "tourisme", "restauration", "hôtellerie", "export",
  ],
  "Culture": [
    "exposition", "festival", "musée", "musées", "artiste", "artistes", "spectacle", "concert", "théâtre",
    "cinéma", "patrimoine", "monument", "bibliothèque", "médiathèque", "livre", "littérature", "peinture",
    "sculpture", "danse", "opéra", "vernissage", "programmation culturelle", "scène", "galerie",
  ],
  "Environnement": [
    "eau", "rivière", "fleuve", "nappe", "sécheresse", "inondation", "climat", "carbone", "co2", "biodiversité",
    "pollution", "déchets", "recyclage", "énergie renouvelable", "éolien", "photovoltaïque", "solaire",
    "littoral", "érosion", "forêt", "agriculture", "agricole", "élevage", "éleveur", "éleveurs", "bovin", "bovins",
    "vétérinaire", "épizootie", "espèce", "faune", "flore", "nature", "zone humide", "transition écologique",
    "réchauffement", "canicule", "qualité de l'air", "espèces protégées", "pesticide", "phytosanitaire",
  ],
  "Société": [
    "habitants", "quartier", "école", "collège", "lycée", "université", "étudiants", "hôpital", "santé",
    "soignants", "patients", "épidémie", "vaccination", "association", "associations", "solidarité", "précarité",
    "pauvreté", "transport", "bus", "mobilité", "sécurité", "police", "gendarmerie", "justice", "tribunal",
    "élus", "conseil municipal", "conseil départemental", "préfecture", "citoyens", "famille", "familles",
    "personnes âgées", "handicap", "jeunesse", "insertion", "quartiers prioritaires", "logement social",
  ],
  "Sport": [
    // vocabulaire non ambigu uniquement (pas « équipe », « terrain », « coupe »…)
    "match", "matchs", "championnat", "tournoi", "compétition sportive", "sportif", "sportive", "sportives",
    "footballeur", "rugbyman", "entraîneur", "stade", "gymnase", "podium", "médaille", "médaillé",
    "football", "rugby", "basket-ball", "handball", "cyclisme", "natation", "athlétisme", "marathon",
    "arbitre", "supporters", "compétiteur", "présaison", "mi-temps", "vestiaire", "montée en division",
    "ligue 1", "ligue 2", "pro d2", "top 14", "jeux olympiques", "licenciés sportifs",
  ],
};

/* tokenisation simple : mots + bigrammes, insensible casse/accents */
function tokens(text) {
  const n = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const words = n.split(/[^a-z0-9']+/).filter(Boolean);
  const set = new Set(words);
  const joined = " " + words.join(" ") + " ";
  return { set, joined };
}
function norm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function classifyCategory(text) {
  const { set, joined } = tokens(text);
  const scores = {};
  for (const [cat, kws] of Object.entries(SIGNALS)) {
    let s = 0;
    for (const kw of kws) {
      const k = norm(kw);
      if (k.includes(" ")) { if (joined.includes(" " + k + " ")) s += 2; }
      else if (set.has(k)) s += 1;
    }
    scores[cat] = s;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [cat, score] = ranked[0];
  const runnerUp = ranked[1] ? ranked[1][1] : 0;
  return { cat, score, runnerUp, scores };
}

/* Décide si on doit surcharger le choix du LLM.
   Surcharge quand le LLM est contredit : sa rubrique n'a aucun signal dans le
   texte alors qu'une autre en a. « Sport » attribué à tort est le cas le plus
   fréquent — on le corrige dès qu'il n'y a aucun signal sportif. */
export function reconcileCategory(llmCat, text) {
  const c = classifyCategory(text);
  const llmScore = c.scores[llmCat] ?? 0;

  const best = Object.entries(c.scores)
    .filter(([cat]) => cat !== llmCat)
    .sort((a, b) => b[1] - a[1])[0] || ["Société", 0];

  // rubrique du LLM sans aucun signal + une autre nettement pourvue
  if (llmScore === 0 && best[1] >= 3 && best[1] - c.runnerUp >= 1) {
    return { cat: best[0], overridden: true, from: llmCat, evidence: best[1] };
  }
  // « Sport » sans le moindre signal sportif → presque toujours une erreur.
  // (le vocabulaire sportif est distinctif : un vrai sujet sport le déclenche)
  if (llmCat === "Sport" && c.scores.Sport === 0) {
    return { cat: best[1] > 0 ? best[0] : "Société", overridden: true, from: "Sport", evidence: best[1] };
  }
  return { cat: llmCat, overridden: false };
}
