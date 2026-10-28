/* Géo-localisation éditoriale : déduire le vrai département d'un article
   depuis son contenu (et non depuis le département de la source).
   Périmètre habilité = les départements COUVERTS, réglés au back-office
   (zones_covered, shared/zones.js — M3-74 / M3-77). Le défaut reste la
   Nouvelle-Aquitaine. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/racine.js";
import { DEPARTEMENTS, REGIONS } from "../../shared/geoFrance.js";
import { DEFAULT_ZONES, regionOf, regionName, regionCovered } from "../../shared/zones.js";

/* --- variantes écrites à la main ---------------------------------------------
   Elles précèdent le référentiel de l'INSEE et le complètent : formes courtes
   (« Brive »), pays et îles (« Aunis », « Ré »), communes fusionnées depuis
   (« Marennes »), petites communes choisies une à une. Contrôle croisé du
   2026-10-13 : aucune ne contredit l'INSEE sur le département. Elles se
   reconnaissent sans majuscule, comme avant : chacune a été choisie pour ne pas
   être un mot courant. */

/* nom de département (et variantes) → numéro */
const DEPT_ALIASES = {
  "charente-maritime": "17", "charente maritime": "17",
  "charente": "16",
  "corrèze": "19", "correze": "19",
  "creuse": "23",
  "dordogne": "24", "périgord": "24", "perigord": "24",
  "gironde": "33", "bordeaux métropole": "33", "bordeaux metropole": "33",
  "landes": "40",
  "lot-et-garonne": "47", "lot et garonne": "47",
  "pyrénées-atlantiques": "64", "pyrenees-atlantiques": "64", "pays basque": "64", "béarn": "64", "bearn": "64",
  "deux-sèvres": "79", "deux-sevres": "79",
  "vienne": "86",
  "haute-vienne": "87", "haute vienne": "87", "limousin": "87",
};

/* communes / lieux notables → numéro de département */
const COMMUNE_DEPT = {
  // 17 — Charente-Maritime
  "la rochelle": "17", "rochefort": "17", "saintes": "17", "royan": "17", "saint-jean-d'angély": "17", "saint-jean-d'angely": "17",
  "jonzac": "17", "aytré": "17", "aytre": "17", "périgny": "17", "perigny": "17", "surgères": "17", "surgeres": "17",
  "marennes": "17", "oléron": "17", "oleron": "17", "ré": "17", "île de ré": "17", "ile de re": "17", "saint-martin-de-ré": "17",
  "saint-georges-de-didonne": "17", "tonnay-charente": "17", "lagord": "17", "puilboreau": "17", "la jarne": "17",
  "pons": "17", "saujon": "17", "la tremblade": "17", "fouras": "17", "châtelaillon-plage": "17", "chatelaillon": "17",
  "aigrefeuille-d'aunis": "17", "courçon": "17", "matha": "17", "montendre": "17", "saint-pierre-d'oléron": "17",
  "aunis": "17", "saintonge": "17", "vals de saintonge": "17", "bassin de marennes": "17",
  // 33 — Gironde
  "bordeaux": "33", "mérignac": "33", "merignac": "33", "pessac": "33", "talence": "33", "bègles": "33", "begles": "33",
  "libourne": "33", "arcachon": "33", "gradignan": "33", "cenon": "33", "lormont": "33", "villenave-d'ornon": "33",
  "gujan-mestras": "33", "la teste-de-buch": "33", "saint-médard-en-jalles": "33", "blanquefort": "33", "bassens": "33",
  "rive droite": "33", "bassin d'arcachon": "33", "médoc": "33", "blaye": "33", "lesparre-médoc": "33",
  "langon": "33", "la réole": "33", "saint-andré-de-cubzac": "33", "ambès": "33", "le bouscat": "33", "eysines": "33",
  "floirac": "33", "gironde": "33", "bordeaux métropole": "33",
  // 64 — Pyrénées-Atlantiques
  "pau": "64", "bayonne": "64", "biarritz": "64", "anglet": "64", "hendaye": "64", "saint-jean-de-luz": "64",
  "oloron-sainte-marie": "64", "orthez": "64", "billère": "64", "billere": "64", "lons": "64", "mourenx": "64",
  "hasparren": "64", "cambo-les-bains": "64", "saint-palais": "64", "pays basque": "64", "béarn": "64",
  // 40 — Landes
  "mont-de-marsan": "40", "dax": "40", "biscarrosse": "40", "saint-paul-lès-dax": "40", "capbreton": "40", "hagetmau": "40",
  "saint-vincent-de-tyrosse": "40", "tarnos": "40", "parentis-en-born": "40", "soustons": "40", "aire-sur-l'adour": "40",
  "morcenx": "40", "mimizan": "40", "labenne": "40",
  // 24 — Dordogne
  "périgueux": "24", "perigueux": "24", "bergerac": "24", "sarlat": "24", "sarlat-la-canéda": "24", "boulazac": "24",
  "trélissac": "24", "trelissac": "24", "nontron": "24", "terrasson": "24", "ribérac": "24", "montpon-ménestérol": "24",
  "le bugue": "24", "thiviers": "24", "coulounieix-chamiers": "24", "périgord": "24",
  // 47 — Lot-et-Garonne
  "agen": "47", "villeneuve-sur-lot": "47", "marmande": "47", "nérac": "47", "nerac": "47", "tonneins": "47", "le passage": "47",
  "fumel": "47", "sainte-livrade-sur-lot": "47", "casteljaloux": "47", "boé": "47", "bon-encontre": "47",
  // 79 — Deux-Sèvres
  "niort": "79", "bressuire": "79", "parthenay": "79", "thouars": "79", "saint-maixent-l'école": "79",
  "melle": "79", "cerizay": "79", "mauléon": "79", "chauray": "79", "airvault": "79", "coulonges-sur-l'autize": "79",
  // 86 — Vienne
  "poitiers": "86", "châtellerault": "86", "chatellerault": "86", "buxerolles": "86", "montmorillon": "86", "loudun": "86",
  "chauvigny": "86", "civaux": "86", "jaunay-marigny": "86", "migné-auxances": "86", "neuville-de-poitou": "86", "futuroscope": "86",
  // 87 — Haute-Vienne
  "limoges": "87", "saint-junien": "87", "panazol": "87", "isle": "87", "couzeix": "87", "aixe-sur-vienne": "87",
  "saint-yrieix-la-perche": "87", "bellac": "87", "rochechouart": "87", "condat-sur-vienne": "87", "feytiat": "87", "limousin": "87",
  // 16 — Charente
  "angoulême": "16", "angouleme": "16", "cognac": "16", "soyaux": "16", "la couronne": "16", "ruelle-sur-touvre": "16",
  "la rochefoucauld": "16", "barbezieux": "16", "confolens": "16", "gond-pontouvre": "16", "champniers": "16", "jarnac": "16",
  // 19 — Corrèze
  "brive-la-gaillarde": "19", "brive": "19", "tulle": "19", "ussel": "19", "malemort": "19", "égletons": "19",
  "objat": "19", "allassac": "19", "seilhac": "19",
  // 23 — Creuse
  "guéret": "23", "gueret": "23", "la souterraine": "23", "aubusson": "23", "bourganeuf": "23", "boussac": "23", "sainte-feyre": "23",
};

/* Anciennes régions et noms d'usage → code de région actuel. */
const REGION_VARIANTS = {
  "nouvelle aquitaine": "75", "aquitaine": "75", "poitou-charentes": "75",
  "rhone-alpes": "84", "auvergne": "84", "provence": "93", "alsace": "44", "lorraine": "44",
  "champagne-ardenne": "44", "midi-pyrenees": "76", "languedoc-roussillon": "76",
  "bourgogne": "27", "franche-comte": "27", "picardie": "32", "nord-pas-de-calais": "32",
};

/* Formules de portée régionale. « Outre-mer » n'est PAS un lieu hors zone : il
   marque une portée nationale (« 09 70… depuis l'Outre-Mer et l'étranger », avis
   ANTS relayé par la préfecture du 17), et l'ancienne liste qui le comptait ne le
   voyait que faute de reconnaître « l'Outre-Mer » derrière l'apostrophe. */
const REGION_PHRASES = ["a l'echelle regionale", "au niveau regional", "toute la region"];

/* Une commune d'un département NON couvert ne compte comme « lieu hors zone » qu'à
   partir de cette population. Les grandes villes suffisent à reconnaître un sujet
   d'ailleurs ; en dessous, trop de noms sont aussi des mots ou des marques
   (« Orange », « Sens », « Avion »), et chacun ferait signaler un sujet local.
   L'ancienne liste écrite à la main ne comptait qu'une vingtaine de grandes villes. */
const OUTSIDE_COMMUNE_MIN_POP = 20000;

/* --- lexique --------------------------------------------------------------- */

/* Minuscules, sans accents, apostrophe droite, espaces simples. */
export function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
}

/* Par ROOT et non par `new URL(…, import.meta.url)` : empaqueté par Next.js, ce
   fichier ne vit plus à côté de son JSON (cf. src/lib/racine.js). */
const GAZ = JSON.parse(readFileSync(join(ROOT, "src", "generate", "communes.fr.json"), "utf8"));

/* nom normalisé → entrées { kind, dept?, region?, label, pop, curated }.
   kind : commune | dept | region | phrase. `curated` = reconnu sans
   majuscule (listes ci-dessus) ; sinon, le nom doit commencer par une capitale
   dans le texte d'origine : « la mer » n'est pas Mer (41), « une réunion » n'est
   pas La Réunion. */
const LEX = new Map();
function add(name, e) {
  const k = norm(name);
  if (!LEX.has(k)) LEX.set(k, []);
  LEX.get(k).push(e);
}
const inseeLabel = new Map();
for (const [nom, dept, pop] of GAZ.communes) {
  add(nom, { kind: "commune", dept, label: nom, pop, curated: false });
  inseeLabel.set(`${norm(nom)}|${dept}`, nom);
}
for (const [name, dept] of Object.entries(COMMUNE_DEPT)) {
  add(name, { kind: "commune", dept, label: inseeLabel.get(`${norm(name)}|${dept}`) || titleCase(name), pop: Infinity, curated: true });
}
for (const [name, dept] of Object.entries(DEPT_ALIASES)) add(name, { kind: "dept", dept, label: DEPARTEMENTS[dept].name, pop: Infinity, curated: true });
for (const [dept, d] of Object.entries(DEPARTEMENTS)) add(d.name, { kind: "dept", dept, label: d.name, pop: Infinity, curated: false });
for (const [region, name] of Object.entries(REGIONS)) add(name, { kind: "region", region, label: name, pop: Infinity, curated: false });
for (const [name, region] of Object.entries(REGION_VARIANTS)) add(name, { kind: "region", region, label: REGIONS[region], pop: Infinity, curated: false });
for (const p of REGION_PHRASES) add(p, { kind: "phrase", label: p, pop: Infinity, curated: true });
const MAX_WORDS = Math.max(...[...LEX.keys()].map((k) => k.split(" ").length));

/* Ponctuation = séparateur. Apostrophes et traits d'union restent dans le mot :
   ils font partie des noms (« Saint-Jean-d'Angély »). `tight` : le mot suit le
   précédent sans autre séparateur qu'une espace. */
function tokenize(text) {
  const s = String(text || "").replace(/[’`]/g, "'");
  const out = [];
  let end = 0;
  for (const m of s.matchAll(/[^\s,.;:!?()«»"“”/[\]{}…|]+/g)) {
    out.push({ o: m[0], f: norm(m[0]), tight: out.length > 0 && /^[ \t]+$/.test(s.slice(end, m.index)) });
    end = m.index + m[0].length;
  }
  return out;
}

/* « Sophie Bourg, directrice… » : une commune collée à un mot à majuscule qui
   n'est pas lui-même un lieu est le plus souvent un nom de personne. Ne vaut que
   pour les communes de l'INSEE ; les variantes écrites à la main restent
   reconnues partout. */
const capital = (w) => /^\p{Lu}/u.test(w);
/* Mots-outils qui prennent une majuscule en tête de phrase (« À Grenoble, … ») :
   ils précèdent un lieu, pas un nom de famille. */
const LEAD_WORDS = new Set(["a", "au", "aux", "en", "dans", "sur", "sous", "vers", "de", "du", "des", "le", "la", "les",
  "pour", "par", "pres", "entre", "depuis", "hors", "chez", "et", "ou", "mais", "a cote", "face", "via", "outre"]);
const personLike = (toks, i, placeEnd) => {
  if (i === 0 || !toks[i].tight || placeEnd === i) return false;
  const prev = toks[i - 1];
  return capital(prev.o) && /^\p{L}{3,}$/u.test(prev.o) && !LEAD_WORDS.has(prev.f);
};

const covers = (e, cov) =>
  (e.dept && cov.includes(e.dept)) || (e.kind === "region" && regionCovered(e.region, cov)) || e.kind === "phrase";

/* Entre homonymes (Saint-Denis 93 / 974, Vienne 38 / 86), on retient d'abord
   celui qui est couvert, puis une variante écrite à la main, puis le plus peuplé. */
function pick(cands, cov) {
  return [...cands].sort((a, b) => (covers(b, cov) - covers(a, cov)) || (b.curated - a.curated) || (b.pop - a.pop))[0];
}

/* Lieux cités dans `text`, au plus long d'abord : « Charente Maritime » n'est pas
   aussi « Charente ». Une élision en tête (« d'Oléron », « l'Isle ») est retirée
   si le mot entier n'est pas reconnu. */
function scan(text, cov) {
  const toks = tokenize(text);
  // coveredNames : lieux de la zone cités, clé normalisée → libellé (contrôle des lieux inventés, M3-85)
  const out = { score: {}, communeByDept: {}, outside: new Map(), regionHint: false, coveredNames: new Map() };
  const hits = new Map();
  let placeEnd = -1; // indice du mot qui suit le dernier lieu reconnu
  for (let i = 0; i < toks.length;) {
    let hit = null;
    for (let len = Math.min(MAX_WORDS, toks.length - i); len >= 1 && !hit; len--) {
      for (const elide of [false, true]) {
        const parts = toks.slice(i, i + len).map((t) => t.f);
        let first = toks[i].o;
        if (elide) {
          const m = parts[0].match(/^(?:l|d|qu|j|n|s|c)'(.+)$/);
          if (!m) continue;
          parts[0] = m[1];
          first = first.replace(/^\p{L}+'/u, "");
        }
        const key = parts.join(" ");
        const cands = LEX.get(key);
        if (!cands) continue;
        const cap = capital(first);
        const person = !elide && personLike(toks, i, placeEnd);
        const ok = cands.filter((e) => e.curated || (cap && !(person && e.kind === "commune")));
        if (!ok.length) continue;
        hit = { key, e: pick(ok, cov), len };
        break;
      }
    }
    if (!hit) { i++; continue; }
    i += hit.len;
    placeEnd = i;
    record(hit, out, cov, hits);
  }
  return out;
}

function record({ key, e }, out, cov, hits) {
  if (e.kind === "phrase") { out.regionHint = true; return; }
  if (e.kind === "region") {
    if (regionCovered(e.region, cov)) { out.regionHint = true; out.coveredNames.set(key, e.label); }
    else out.outside.set(key, e.label);
    return;
  }
  if (!cov.includes(e.dept)) {
    if (e.kind === "dept" || e.curated || e.pop >= OUTSIDE_COMMUNE_MIN_POP) out.outside.set(key, e.label);
    return;
  }
  out.coveredNames.set(key, e.label);
  if (e.kind === "dept") {
    if (!hits.has(key)) out.score[e.dept] = (out.score[e.dept] || 0) + 2; // nom de dépt = contexte
    hits.set(key, 1);
    return;
  }
  // commune = signal fort : 3, puis +1 par mention supplémentaire, plafonné à +2
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  out.score[e.dept] = (out.score[e.dept] || 0) + (n === 1 ? 3 : n <= 3 ? 1 : 0);
  if (!out.communeByDept[e.dept]) out.communeByDept[e.dept] = e.label;
}

/* Commune saisie à la main dans le référentiel des sources → son département
   (pré-remplissage de la zone, M3-78). La saisie est libre : « LA ROCHELLE »,
   « ST SAVINIEN », « SAINT PIERRE D'OLERON » — casse, accents, espaces contre
   traits d'union et abréviation « St » sont donc ignorés. Seules les communes
   connues du référentiel (≥ 2 000 hab. et variantes manuelles) sont trouvées ;
   un homonyme sans commune couverte est renvoyé comme ambigu plutôt que deviné.
   → { dept, label } | { ambiguous: [depts] } | null */
const loose = (s) => norm(s).replace(/^st[e]?[ -]/, (m) => (m.startsWith("ste") ? "sainte-" : "saint-")).replace(/[\s-]+/g, "-");
const BY_LOOSE = new Map();
for (const [k, list] of LEX) {
  for (const e of list) {
    if (e.kind !== "commune") continue;
    const lk = loose(k);
    if (!BY_LOOSE.has(lk)) BY_LOOSE.set(lk, []);
    if (!BY_LOOSE.get(lk).some((x) => x.dept === e.dept)) BY_LOOSE.get(lk).push(e);
  }
}
export function resolveCommune(name, covered = DEFAULT_ZONES) {
  const cands = BY_LOOSE.get(loose(name));
  if (!cands || !cands.length) return null;
  if (cands.length > 1) {
    const inCov = cands.filter((e) => covered.includes(e.dept));
    if (inCov.length !== 1) return { ambiguous: cands.map((e) => e.dept) };
    return { dept: inCov[0].dept, label: inCov[0].label };
  }
  return { dept: cands[0].dept, label: cands[0].label };
}

/* Lieux repérés dans un texte, pour les tests et le diagnostic : départements
   couverts avec leur score, lieux hors zone, mention d'une région couverte. */
export function placesIn(text, covered = DEFAULT_ZONES) {
  const s = scan(text, covered);
  return { score: s.score, communes: s.communeByDept, outside: [...s.outside.values()], regionHint: s.regionHint };
}

/* Lieux de la zone couverte que l'article cite et que la SOURCE ne cite pas (M3-85).
   Le 13/10, un article sur un supplément VINCI pour le Var a écrit « notamment en
   Nouvelle-Aquitaine » : rien de tel dans la source. Le modèle fabrique un ancrage
   local quand on lui en demande un ; ce contrôle le voit, quelle que soit la cause.
   Comparaison par clé normalisée — « Nouvelle Aquitaine » et « Nouvelle-Aquitaine »
   sont le même lieu, mais une variante peut manquer : le contrôle signale, il
   n'efface rien, et le relecteur tranche. → libellés absents de la source. */
export function unsourcedPlaces(generatedText, sourceText, covered = DEFAULT_ZONES) {
  const gen = scan(generatedText, covered).coveredNames;
  const src = scan(sourceText, covered);
  const srcKeys = new Set([...src.coveredNames.keys()].map((k) => k.replace(/[\s-]+/g, " ")));
  /* Une région nommée dans la source couvre ses départements et communes cités par
     l'article : « en Charente-Maritime » pour une source qui dit « La Rochelle »
     n'est pas une invention. On ne compare donc que le même niveau de précision :
     un lieu de l'article doit être nommé tel quel dans la source, OU appartenir à un
     département dont la source cite déjà un lieu. */
  const srcDepts = new Set(Object.keys(src.score));
  const out = [];
  for (const [k, label] of gen) {
    if (srcKeys.has(k.replace(/[\s-]+/g, " "))) continue;
    const e = pick(LEX.get(k) || [], covered);
    if (e?.dept && srcDepts.has(e.dept)) continue;
    // « à La Rochelle, en Nouvelle-Aquitaine » : la région d'un lieu de la source n'est pas inventée
    if (e?.kind === "region" && [...srcDepts].some((d) => regionOf(d) === e.region)) continue;
    out.push(label);
  }
  return out;
}

/* Localité renvoyée par l'extraction : un champ, pas une phrase — reconnue sans
   exiger de majuscule. */
function lookup(name, cov) {
  const cands = LEX.get(norm(name));
  return cands ? { key: norm(name), e: pick(cands, cov) } : null;
}

/* --- géo-tag ------------------------------------------------------------------ */

/* Renvoie {num, dept, region, commune, regionOnly, outsideNA, matched, origin}
   origin : "locality" | "content" | "source" | "region" | "outside".
   `outsideNA` garde son nom (il est stocké dans les articles) mais veut dire
   désormais « hors des zones couvertes ». */
export function detectZone(text, opts = {}) {
  return analyse(text, opts).zone;
}

function analyse(text, { extractedLocality, region = "Nouvelle-Aquitaine", sourceDept = null, sourceRegion = null, covered = DEFAULT_ZONES } = {}) {
  const cov = covered;
  const s = scan(`${extractedLocality || ""}\n${text || ""}`, cov);
  const done = (zone) => ({ zone, scan: s });

  // 1. localité extraite d'abord (plus fiable), si elle est dans la couverture
  const loc = extractedLocality ? lookup(extractedLocality, cov) : null;
  if (loc && (loc.e.kind === "commune" || loc.e.kind === "dept") && cov.includes(loc.e.dept)) {
    return done(zoneFor(loc.e.dept, loc.e.kind === "commune" ? loc.e.label : null, region, false, "locality", cov));
  }
  if (loc && !covers(loc.e, cov)) record(loc, s, cov, new Map());

  // 2. comptage des mentions dans le contenu
  const outside = s.outside.size;
  const ranked = Object.entries(s.score).sort((a, b) => b[1] - a[1]);
  const topSc = ranked.length ? ranked[0][1] : 0;

  // un lieu hors zone est cité et l'ancrage local est faible → signaler
  const suspect = outside >= 1 && topSc < outside * 3 + 3;

  if (ranked.length && topSc > 0) {
    const [num, sc] = ranked[0];
    const tie = ranked[1] && ranked[1][1] === sc;
    // commune uniquement si elle appartient au département retenu
    if (!tie) return done(zoneFor(num, s.communeByDept[num] || null, region, suspect, "content", cov));
  }

  // 3. aucune commune couverte retenue, mais un lieu hors zone est cité → sujet
  //    probablement non local. Prioritaire sur le repli source (étape 4) : une info
  //    nationale relayée par une préfecture départementale n'est pas « du » département.
  if (outside >= 1 && !s.regionHint) return done(zoneFor("HS", null, region, true, "outside", cov));

  // 4. repli sur le département de la SOURCE, uniquement si elle est explicitement
  //    départementale (champ `dept` curé : préfecture, CD, ADIL, SDIS, chambre
  //    départementale…). Marqué origin:"source" → confiance moindre pour le relecteur.
  const srcDept = normDept(sourceDept);
  if (srcDept && !s.regionHint) return done(zoneFor(srcDept, null, region, false, "source", cov));

  // 4 bis. source rattachée à une RÉGION (conseil régional, DREAL…, M3-78) : portée
  //    régionale de cette région, habilitée si l'un de ses départements est couvert.
  if (sourceRegion && REGIONS[sourceRegion] && !s.regionHint) {
    return done({ ...regionZone(regionName(sourceRegion)), origin: "source" });
  }

  // 5. aucun signal → publication à portée régionale (jamais un département par défaut).
  return done(regionZone(region));
}

/* Indices « hors zone » qui sont aussi des mots courants ou des marques : « une
   réunion », « un lot », « trop cher », « la somme de », « le nord du département »,
   « Orange »… Après génération ils ne coûtent qu'un signalement, que le relecteur
   lève ; avant, ils écarteraient un sujet local sans appel. Ils ne suffisent donc
   pas à écarter. */
const AMBIGUOUS_OUTSIDE = new Set(["reunion", "la reunion", "lot", "cher", "somme", "nord", "tours", "manche",
  "orne", "nice", "aude", "ain", "eure", "indre", "gard", "tarn", "loire", "rhone",
  "orange", "sens", "avion", "lens", "bourg", "moulins",
  /* L'outre-mer, lui, marque une portée NATIONALE plutôt qu'un autre lieu : « 100 maisons
     du don dans l'hexagone, en Martinique, Guadeloupe… » (EFS), « 09 70… depuis
     l'Outre-Mer » (avis ANTS relayé par la préfecture du 17). Rejoué le 2026-10-13
     sur les 73 articles locaux : ce sont les deux seuls écarts faux. */
  "guadeloupe", "martinique", "mayotte", "guyane"].map(norm));

/* M3-73 — Contrôle de périmètre AVANT la génération, l'appel LLM le plus coûteux.
   La localité est connue dès l'extraction : un sujet manifestement hors zone n'a
   pas à être rédigé, payé, puis signalé `hors_sujet`. Le pipeline ne l'appelle
   que si `generate_out_of_zone` vaut « non ».
   Écarter est sans appel, là où le signalement laisse le dernier mot au relecteur :
   on n'écarte donc que sur un signal net, et le contrôle après génération
   (finalizeGenerated) reste le filet pour tout le reste. Il faut à la fois :
   - que l'extraction (faits, entités, localité — le boilerplate en est exclu)
     tombe à l'étape 3 de detectZone : un lieu hors zone cité, aucune commune couverte ;
   - qu'au moins un de ces lieux ne soit pas un mot courant (AMBIGUOUS_OUTSIDE) ;
   - que la SOURCE brute ne cite ni commune, ni département, ni région couverts :
     si l'extraction a laissé tomber l'ancrage local, le doute profite au sujet.
   → { outside: false } ou { outside: true, places: [lieux hors zone retenus] } */
export function scopeBeforeGeneration(extracted = {}, rawText = "", { region = "Nouvelle-Aquitaine", sourceDept = null, covered = DEFAULT_ZONES } = {}) {
  // « Euronext Paris » est une cotation, pas un lieu : l'extraction le laisse parfois passer
  const text = [extracted.title_hint, ...(extracted.facts || []), ...(extracted.entities || []), extracted.angle]
    .filter(Boolean).join("\n").replace(/euronext\s+paris/gi, "Euronext");
  const { zone, scan: s } = analyse(text, { extractedLocality: extracted.locality, region, sourceDept, covered });
  if (zone.origin !== "outside") return { outside: false };

  const places = [...s.outside.keys()].filter((k) => !AMBIGUOUS_OUTSIDE.has(k));
  if (!places.length) return { outside: false };

  const raw = scan(rawText, covered);
  if (Object.keys(raw.score).length || raw.regionHint) return { outside: false };
  return { outside: true, places };
}

/* n° de département connu (« 17 », « 2A »…), sinon null */
function normDept(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (DEPARTEMENTS[s]) return s;
  const d = s.replace(/\D/g, "").slice(0, 2);
  return DEPARTEMENTS[d] ? d : null;
}

/* Publication à portée régionale : pas de département, mais dans le périmètre. */
function regionZone(region) {
  return { num: "NA", dept: "", region, commune: "", regionOnly: true, outsideNA: false, matched: true, origin: "region" };
}

function zoneFor(num, commune, region, outsideNA = false, origin = "content", cov = DEFAULT_ZONES) {
  const key = String(num);
  if (key === "HS") {
    return { num: "HS", dept: "", region, commune: "", regionOnly: false, outsideNA: true, matched: false, origin };
  }
  return {
    num: key,
    dept: DEPARTEMENTS[key]?.name || key,
    region: regionName(regionOf(key)) || region,
    commune: commune || "",
    regionOnly: false,
    outsideNA: outsideNA || !cov.includes(key),
    matched: true,
    origin,
  };
}

function titleCase(s) {
  return String(s).split(/[\s-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").replace(/\bDe\b/g, "de");
}
