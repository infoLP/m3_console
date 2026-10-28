export interface Notification {
  id: string;
  type: string;
  severity?: "info" | "warning" | "error" | string;
  sourceName?: string;
  detail?: string;
  error?: string;
  url?: string;
  at: string;
  read: boolean;
}

export const LIBELLES: Record<string, string> = {
  source_inaccessible: "Source inaccessible", doublon: "Doublon détecté", echec_generation: "Échec de génération",
  hors_sujet: "Sujet non local", llm_degraded: "LLM en mode dégradé", llm_plafond: "Plafond LLM atteint",
  source_ecartee: "Source mise à l'écart", source_furtif: "Source passée en furtif", chaine_echec: "Chaîne planifiée en échec", source_trop_mince: "Source sans matière",
  date_suspecte: "Date à vérifier", publicite: "Publicité écartée", source_muette: "Source muette",
  llm_secours: "Moteur de secours utilisé", parution_bloquee: "Parution bloquée",
  llm_modele_ko: "Modèle LLM en échec au test", llm_hallucination: "Hallucination persistante",
  competitors_candidates: "Nouveaux domaines candidats",
};

export const libelle = (n: Notification) => LIBELLES[n.type] || n.type;
export const lienSource = (n: Notification) => (/^https?:\/\//i.test(n.url || "") ? n.url! : null);

/* Le lien d'une notification : la source (n.url en http(s), nouvel onglet), ou,
   pour les nouveaux domaines candidats du scan des concurrents (M3-122), la
   liste des candidats dans le back-office. */
export function lienNotification(n: Notification): { href: string; libelle: string; externe: boolean } | null {
  if (n.type === "competitors_candidates") return { href: "/admin/concurrents", libelle: "voir les candidats", externe: false };
  const url = lienSource(n);
  return url ? { href: url, libelle: "voir la source", externe: true } : null;
}
