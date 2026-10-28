// Relances après hallucination (M3-55) : mise en forme, sans JSX ni appel.
// Les données viennent de src/generate/relance.js (checks.regen d'un article,
// stats.regen d'une run, _llm.regen d'une régénération à la demande).

import { VERDICTS_RELECTURE } from "./relireArticles.regles";

export interface TentativeRegen {
  moteur?: string | null;
  modele?: string | null;
  relance?: boolean;
  verdict?: string | null;
  hallucinations?: number | null;
  motif?: string | null;
}

export type IssueRegen = "ok" | "hallucination_persistante" | "aucune_relance" | string;

export interface ChecksRegen { tentatives?: TentativeRegen[] | null; retenue?: number | null; issue?: IssueRegen | null }

export interface DiagnosticRegen {
  source?: string; vers?: string; modele?: string | null; verdict?: string; hallucinations?: number; resume?: string; suggestion?: string;
}

export interface StatsRegen {
  articles?: number; relances?: number; reussies?: number; persistantes?: number; sautes?: number; arrets?: number;
  suggestions?: string[]; diagnostics?: DiagnosticRegen[];
}

export interface LigneRelance {
  /** Rang dans la trace, à partir de 1 (1 = version d'origine). */
  numero: number;
  /** « Version d'origine » ou « Relance 2 ». */
  etape: string;
  /** « openai · luna », ou « openai » sans modèle. */
  moteur: string;
  verdict: string | null;
  /** « 2 hallucinations », « aucune hallucination » ; null si non jugée. */
  hallucinations: string | null;
  /** Raison d'un saut, d'un arrêt ou d'un échec ; null sinon. */
  motif: string | null;
  retenue: boolean;
  ton: "neutre" | "go" | "amber" | "stop";
}

const SAUTEE = /^sauté/;
const ARRET = /^plafond/;

const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pluriel = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const nomMoteur = (t?: TentativeRegen | null) => `${t?.moteur || "?"}${t?.modele ? ` · ${t.modele}` : ""}`;
const tentativesDe = (c?: ChecksRegen | null): TentativeRegen[] => (Array.isArray(c?.tentatives) ? (c!.tentatives as TentativeRegen[]) : []);
/* Une relance « faite » : l'appel est parti (réussi ou tombé). Ni sautée, ni coupée par le plafond. */
const faite = (t: TentativeRegen) => !!t.relance && !SAUTEE.test(t.motif || "") && !ARRET.test(t.motif || "");

function ton(t: TentativeRegen): LigneRelance["ton"] {
  if (t.motif || t.verdict == null) return "neutre";
  const v = VERDICTS_RELECTURE[t.verdict]?.ton;
  return v === "ok" ? "go" : v === "warn" ? "amber" : v === "stop" ? "stop" : "neutre";
}

/** checks.regen d'un article → une ligne par tentative (vide s'il n'y a rien). */
export function traceRelances(checksRegen: ChecksRegen | null | undefined): LigneRelance[] {
  const tentatives = tentativesDe(checksRegen);
  let rang = 0;
  return tentatives.map((t, i) => {
    if (t.relance) rang++;
    const h = t.hallucinations;
    return {
      numero: i + 1,
      etape: t.relance ? `Relance ${rang}` : "Version d'origine",
      moteur: nomMoteur(t),
      verdict: t.verdict ? VERDICTS_RELECTURE[t.verdict]?.label || t.verdict : null,
      hallucinations: typeof h === "number" ? (h === 0 ? "aucune hallucination" : pluriel(h, "hallucination")) : null,
      motif: t.motif || null,
      retenue: checksRegen?.retenue === i,
      ton: ton(t),
    };
  });
}

export interface ResumeRegen {
  titre: string;
  lignes: { libelle: string; valeur: string }[];
  suggestions: string[];
  diagnostics: { source: string; moteur: string; verdict: string; hallucinations: string; resume: string; suggestion: string }[];
}

/** stats.regen d'une run → données pour l'écran des exécutions ; null si la run n'en porte pas. */
export function resumeRegen(stats: StatsRegen | null | undefined): ResumeRegen | null {
  if (!stats || typeof stats !== "object") return null;
  const n = { articles: nombre(stats.articles), relances: nombre(stats.relances), reussies: nombre(stats.reussies), persistantes: nombre(stats.persistantes), sautes: nombre(stats.sautes), arrets: nombre(stats.arrets) };
  const rien = Object.values(n).every((v) => v === 0);
  return {
    titre: rien ? "Relances : aucune engagée" : `Relances après hallucination : ${pluriel(n.articles, "article")}`,
    lignes: rien ? [] : [
      { libelle: "Articles relancés", valeur: String(n.articles) },
      { libelle: "Relances effectuées", valeur: String(n.relances) },
      { libelle: "Réussies", valeur: String(n.reussies) },
      { libelle: "Hallucination persistante", valeur: String(n.persistantes) },
      { libelle: "Moteurs sautés", valeur: String(n.sautes) },
      { libelle: "Arrêts (plafond, relecture manquée)", valeur: String(n.arrets) },
    ],
    suggestions: Array.isArray(stats.suggestions) ? stats.suggestions.filter((s) => typeof s === "string" && s) : [],
    diagnostics: (Array.isArray(stats.diagnostics) ? stats.diagnostics : []).map((d) => ({
      source: d.source || "source",
      moteur: `${d.vers || "?"}${d.modele ? ` · ${d.modele}` : ""}`,
      verdict: d.verdict ? VERDICTS_RELECTURE[d.verdict]?.label || d.verdict : "",
      hallucinations: pluriel(nombre(d.hallucinations), "hallucination"),
      resume: d.resume || "",
      suggestion: d.suggestion || "",
    })),
  };
}

const ordinal = (n: number) => (n === 1 ? "1re" : `${n}e`);

/** _llm.regen après « Régénérer » → message court, ou null s'il n'y a rien à dire. */
export function messageRegeneration(llmRegen: ChecksRegen | null | undefined): string | null {
  const tentatives = tentativesDe(llmRegen);
  if (!llmRegen || !tentatives.some((t) => t.relance)) return null;
  const faites = tentatives.filter(faite).length;
  const sautees = tentatives.filter((t) => t.relance && SAUTEE.test(t.motif || "")).length;
  const plafond = tentatives.some((t) => t.relance && ARRET.test(t.motif || ""));
  const coupe = plafond ? " (plafond de dépense atteint)" : "";
  if (llmRegen.issue === "ok") {
    const i = typeof llmRegen.retenue === "number" ? llmRegen.retenue : -1;
    const rang = tentatives.slice(1, i + 1).filter(faite).length;
    const t = tentatives[i];
    if (!t || rang < 1) return `${pluriel(faites, "relance")}${coupe} : relecture passée`;
    return `${pluriel(faites, "relance")} : la ${ordinal(rang)} (${nomMoteur(t)}) passe la relecture`;
  }
  if (llmRegen.issue === "hallucination_persistante") return `hallucination persistante après ${pluriel(faites, "relance")}${coupe}, article signalé`;
  if (llmRegen.issue === "aucune_relance") return `aucune relance possible (${pluriel(sautees, "moteur sauté", "moteurs sautés")})${coupe}, article signalé`;
  return null;
}
