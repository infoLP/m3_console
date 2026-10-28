// Règles pures de l'onglet Suivi : la géométrie du graphe à barres (SVG écrit
// à la main, sans dépendance) et les tuiles. Porté de legacy/scripts/charts.js.

export interface Stats {
  range: string;
  toProduce: number;
  doneToday: number;
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  series: { date: string; created: number; accepted: number; archived: number; published: number }[];
  byUser: { reviewer: string; accepted: number; archived: number }[];
  untrackedDecisions: number;
  pace: { medianMinutes: number | null; sample: number };
}

export const SERIES_CLES = ["created", "accepted", "archived"] as const;
export const SERIES_COULEURS = ["#3A63B4", "#1B7A50", "#B54334"];
export const SERIES_LEGENDE = ["générés", "acceptés (validés + publiés)", "archivés"];
export const PERIODES = ["jour", "semaine", "mois"];

export interface Barre { x: number; y: number; w: number; h: number; fill: string; title: string }
export interface Etiquette { x: number; y: number; texte: string }
export interface Ligne { y: number; valeur: number }

export function geometrieBarres(series: Stats["series"], { w = 640, h = 200, pad = 28 } = {}) {
  if (!series.length) return null;
  const keys = SERIES_CLES as readonly string[];
  const max = Math.max(1, ...series.map((d) => Math.max(...keys.map((k) => (d as unknown as Record<string, number>)[k] || 0))));
  const bw = (w - pad * 2) / series.length;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const barres: Barre[] = [];
  const etiquettes: Etiquette[] = [];
  const pas = Math.ceil(series.length / 7 || 1);
  series.forEach((d, i) => {
    const x0 = pad + i * bw;
    keys.forEach((k, ki) => {
      const v = (d as unknown as Record<string, number>)[k] || 0;
      const gw = (bw - 8) / keys.length;
      barres.push({ x: x0 + 4 + ki * gw, y: y(v), w: Math.max(0, gw - 2), h: h - pad - y(v), fill: SERIES_COULEURS[ki], title: `${d.date} · ${k} : ${v}` });
    });
    if (i % pas === 0) etiquettes.push({ x: x0 + bw / 2, y: h - 8, texte: String(d.date).slice(5) });
  });
  const grille: Ligne[] = [0, 0.5, 1].map((g) => ({ y: y(max * g), valeur: Math.round(max * g) }));
  return { w, h, pad, max, barres, etiquettes, grille };
}

export function tuiles(s: Stats) {
  return [
    { n: s.toProduce, l: "articles à traiter" },
    { n: s.doneToday, l: "traités aujourd'hui" },
    { n: s.total, l: "articles au total" },
    { n: s.byStatus.publie || 0, l: "publiés (simulé)" },
    { n: s.byStatus.archive || 0, l: "archivés" },
  ];
}

export function rubriques(s: Stats) {
  const rows = Object.entries(s.byCategory || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return rows.map(([k, v]) => ({ k, v, pct: (v / max) * 100 }));
}
