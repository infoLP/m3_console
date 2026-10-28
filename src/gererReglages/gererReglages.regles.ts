// Règles pures de l'onglet Paramètres : rangement des réglages par section,
// description d'un réglage, zones couvertes (cases par département, rangées
// par région), icône du site.

import { SETTING_SECTIONS, SETTING_HELP } from "@shared/settingsHelp.js";
import { REGIONS, deptsOfRegion } from "@shared/geoFrance.js";
import { regionName, deptName } from "@shared/zones.js";

export interface Spec {
  type: "int" | "float" | "string" | "enum" | "zones" | "dept" | string;
  values?: string[];
  min?: number;
  max?: number;
  default: string | number;
}
export type Specs = Record<string, Spec>;
export type Valeurs = Record<string, string>;

export interface Aide { section?: string; label: string; help: string }
export interface Section { id: string; title: string; note?: string; keys: string[] }

const SECTIONS = SETTING_SECTIONS as { id: string; title: string; note?: string }[];
const AIDE = SETTING_HELP as Record<string, Aide>;

export const aideDe = (k: string): Aide | undefined => AIDE[k];

/* Les réglages sont rangés par thème et expliqués (shared/settingsHelp.js). Un
   réglage sans explication s'affiche quand même, sous « Autres ». */
export function sectionsAvecCles(specs: Specs): Section[] {
  const toutes = [...SECTIONS, { id: "autres", title: "Autres" }];
  return toutes
    .map((sec) => ({ ...sec, keys: Object.keys(specs).filter((k) => (AIDE[k]?.section || "autres") === sec.id) }))
    .filter((sec) => sec.keys.length);
}

export function valeursDe(settings: Record<string, unknown>, specs: Specs): Valeurs {
  return Object.fromEntries(Object.keys(specs).map((k) => [k, settings[k] == null ? "" : String(settings[k])]));
}

/* « Enregistrer » n'envoie que ce qui a changé depuis la dernière lecture
   (M3-109, B2) : envoyer tout poserait en base chaque réglage, et plus aucun ne
   suivrait la valeur du moteur (le défaut du code). */
export function valeursModifiees(valeurs: Valeurs, initiales: Valeurs): Valeurs {
  return Object.fromEntries(Object.entries(valeurs).filter(([k, v]) => v !== initiales[k]));
}

/* « Réglé ici » : une ligne existe en base (liste `stored` du serveur). Sinon
   le réglage prend la valeur par défaut du code. */
/* Clés « réglées ici » : en base ET différentes du défaut. Jusqu'à M3-109, le
   formulaire enregistrait TOUS les réglages à chaque clic : une installation
   existante a donc en base des valeurs égales au défaut, qu'on n'affiche pas
   comme un choix (sinon tout serait « réglé ici »). `valeurs` : les valeurs
   enregistrées, au format du formulaire (valeursDe). */
export function cleesRegleesIci(stored: Iterable<string>, valeurs: Valeurs, specs: Specs): Set<string> {
  return new Set([...stored].filter((k) => specs[k] && valeurs[k] !== undefined && valeurs[k] !== String(specs[k].default)));
}

export function etatReglage(k: string, reglees: ReadonlySet<string>): { regle: boolean; libelle: string } {
  const regle = reglees.has(k);
  return { regle, libelle: regle ? "réglé ici" : "valeur par défaut" };
}

export const texteDefaut = (spec: Spec): string => (String(spec.default) === "" ? "(vide)" : String(spec.default));

/* Conséquences écrites des confirmations sur place (M3-109, B4). */
export function consequenceRetourDefaut(libelle: string, spec: Spec): string {
  return `${libelle} repassera à sa valeur par défaut : ${texteDefaut(spec)}. La valeur réglée ici est retirée de la base (l'état précédent reste dans l'historique de configuration) ; le réglage suivra ensuite le défaut du code, même s'il change.`;
}

export const CONSEQUENCE_RETRAIT_ICONE =
  "L'icône du site sera supprimée, sans copie gardée : l'onglet du navigateur et les favoris reprendront l'icône par défaut du navigateur, sur la console, le back-office et la page de connexion. Pour la remettre, il faudra choisir le fichier à nouveau.";

export function descriptionSpec(spec: Spec): string {
  const base = spec.values ? spec.values.join(" · ") : spec.type === "int" ? "entier" : spec.type === "float" ? "nombre" : "texte";
  return `${base}${spec.min != null ? ` · ${spec.min} à ${spec.max}` : ""}`;
}

/* --- moteurs LLM désignés par un réglage (M3-88, M3-89) ---
   Le serveur les tient pour du texte (un identifiant de moteur) ; l'écran les
   propose en liste, nourrie par le registre de l'onglet LLM. Le moteur réglé
   reste dans la liste même s'il a disparu du registre : sinon le formulaire
   l'effacerait en silence au prochain enregistrement. */

export const REGLAGES_MOTEUR: Record<string, string[]> = {
  llm_fallback_provider: ["aucun"],
  llm_review_provider: ["aucun", "mock"],
};

export function avecMoteurs(specs: Specs, moteurs: { id: string }[], settings: Record<string, unknown> = {}): Specs {
  const out: Specs = { ...specs };
  for (const [k, fixes] of Object.entries(REGLAGES_MOTEUR)) {
    if (!out[k]) continue;
    const courant = settings[k] == null ? "" : String(settings[k]);
    const values = [...new Set([...fixes, ...moteurs.map((m) => m.id), courant].filter(Boolean))];
    out[k] = { ...out[k], values };
  }
  return out;
}

export const departementsCouverts =(valeurs: Valeurs) => String(valeurs.zones_covered || "").split(",").filter(Boolean);
export const nomDepartement = (d: string) => deptName(d);

/* --- zones couvertes (M3-74) --- */

export const zonesDepuisTexte = (v: string) => new Set(String(v || "").split(",").filter(Boolean));
export const texteZones = (sel: Set<string>) => [...sel].join(",");

export interface RegionZones { code: string; nom: string; depts: { code: string; nom: string }[]; n: number; toute: boolean }

/* Couvertes d'abord, puis la métropole par ordre alphabétique, l'outre-mer
   (codes « 0x ») à la fin. */
export function regionsPourZones(sel: Set<string>): RegionZones[] {
  return Object.keys(REGIONS as Record<string, string>)
    .map((r) => { const ds = deptsOfRegion(r) as string[]; const n = ds.filter((d) => sel.has(d)).length; return { code: r, nom: regionName(r), depts: ds.map((d) => ({ code: d, nom: deptName(d) })), n, toute: n === ds.length }; })
    .sort((a, b) => b.n - a.n || Number(a.code.startsWith("0")) - Number(b.code.startsWith("0")) || a.nom.localeCompare(b.nom, "fr"));
}

export function basculerDept(sel: Set<string>, d: string, coche: boolean): Set<string> {
  const n = new Set(sel);
  if (coche) n.add(d); else n.delete(d);
  return n;
}

export function basculerRegion(sel: Set<string>, r: string, coche: boolean): Set<string> {
  const n = new Set(sel);
  for (const d of deptsOfRegion(r) as string[]) { if (coche) n.add(d); else n.delete(d); }
  return n;
}

/* --- icône du site --- */

export interface Icone { type: string; bytes: number; etag: string }
export const ICONE_ACCEPT = "image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico,image/jpeg,image/webp,image/gif";
export const ICONE_MAX = 256 * 1024;

export function libelleIcone(i: Icone | null): string {
  if (!i) return "Aucune icône : le navigateur affiche la sienne.";
  return `${i.type.replace("image/", "").replace("svg+xml", "svg").toUpperCase()} · ${Math.ceil(i.bytes / 1024)} Ko`;
}

export function iconeTropLourde(taille: number): string | null {
  return taille > ICONE_MAX ? `Icône trop lourde : ${Math.ceil(taille / 1024)} Ko, 256 Ko au plus` : null;
}
