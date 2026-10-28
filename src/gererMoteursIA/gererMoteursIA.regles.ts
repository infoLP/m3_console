// Règles pures de l'onglet LLM : quels modèles proposer (liste blanche,
// moteur exempté), ce que le bandeau d'en-tête doit dire ; et les prompts de
// génération (M3-56).

import { resolvePrompt, validateTemplate } from "@shared/promptTemplate.js";
import { estRouteur } from "@shared/moteurs.js";

/* Routeur ou alias (openrouter/auto, ~…) : modèle variable, affiché à part. */
export const AVERTISSEMENT_ROUTEUR = "modèle variable : choisi par le routeur à chaque appel, coût et longueurs imprévisibles";
export { estRouteur };

export interface Moteur {
  id: string;
  label: string;
  kind: string;
  baseUrl: string;
  enabled: boolean;
  active: boolean;
  hasKey: boolean;
  keyHint?: string | null;
  defaultModel?: string | null;
  modelAllowed?: boolean;
  models?: string[];
  modelsFetchedAt?: string | null;
  fetchModels?: boolean;
  /* false = exempté de la liste blanche (OpenRouter, M3-68). */
  allowlist?: boolean;
  /* Test des modèles du catalogue (migration 015). */
  modelTests?: TestsModeles | null;
}

export interface VerdictModele { ok: boolean; at: string; ms?: number; status?: number | null; motif?: string }

export interface TestsModeles {
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  total?: number;
  stopped?: string | null;
  results?: Record<string, VerdictModele>;
}

export interface Moteurs {
  providers: Moteur[];
  activeId: string | null;
  kinds?: Record<string, string>;
  secretsAvailable: boolean;
  allowedModels?: string[];
  /* Moteur de secours (M3-88), lu dans les réglages : null = aucun. */
  secoursId?: string | null;
  /* Moteur de relecture automatique (M3-89), null si la relecture est désactivée. */
  relectureId?: string | null;
  /* Relecture automatique activée dans les Paramètres (M3-89). */
  relectureActive?: boolean;
  /* Moteur + modèle : modèle réglé pour le secours ou la relecture, null = le
     modèle par défaut du moteur. */
  secoursModel?: string | null;
  relectureModel?: string | null;
}

/* Modèle qu'appellera le secours (ou la relecture) : le modèle réglé, sinon
   celui du moteur. */
export const modeleSecours = (p: Moteur, m: Moteurs) => (m.secoursModel || p.defaultModel || "").trim();
export const modeleRelecture = (p: Moteur, m: Moteurs) => (m.relectureModel || p.defaultModel || "").trim();

/* Rôle d'un moteur, en plus de « actif » : secours désigné. Le secours n'est
   appelé que s'il est utilisable et distinct du moteur actif — par le moteur OU
   par le modèle : le moteur actif appelé avec un autre modèle est un vrai filet.
   L'écran le dit plutôt que de laisser croire à un filet qui n'existe pas. */
export function etatSecours(p: Moteur, m: Moteurs): null | { ok: boolean; motif?: string } {
  if (!m.secoursId || m.secoursId !== p.id) return null;
  const modele = modeleSecours(p, m);
  if (p.active && modele === (p.defaultModel || "").trim()) return { ok: false, motif: "même moteur et même modèle que l'actif : aucun filet" };
  if (!p.enabled) return { ok: false, motif: "désactivé" };
  if (!p.hasKey) return { ok: false, motif: "sans clé" };
  if (!modele) return { ok: false, motif: "sans modèle" };
  const v = verdictDe(p, modele);
  if (v && !v.ok) return { ok: false, motif: `son modèle a échoué au dernier test (${v.motif || "sans motif"})` };
  return { ok: true };
}

/* Au-delà, une demande « en attente » ou « en cours » est tenue pour perdue :
   worker tué en plein test. Sans ce délai, l'onglet sonderait pour toujours. */
export const TEST_PERIME_MS = 30 * 60 * 1000;

export type EtatTests =
  | { phase: "aucun" }
  | { phase: "attente" }
  | { phase: "en_cours"; total: number; faits: number; ko: number }
  | { phase: "fini"; total: number; faits: number; ko: number; stopped: string | null; finishedAt: string | null; interrompu: boolean };

const ms = (iso?: string | null) => (iso ? Date.parse(iso) || 0 : 0);

export function etatTests(p: Moteur, maintenant = Date.now()): EtatTests {
  const t = p.modelTests;
  if (!t || (!t.startedAt && !t.queuedAt)) return { phase: "aucun" };
  if (ms(t.queuedAt) > ms(t.startedAt) && maintenant - ms(t.queuedAt) < TEST_PERIME_MS) return { phase: "attente" };
  if (!t.startedAt) return { phase: "aucun" };
  const v = Object.values(t.results || {});
  const compte = { total: t.total || 0, faits: v.length, ko: v.filter((x) => !x.ok).length };
  if (!t.finishedAt && maintenant - ms(t.startedAt) < TEST_PERIME_MS) return { phase: "en_cours", ...compte };
  return { phase: "fini", ...compte, stopped: t.stopped || null, finishedAt: t.finishedAt || null, interrompu: !t.finishedAt };
}

export const testEnCours = (p: Moteur) => ["attente", "en_cours"].includes(etatTests(p).phase);

/* Verdict du dernier test pour un modèle, ou null s'il n'a pas été testé. */
export const verdictDe = (p: Moteur, model: string): VerdictModele | null => p.modelTests?.results?.[model] || null;

export const valeurSecours = (id: string | null) => (id && id.trim() ? id : "aucun");

/* Les champs qu'un formulaire de carte envoie. La clé ne part que si elle a
   été saisie — jamais vide. */
export interface Brouillon {
  label: string;
  baseUrl: string;
  defaultModel: string;
  fetchModels: boolean;
  enabled: boolean;
  apiKey: string;
}

export const brouillonDe = (p: Moteur): Brouillon => ({
  label: p.label, baseUrl: p.baseUrl, defaultModel: p.defaultModel || "", fetchModels: !!p.fetchModels, enabled: !!p.enabled, apiKey: "",
});

export function patchDe(b: Brouillon): Record<string, unknown> {
  const patch: Record<string, unknown> = { label: b.label, baseUrl: b.baseUrl, defaultModel: b.defaultModel, fetchModels: b.fetchModels, enabled: b.enabled };
  if (b.apiKey.trim()) patch.apiKey = b.apiKey.trim();
  return patch;
}

/* Les modèles à proposer : ceux du catalogue que la liste blanche autorise
   (`usable`), moins ceux qui ont échoué au dernier test (`disponibles`). Un
   échec n'est plus grisé mais retiré de la liste — à l'affichage seulement : le
   catalogue en base reste entier, et le test suivant peut le rendre.
   - le modèle déjà choisi reste proposé même en échec, avec son motif (`ko`) :
     on ne le retire pas d'un <select> sous les pieds de l'utilisateur, un 429
     peut être passager, et l'alerte de la carte le signale ;
   - test en attente ou en cours (`enTest`) : aucune liste, seulement le modèle
     choisi — les verdicts arrivent au fil de l'eau, la liste ne vaut qu'à la fin. */
export function modelesProposes(p: Moteur, allowedModels: string[] | undefined, defaultModel: string) {
  const models = Array.isArray(p.models) ? p.models : [];
  const exempt = p.allowlist === false;
  const allowed = new Set(allowedModels || []);
  const usable = exempt ? models : models.filter((m) => allowed.has(m));
  const ko = (m: string) => { const v = verdictDe(p, m); return v && !v.ok ? v.motif || "échec au test" : null; };
  const disponibles = usable.filter((m) => !ko(m));
  const enTest = testEnCours(p);
  /* Routeurs et alias (`routeur`) : gardés choisissables pour un essai, mais
     rangés après les autres — l'écran les groupe à part, avec un avertissement. */
  const options = [...new Set([defaultModel, ...(enTest ? [] : disponibles)].filter(Boolean))].map((m): { value: string; horsListe: boolean; routeur: boolean; ko?: string } => {
    const motif = ko(m);
    return { value: m, horsListe: !exempt && !allowed.has(m), routeur: estRouteur(m), ...(motif ? { ko: motif } : {}) };
  }).sort((a, b) => Number(a.routeur) - Number(b.routeur));
  return { exempt, models, usable, disponibles, ecartes: usable.length - disponibles.length, enTest, options };
}

export const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export type Bandeau = { kind: "hors_liste"; label: string; model: string } | { kind: "ok"; label: string; model: string } | { kind: "mock"; conseil: string };

/* Dire d'emblée ce qui sert réellement : c'est la question qu'on se pose en
   ouvrant cet écran, et la réponse « mock » doit sauter aux yeux. */
export function bandeau(m: Moteurs): Bandeau {
  const actif = m.providers.find((p) => p.id === m.activeId);
  if (actif && actif.hasKey && actif.defaultModel && !actif.modelAllowed) return { kind: "hors_liste", label: actif.label, model: actif.defaultModel };
  if (actif && actif.hasKey && actif.defaultModel) return { kind: "ok", label: actif.label, model: actif.defaultModel };
  return { kind: "mock", conseil: actif ? (actif.hasKey ? "Choisir un modèle" : `Renseigner la clé de « ${actif.label} »`) : "Activer un moteur" };
}

/* ------------------------------------------------- prompts de génération */

/* Prompts de génération (M3-56) : le prompt général et ses surcharges par
   moteur ou par modèle. La validation et la résolution sont CELLES du serveur
   (shared/promptTemplate.js, pur) : l'écran montre les erreurs avant
   l'enregistrement, le serveur les refuse de toute façon. */

export interface VariablePrompt { nom: string; description: string; exemple?: string; requise?: boolean }

/* Une ligne de llm_prompts. `template` null = surcharge supprimée. */
export interface VersionPrompt {
  id: string;
  providerId: string | null;
  model: string | null;
  template: string | null;
  createdAt: string;
  createdBy: string | null;
  version: number | null;
}

export interface PromptsLLM {
  prompts: VersionPrompt[];
  variables: VariablePrompt[];
  required: string[];
  defaultTemplate: string;
  outputFormat: string;
  maxLength: number;
}

export type Portee = "general" | "moteur" | "modele";

/* Une portée éditable de l'écran. `courant` : la surcharge en vigueur à ce
   niveau, null s'il n'y en a pas (jamais posée, ou supprimée). */
export interface CiblePrompt {
  cle: string;
  portee: Portee;
  providerId: string | null;
  model: string | null;
  libelle: string;
  courant: VersionPrompt | null;
}

/* Un identifiant de modèle peut contenir « : » ou « / » : clé en JSON. */
export const cleCible = (providerId: string | null, model: string | null) => JSON.stringify([providerId || null, model || null]);

const versionDe = (rows: VersionPrompt[], providerId: string | null, model: string | null) =>
  rows.find((r) => (r.providerId ?? null) === providerId && (r.model ?? null) === model) || null;

const actif = (v: VersionPrompt | null) => (v && v.template != null ? v : null);

/* Portées à proposer : le général, chaque moteur entier, puis les modèles qui
   ont une surcharge en vigueur — et ceux qu'on vient d'ajouter à l'écran
   (`ajouts`), pas encore enregistrés. Une surcharge de modèle supprimée
   disparaît de la liste ; son historique reste en base. */
export function ciblesPrompts(data: PromptsLLM, moteurs: Moteur[], ajouts: { providerId: string; model: string }[] = []): CiblePrompt[] {
  const rows = data.prompts || [];
  const out: CiblePrompt[] = [{ cle: cleCible(null, null), portee: "general", providerId: null, model: null, libelle: "Prompt général", courant: actif(versionDe(rows, null, null)) }];
  for (const p of moteurs) {
    out.push({ cle: cleCible(p.id, null), portee: "moteur", providerId: p.id, model: null, libelle: `${p.label} — tout le moteur`, courant: actif(versionDe(rows, p.id, null)) });
    const modeles = new Set([
      ...rows.filter((r) => r.providerId === p.id && r.model && r.template != null).map((r) => r.model as string),
      ...ajouts.filter((a) => a.providerId === p.id).map((a) => a.model.trim()).filter(Boolean),
    ]);
    for (const m of [...modeles].sort()) {
      out.push({ cle: cleCible(p.id, m), portee: "modele", providerId: p.id, model: m, libelle: `${p.label} — ${m}`, courant: actif(versionDe(rows, p.id, m)) });
    }
  }
  return out;
}

const PORTEES: Record<string, string> = { modele: "surcharge du modèle", moteur: "surcharge du moteur", general: "prompt général", defaut: "prompt par défaut du code" };

/* Ce qui s'applique À CE NIVEAU sans sa propre surcharge : la résolution du
   serveur, cette portée exclue. C'est le texte de départ d'une nouvelle
   surcharge, et ce que l'écran annonce (« hérite de … »). */
export function heritage(c: CiblePrompt, data: PromptsLLM): { template: string; source: string } {
  const rows = (data.prompts || []).filter((r) => !((r.providerId ?? null) === c.providerId && (r.model ?? null) === c.model));
  const r = resolvePrompt(rows, c.providerId, c.model) as { template: string; scope: string; version: number | null };
  return { template: r.template, source: `${PORTEES[r.scope] || r.scope}${r.version ? ` (version ${r.version})` : ""}` };
}

/* Texte affiché dans la zone de saisie : la surcharge en vigueur, sinon ce
   dont la portée hérite. */
export const texteInitial = (c: CiblePrompt, data: PromptsLLM) => c.courant?.template ?? heritage(c, data).template;

/* Erreurs du texte saisi — mêmes règles que le serveur. */
export const erreursPrompt = (texte: string): string[] => validateTemplate(texte) as string[];

/* Insère `{{nom}}` à la place de la sélection [debut, fin) ; rend le texte et
   la position du curseur, juste après la variable. */
export function insererVariable(texte: string, debut: number, fin: number, nom: string) {
  const d = Math.max(0, Math.min(debut, texte.length));
  const f = Math.max(d, Math.min(fin, texte.length));
  const jeton = `{{${nom}}}`;
  return { texte: texte.slice(0, d) + jeton + texte.slice(f), curseur: d + jeton.length };
}

/* Légende des variables (M3-111) : trois familles, dans l'ordre de lecture
   d'un prompt. Une variable absente des listes (ajoutée côté serveur sans
   mise à jour d'ici) tombe dans « Autres » plutôt que de disparaître. */
const FAMILLES_VARIABLES: { titre: string; aide: string; noms: string[] }[] = [
  { titre: "Matière et contexte", aide: "Ce que l'article raconte, et pour qui.", noms: ["consigne_mode", "zone", "date_source", "elements_extraits", "rubriques", "grille_ranking"] },
  { titre: "Règles chiffrées des Paramètres", aide: "Calculées depuis l'onglet Paramètres : le contrôle après génération vérifie les mêmes valeurs.", noms: ["regle_longueur", "regle_titre", "regle_h2", "intertitre_max", "regle_balise_titre", "regle_meta", "regle_slug", "mots_cles_min"] },
  { titre: "Phrases conditionnelles", aide: "Phrase complète avec son retour à la ligne, ou rien du tout quand elle est sans objet.", noms: ["phrase_date_source", "phrase_partenariat", "consigne_relecteur"] },
];

export function famillesVariables(variables: VariablePrompt[]): { titre: string; aide: string; variables: VariablePrompt[] }[] {
  const parNom = new Map(variables.map((v) => [v.nom, v]));
  const vues = new Set<string>();
  const out = FAMILLES_VARIABLES.map((f) => {
    const vs = f.noms.map((n) => parNom.get(n)).filter((v): v is VariablePrompt => !!v);
    vs.forEach((v) => vues.add(v.nom));
    return { titre: f.titre, aide: f.aide, variables: vs };
  });
  const autres = variables.filter((v) => !vues.has(v.nom));
  if (autres.length) out.push({ titre: "Autres", aide: "", variables: autres });
  return out.filter((f) => f.variables.length > 0);
}

/* Fil d'héritage d'une portée (M3-111) : du niveau édité jusqu'au défaut du
   code, chaque maillon avec son état. « en_vigueur » : celui que la
   génération utilise pour cette portée (même règle que resolvePrompt, un texte
   invalide en base étant sauté) ; « masque » : un texte existe mais un niveau
   plus précis l'emporte ; « ignore » : un texte existe mais ne passe plus la
   validation, la génération le saute ; « vide » : rien à ce niveau. */
export type EtatMaillon = "en_vigueur" | "masque" | "ignore" | "vide";
export function filHeritage(c: CiblePrompt, data: PromptsLLM, moteurs: Moteur[]): { portee: Portee | "defaut"; libelle: string; etat: EtatMaillon }[] {
  const rows = data.prompts || [];
  const gagnant = (resolvePrompt(rows, c.providerId, c.model) as { scope: string }).scope;
  const moteur = moteurs.find((p) => p.id === c.providerId);
  const niveaux: { portee: Portee | "defaut"; libelle: string; providerId: string | null; model: string | null }[] = [];
  if (c.portee === "modele") niveaux.push({ portee: "modele", libelle: `Modèle ${c.model}`, providerId: c.providerId, model: c.model });
  if (c.portee !== "general") niveaux.push({ portee: "moteur", libelle: `Moteur ${moteur?.label || c.providerId}`, providerId: c.providerId, model: null });
  niveaux.push({ portee: "general", libelle: "Prompt général", providerId: null, model: null });
  let passe = false;
  const out = niveaux.map((n) => {
    const present = !!actif(versionDe(rows, n.providerId, n.model));
    const etat: EtatMaillon = n.portee === gagnant ? "en_vigueur" : !present ? "vide" : passe ? "masque" : "ignore";
    if (n.portee === gagnant) passe = true;
    return { portee: n.portee, libelle: n.libelle, etat };
  });
  out.push({ portee: "defaut", libelle: "Défaut du code", etat: gagnant === "defaut" ? "en_vigueur" : "masque" });
  return out;
}

/* Aperçu surligné (M3-111) : chaque `{{nom}}` est entouré de marques de la
   zone d'usage privé avant l'envoi à l'aperçu du serveur, qui les recopie
   telles quelles autour de la valeur rendue ; `segmentsApercu` les retire et
   rend les morceaux, valeurs de variables repérées. Le texte enregistré, lui,
   n'est jamais balisé. */
const M_DEBUT = "\uE000", M_NOM = "\uE001", M_FIN = "\uE002";
export const baliserPourApercu = (texte: string) =>
  texte.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (m, nom: string) => `${M_DEBUT}${nom}${M_NOM}${m}${M_FIN}`);
export function segmentsApercu(rendu: string): { texte: string; variable?: string }[] {
  const out: { texte: string; variable?: string }[] = [];
  const re = new RegExp(`${M_DEBUT}([a-z][a-z0-9_]*)${M_NOM}([\\s\\S]*?)${M_FIN}`, "g");
  let i = 0;
  for (const m of rendu.matchAll(re)) {
    if (m.index > i) out.push({ texte: rendu.slice(i, m.index) });
    out.push({ texte: m[2], variable: m[1] });
    i = m.index + m[0].length;
  }
  if (i < rendu.length) out.push({ texte: rendu.slice(i) });
  return out;
}

/* Ligne d'état d'une portée, sous son titre. */
export function etatCible(c: CiblePrompt, data: PromptsLLM): string {
  if (c.courant) return `Surcharge en vigueur — version ${c.courant.version ?? "?"}${c.courant.createdBy ? `, par ${c.courant.createdBy}` : ""}`;
  const h = heritage(c, data);
  return `${c.portee === "general" ? "Aucun prompt général en base" : "Aucune surcharge propre"} — s'applique : ${h.source}.`;
}

/* Modèles proposés pour une nouvelle surcharge de modèle : le catalogue du
   moteur, et son modèle par défaut s'il n'y figure pas. */
/* Sans les routeurs : le modèle réellement appelé change à chaque appel, un
   prompt propre à « openrouter/auto » ne viserait aucun modèle précis. */
export const modelesPourSurcharge = (p: Moteur) => [...new Set([p.defaultModel || "", ...(Array.isArray(p.models) ? p.models : [])].filter((m) => m && !estRouteur(m)))];
