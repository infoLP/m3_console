/* Coût des routines (M3-105) — règles pures, lues par le serveur (totaux) et par
   les deux écrans (libellés, coût par article). En JavaScript : le gestionnaire
   serveur (coutRoutines.api.js) les importe, et les tests de câblage tournent
   sans TypeScript.

   Unité : dollars, tels que les rend OpenRouter (champ `cost`), sans conversion
   (choix de l'utilisateur, 2026-10-15). Coût inconnu (moteur qui n'en renvoie
   aucun) : « — », et les tokens à la place. */

import { FEATS, featOpen } from "../../shared/feats.js";

export const ROUTINES_AFFICHEES = 20;

/* La FEAT « Coût des routines » est-elle ouverte à ce rôle ? Non déclarée = fermée. */
export function coutRoutinesOuvert(role, settings) {
  const f = FEATS.coutRoutines;
  return !!f && featOpen(role, settings?.[f.setting] ?? f.default);
}

/* Retire tout montant en dollars d'une réponse destinée à un rôle sous le seuil
   de la FEAT (M3-105, panneau « Dernière récupération » : ops.lastRun). Les
   tokens et les compteurs restent. Trois formes de montant y circulent :
   - `cost` des relevés d'usage (runs, demandes du back-office) ;
   - les plafonds en dollars (`unit: "usd"`, champs `used` et `cap`) ;
   - le texte : le détail d'un plafond atteint ou le message d'erreur qui le
     reprend (« 0,52 $ dépensés pour 0,50 $ autorisés »). */
const MONTANT = /\d[\d\s .,]*\s?\$/g;
export function masquerCouts(v) {
  if (typeof v === "string") return v.replace(MONTANT, "[montant masqué]");
  if (Array.isArray(v)) return v.map(masquerCouts);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "cost") continue;
    if (v.unit === "usd" && (k === "used" || k === "cap")) continue;
    out[k] = masquerCouts(x);
  }
  return out;
}

export const LIBELLE_ORIGINE = {
  planifiee: "Planifiée",
  manuelle: "Manuelle (back-office)",
  daily: "npm run daily",
  poste: "Manuelle (poste)",
};

/* Ce que la routine a fait : la récolte seule s'affiche comme telle (Q3). */
export function typeRoutine(r) {
  if (r?.recolte && r?.generation) return "récolte + génération";
  if (r?.recolte) return "récolte seule";
  if (r?.generation) return "génération seule";
  return "rien d'exécuté";
}

/* null si le coût est inconnu ou s'il n'y a aucun article : rien à diviser. */
export function coutParArticle(r) {
  const g = r?.generation;
  return g && g.cout != null && g.crees > 0 ? g.cout / g.crees : null;
}

export function fmtUsd(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  /* Des centimes et en dessous : quatre décimales, sinon un article à 0,0031 $
     s'afficherait 0,00 $. */
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })} $`;
}
export function fmtTokens(n) {
  return `${(Number(n) || 0).toLocaleString("fr-FR")} tokens`;
}

/* Coût d'une étape pour l'affichage : dollars, sinon tokens, sinon « — ». */
export function coutAffiche(etape) {
  if (!etape) return "—";
  if (etape.cout != null) return fmtUsd(etape.cout);
  return etape.tokens ? `— (${fmtTokens(etape.tokens)})` : "—";
}

/* Coût moyen d'un article sur une période : null si aucun article à coût connu. */
export const coutMoyenArticle = (t) => (t?.articlesCoutConnu > 0 ? t.cout / t.articlesCoutConnu : null);

/* Totaux du jour et du mois, à l'heure de Paris, sur les routines connues.
   `periode(iso)` rend { day, month } (periodKeys de src/llm/budget.js côté
   serveur). Coût inconnu : il ne compte pas dans les dollars mais ses tokens
   comptent, et `inconnus` le dit. */
export function totaux(routines, now, periode) {
  const { day, month } = periode(now);
  /* `articlesCoutConnu` : les articles des routines dont le coût est connu. Le
     coût par article se divise par eux seuls — diviser par tous les articles
     ferait passer ceux d'un moteur sans coût pour gratuits. */
  const vide = () => ({ cout: 0, tokens: 0, articles: 0, articlesCoutConnu: 0, routines: 0, inconnus: 0 });
  const t = { jour: vide(), mois: vide() };
  for (const r of routines || []) {
    const p = periode(Date.parse(r.at));
    const cibles = [];
    if (p.month === month) cibles.push(t.mois);
    if (p.day === day) cibles.push(t.jour);
    for (const c of cibles) {
      c.routines++;
      const g = r.generation;
      if (!g) continue;
      c.articles += g.crees || 0;
      c.tokens += g.tokens || 0;
      if (g.cout != null) { c.cout += g.cout; c.articlesCoutConnu += g.crees || 0; }
      else if (g.appels > 0) c.inconnus++;
    }
  }
  return t;
}
