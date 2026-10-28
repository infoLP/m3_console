// Règles pures de l'onglet Dernier run : libellés de la planification, des
// demandes au worker et de leurs résultats.

export interface Planification {
  enabled: boolean;
  times: string[];
  error: string | null;
  next: string | null;
  lastSlot: string | null;
  running: string | null;
  lastRun: { slot: string; error?: string | null; harvest?: { items: number } | null; generation?: { created: number; cap?: unknown } | null } | null;
  lastSkipped: string | null;
}

export interface Demande {
  id: number;
  kind: "harvest" | "generate" | string;
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: ResultatRecolte | ResultatGeneration | null;
  error: string | null;
  duplicate?: boolean;
}
export interface ResultatRecolte { date: string | null; stats: { items?: number; carried?: number; setAside?: number }; skipped: number }
export interface ResultatGeneration { created: number; skipped: number; cap: { detail: string } | null; pending: number; fallbacks: number }

export interface Recolte {
  date: string;
  scheduled?: boolean;
  stats: { items: number; carried?: number; ok: number; sources: number; failures: number };
  sources: { name: string; ok: boolean; count?: number; error?: string }[];
  skipped: { name: string; reason?: string; detail?: string }[];
}

/* Une ligne de la collection « runs ». `routine` : identifiant de la routine
   (bail « chain ») qui l'a écrite, absent hors routine (M3-105). `stats.startedAt` :
   début de l'étape, présent depuis M3-109 seulement — les anciens runs n'ont que
   `at`, l'heure de FIN (récolte, génération) ou de début (schedule). */
export interface Run { id?: string; at: string; kind: string; stats: unknown; routine?: string }

export interface Executions {
  runs: Run[];
  harvest: Recolte | null;
  schedule: Planification | null;
  jobs: Demande[];
}

export const hm = (slot: string | null | undefined) => (slot ? `${slot.slice(8, 10)}/${slot.slice(5, 7)} à ${slot.slice(11)}` : "—");

export function texteDerniereChaine(sc: Planification): string {
  const last = sc.lastRun;
  if (!last) return "aucune chaîne planifiée exécutée";
  if (last.error) return `${hm(last.slot)} — ${last.error}`;
  return `${hm(last.slot)} — ${last.harvest ? `${last.harvest.items} contenus récoltés` : "récolte ?"}${last.generation ? `, ${last.generation.created} articles générés` : ""}${last.generation?.cap ? " (plafond de dépense atteint)" : ""}`;
}

export const LIBELLE_DEMANDE: Record<string, string> = { harvest: "récupération", generate: "génération" };
export const RAISON_SAUT: Record<string, string> = { ecartee: "à l'écart", pas_due: "pas due" };

export function etatDemande(j: Demande): { code: "echec" | "terminee" | "en_cours" | "en_attente"; libelle: string; pill: string } {
  if (j.finishedAt) return j.error ? { code: "echec", libelle: "échec", pill: "off" } : { code: "terminee", libelle: "terminée", pill: "on" };
  return j.startedAt ? { code: "en_cours", libelle: "en cours", pill: "a" } : { code: "en_attente", libelle: "en attente", pill: "a" };
}

export function resumeDemande(j: Demande): string {
  if (j.error) return j.error;
  if (!j.result) return "";
  if (j.kind === "harvest") {
    const r = j.result as ResultatRecolte;
    return `${r.stats?.items ?? "?"} contenus nouveaux${r.skipped ? ` · ${r.skipped} source(s) sautée(s)` : ""}`;
  }
  const g = j.result as ResultatGeneration;
  return `${g.created} articles, ${g.skipped} ignorés${g.cap ? " · plafond atteint" : ""}${g.fallbacks ? ` · ${g.fallbacks} appel(s) en mock` : ""}`;
}

/* Ce que le toast dit à la fin d'une demande suivie — mêmes textes qu'avant la
   phase 1, quand la réponse HTTP les portait. */
export function messageFin(j: Demande | null, kind: "harvest" | "generate"): { texte: string; erreur: boolean } {
  const nom = kind === "harvest" ? "Récupération" : "Génération";
  if (!j) return { texte: `${nom} toujours en attente — le worker tourne-t-il ?`, erreur: true };
  if (j.error) return { texte: `${nom} : ${j.error}`, erreur: true };
  if (kind === "harvest") {
    const s = (j.result as ResultatRecolte | null)?.stats || {};
    return { texte: `Récupération : ${s.items ?? "?"} contenus nouveaux${s.carried ? `, ${s.carried} reportés` : ""}${s.setAside ? ` · ${s.setAside} source(s) à l'écart` : ""}`, erreur: false };
  }
  const g = (j.result as ResultatGeneration | null) || { created: 0, skipped: 0, cap: null, pending: 0, fallbacks: 0 };
  const note = g.cap
    ? ` — ⚠ ${g.cap.detail}${g.pending ? `, ${g.pending} candidat(s) reportés` : ""}`
    : g.fallbacks ? ` — ⚠ LLM indisponible, ${g.fallbacks} appel(s) en mock` : "";
  return { texte: `Génération : ${g.created} articles, ${g.skipped} ignorés${note}`, erreur: !!(g.fallbacks || g.cap) };
}

/* ---------- Frise d'étapes (M3-109, axe B1) ---------- */

export const LIBELLE_ETAPE: Record<string, string> = {
  schedule: "chaîne planifiée", harvest: "récolte", generation: "génération", status: "changement de statut",
};

export interface Etape {
  kind: string;
  libelle: string;
  debut: string | null;   // null : run antérieur à M3-109, sans startedAt
  fin: string;
  dureeMs: number | null;
  resume: string;
}
export interface Passage {
  cle: string;            // identifiant de routine, ou du run isolé
  routine: boolean;
  debut: string;
  fin: string;
  dureeMs: number | null; // du premier début connu à la dernière fin
  etapes: Etape[];        // dans l'ordre chronologique
}

const ms = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null; };
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/* Durée lisible : « 850 ms », « 42 s », « 3 min 05 s », « 1 h 02 min ». */
export function duree(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

function resumeEtape(kind: string, stats: Record<string, unknown>): string {
  if (kind === "harvest") {
    const items = num(stats.items), ok = num(stats.ok), sources = num(stats.sources);
    return [items != null ? `${items} contenus` : null, ok != null && sources != null ? `${ok}/${sources} sources` : null].filter(Boolean).join(" · ");
  }
  if (kind === "generation") {
    const crees = num(stats.created), ignores = num(stats.skipped);
    return [crees != null ? `${crees} articles` : null, ignores ? `${ignores} ignorés` : null, stats.cap ? "plafond atteint" : null, num(stats.fallbacks) ? `${stats.fallbacks} en mock` : null].filter(Boolean).join(" · ");
  }
  if (kind === "schedule") return stats.error ? `erreur : ${String(stats.error)}` : stats.slot ? `créneau ${hm(String(stats.slot))}` : "";
  return "";
}

/* Durée d'une étape : de stats.startedAt à `at` pour la récolte et la génération
   (at = fin). La chaîne planifiée écrit son run au DÉBUT : elle n'a pas de fin
   propre, sa durée est celle de la routine. */
export function etapeDepuis(run: Run): Etape {
  const stats = obj(run.stats);
  const fin = run.at;
  const debut = run.kind === "schedule" ? run.at : typeof stats.startedAt === "string" ? stats.startedAt : null;
  const d = run.kind === "schedule" ? null : (() => { const a = ms(debut), b = ms(fin); return a != null && b != null && b >= a ? b - a : null; })();
  return { kind: run.kind, libelle: LIBELLE_ETAPE[run.kind] || run.kind, debut, fin, dureeMs: d, resume: resumeEtape(run.kind, stats) };
}

/* Regroupe les runs (les plus récents d'abord, comme la collection) par routine :
   une routine = une récolte puis une génération sous le même bail. Les runs hors
   routine (anciens, ou écrits hors bail) forment chacun leur passage. Ordre de
   sortie : le passage le plus récent d'abord ; étapes en ordre chronologique. */
export function frise(runs: Run[], max = 15): Passage[] {
  const groupes = new Map<string, Run[]>();
  const ordre: string[] = [];
  runs.forEach((r, i) => {
    const cle = r.routine || r.id || `run-${i}`;
    if (!groupes.has(cle)) { groupes.set(cle, []); ordre.push(cle); }
    groupes.get(cle)!.push(r);
  });
  return ordre.slice(0, max).map((cle) => {
    const etapes = groupes.get(cle)!.map(etapeDepuis)
      .sort((a, b) => (ms(a.debut ?? a.fin) ?? 0) - (ms(b.debut ?? b.fin) ?? 0));
    const debuts = etapes.map((e) => ms(e.debut)).filter((x): x is number => x != null);
    const fins = etapes.map((e) => ms(e.fin)).filter((x): x is number => x != null);
    const d0 = debuts.length ? Math.min(...debuts) : null;
    const f1 = fins.length ? Math.max(...fins) : null;
    const routine = groupes.get(cle)!.some((r) => !!r.routine);
    return {
      cle, routine,
      debut: d0 != null ? new Date(d0).toISOString() : etapes[0].fin,
      fin: f1 != null ? new Date(f1).toISOString() : etapes[etapes.length - 1].fin,
      dureeMs: d0 != null && f1 != null && f1 > d0 ? f1 - d0 : null,
      etapes,
    };
  });
}

/* Durée réelle d'une demande au worker (colonnes started_at / finished_at). */
export function dureeDemande(j: Demande): number | null {
  const a = ms(j.startedAt), b = ms(j.finishedAt);
  return a != null && b != null && b >= a ? b - a : null;
}
