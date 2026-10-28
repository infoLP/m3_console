/* Zones couvertes (M3-74) — partagé backend + navigateur. Aucune dépendance DOM.

   La couverture est une liste de codes de département, réglée au back-office
   (`zones_covered`). Le département est l'unité que tout le reste manipule déjà :
   géo-tag, rattachement des sources, filtre de la console. La région n'est qu'un
   raccourci de saisie (« toute la région ») et un libellé. */

import { REGIONS, DEPARTEMENTS, deptsOfRegion } from "./geoFrance.js";

/* Défaut : la Nouvelle-Aquitaine, périmètre du prototype. */
export const DEFAULT_ZONES = deptsOfRegion("75");

/* Codes triés comme le référentiel (« 2A » entre « 19 » et « 21 »). */
const ORDER = Object.keys(DEPARTEMENTS);
const byCode = (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b);

/* « 17, 16 ; 17 » → ["16", "17"]. Accepte un tableau ou une chaîne séparée par
   des virgules, points-virgules ou espaces. Un code inconnu est une erreur, et non
   une valeur ignorée : un département mal saisi qui disparaîtrait en silence
   sortirait du périmètre sans que personne le voie. « 2a » vaut « 2A ». */
export function parseZones(v) {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[\s,;]+/);
  const codes = [...new Set(raw.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  const unknown = codes.filter((c) => !DEPARTEMENTS[c]);
  if (unknown.length) throw new Error(`département(s) inconnu(s) : ${unknown.join(", ")}`);
  if (!codes.length) throw new Error("au moins un département doit être couvert");
  return codes.sort(byCode);
}

export const formatZones = (codes) => codes.join(",");

/* Couverture lue dans les réglages. readSettings a déjà validé la valeur ; le
   repli ne sert qu'aux appelants qui passent des réglages partiels (tests, outils). */
export function coveredOf(settings) {
  try { return parseZones(settings?.zones_covered ?? DEFAULT_ZONES); }
  catch { return DEFAULT_ZONES; }
}

export const regionOf = (dept) => DEPARTEMENTS[dept]?.region || null;
export const regionName = (code) => REGIONS[code] || "";
export const deptName = (dept) => DEPARTEMENTS[dept]?.name || "";

/* Régions touchées par la couverture, chacune avec ses départements couverts et
   un drapeau `whole` quand elle l'est entièrement. Ordre : la région la plus
   couverte d'abord. */
export function coverageByRegion(codes) {
  const m = new Map();
  for (const d of codes) {
    const r = regionOf(d);
    if (!r) continue;
    if (!m.has(r)) m.set(r, []);
    m.get(r).push(d);
  }
  return [...m].map(([region, depts]) => ({ region, name: regionName(region), depts, whole: depts.length === deptsOfRegion(region).length }))
    .sort((a, b) => b.depts.length - a.depts.length || a.region.localeCompare(b.region));
}

/* Libellé de la couverture, cité dans le prompt (« Région de référence ») et posé
   sur les publications à portée régionale. Il remplace le réglage `region`, qui
   ne changeait pas le périmètre et pouvait donc le contredire.
     Nouvelle-Aquitaine entière          → « Nouvelle-Aquitaine »
     17 seul                             → « Charente-Maritime (Nouvelle-Aquitaine) »
     Nouvelle-Aquitaine + Vendée         → « Nouvelle-Aquitaine, Vendée (Pays de la Loire) » */
export function coverageLabel(codes) {
  return coverageByRegion(codes).map((g) => g.whole
    ? g.name
    : `${g.depts.map(deptName).join(", ")} (${g.name})`).join(", ");
}

/* Couverture courante, pour les appelants qui ne lisent pas les réglages : le
   navigateur la reçoit de /api/me et la pose ici une fois. Le serveur, lui, passe
   toujours la couverture explicitement — ses réglages changent sans redémarrage. */
let current = DEFAULT_ZONES;
export function setCoverage(codes) {
  try { current = parseZones(codes); } catch { current = DEFAULT_ZONES; }
}
export const currentCoverage = () => current;

/* Une région est « couverte » dès qu'un de ses départements l'est : une
   publication à portée régionale concerne aussi ce département. */
export function regionCovered(regionCode, codes) {
  return codes.some((d) => regionOf(d) === String(regionCode));
}

/* code région d'après son nom (« Nouvelle-Aquitaine » → "75"), casse et accents ignorés. */
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export function regionCodeOf(name) {
  const f = fold(name);
  return Object.keys(REGIONS).find((r) => fold(REGIONS[r]) === f) || null;
}

/* --- zone des sources (M3-78) ---------------------------------------------- */

export const SCOPE_LEVELS = {
  commune: "Commune",
  departement: "Département",
  region: "Région",
  nationale: "Nationale",
};

/* Repli du géo-tag fourni par une source, quand le contenu ne cite aucun lieu.
   - commune / département → le département ;
   - région → la portée régionale de cette région ;
   - nationale → rien : seul le contenu peut situer l'article ;
   - non renseigné → le département s'il est saisi (comportement d'avant M3-78).
   Jamais la commune : une mairie peut parler d'un projet de l'intercommunalité. */
export function sourceFallback(s) {
  const lvl = s?.scopeLevel || null;
  const dept = s?.dept && DEPARTEMENTS[s.dept] ? s.dept : null;
  if (lvl === "nationale") return { dept: null, region: null };
  if (lvl === "region") return { dept: null, region: s.region && REGIONS[s.region] ? s.region : (dept ? regionOf(dept) : null) };
  return { dept, region: null };
}

/* Région d'une source, pour l'afficher et la filtrer : celle saisie au niveau
   régional, sinon celle de son département. */
export function sourceRegion(s) {
  if (s?.region && REGIONS[s.region]) return s.region;
  return s?.dept ? regionOf(s.dept) : null;
}

/* Région principale : celle qui compte le plus de départements couverts. */
export function mainRegionName(codes) {
  return coverageByRegion(codes)[0]?.name || "";
}

/* Zone d'une source en un seul champ texte (M3-78) : « 17 · Charente-Maritime »
   ou « Région · Nouvelle-Aquitaine ». Partagé depuis M3-92 : la demande de
   source de la console saisit la zone comme le back-office. */
export const zoneText = (s) => s.dept ? `${s.dept} · ${deptName(s.dept)}` : s.region ? `Région · ${regionName(s.region)}` : "";
/* Texte → { dept, region } ; vide → les deux à null ; inconnu → null. */
export function parseZoneText(v) {
  const t = String(v || "").trim();
  if (!t) return { dept: null, region: null };
  const r = t.match(/^R[ée]gion\s*·\s*(.+)$/i);
  if (r) { const code = regionCodeOf(r[1]); return code ? { dept: null, region: code } : null; }
  const d = t.match(/^(\w{2,3})\b/);
  const code = d && d[1].toUpperCase();
  return code && DEPARTEMENTS[code] ? { dept: code, region: null } : null;
}
/* Suggestions de saisie : les régions, puis les départements. */
export function zoneChoices() {
  const regions = Object.keys(REGIONS).sort((a, b) => regionName(a).localeCompare(regionName(b), "fr"));
  return [...regions.map((r) => `Région · ${regionName(r)}`), ...Object.keys(DEPARTEMENTS).map((d) => `${d} · ${deptName(d)}`)];
}
