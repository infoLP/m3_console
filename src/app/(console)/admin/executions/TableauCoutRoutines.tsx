// Coût des routines (M3-105) — le détail, au back-office. Le résumé est à
// l'Accueil de la console. Rendu seulement si le serveur a envoyé des données :
// FEAT fermée au rôle → `null`, et la page ne monte pas ce composant.

import type { CoutRoutines, Totaux } from "@/consulterCoutRoutines/consulterCoutRoutines.regles";
import { coutAffiche, coutMoyenArticle, coutParArticle, fmtTokens, fmtUsd, LIBELLE_ORIGINE, typeRoutine } from "@/consulterCoutRoutines/coutRoutines.calcul.js";

const ORIGINE = LIBELLE_ORIGINE as Record<string, string>;
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Total({ titre, t, registre }: { titre: string; t: Totaux; registre: { cout: number | null; tokens: number } | null }) {
  const somme = t.cout > 0 || !t.tokens ? fmtUsd(t.cout) : `— (${fmtTokens(t.tokens)})`;
  return (
    <p className="bo-note"><b>{titre} : {somme}</b> · {t.routines} routine{t.routines > 1 ? "s" : ""} · {t.articles} article{t.articles > 1 ? "s" : ""}{coutMoyenArticle(t) != null ? ` · ${fmtUsd(coutMoyenArticle(t))} l'article` : ""}
      {t.inconnus > 0 && <> · dont {t.inconnus} sans coût renvoyé (tokens seulement)</>}
      {registre && <><br />Dépense LLM totale : {registre.cout != null ? fmtUsd(registre.cout) : `— (${fmtTokens(registre.tokens)})`}, régénérations et relectures hors routine comprises</>}</p>
  );
}

export function TableauCoutRoutines({ c }: { c: CoutRoutines }) {
  return (
    <div className="bo-card">
      <h3>Coût des routines</h3>
      <p className="bo-note">Coût LLM de chaque exécution de la chaîne, planifiée ou manuelle, en dollars tels que les rend OpenRouter. La récolte n&apos;appelle aucun modèle : son coût est « — ». Un moteur qui ne renvoie pas de coût affiche ses tokens.</p>
      <div>
        <Total titre="Aujourd'hui" t={c.totaux.jour} registre={c.registre?.jour ?? null} />
        <Total titre="Ce mois" t={c.totaux.mois} registre={c.registre?.mois ?? null} />
      </div>
      {c.routines.length ? (
        <div className="bo-scroll"><table className="bo-table">
          <thead><tr><th>Date</th><th>Origine</th><th>Étapes</th><th>Récolte</th><th>Génération</th><th>Articles</th><th>Par article</th></tr></thead>
          <tbody>{c.routines.map((r) => (
            <tr key={r.id} title={r.erreur || r.owner || undefined}>
              <td>{quand(r.at)}</td>
              <td>{ORIGINE[r.origine] || r.origine}</td>
              <td>{typeRoutine(r)}{r.statut === "echec" ? " · échec" : r.statut === "partielle" ? ` · ${r.erreur || "partielle"}` : ""}{r.generation?.plafond ? " · plafond atteint" : ""}</td>
              <td>{r.recolte ? `— · ${r.recolte.items} item${r.recolte.items > 1 ? "s" : ""}` : ""}</td>
              <td>{r.generation ? coutAffiche(r.generation) : ""}</td>
              <td>{r.generation ? r.generation.crees : ""}</td>
              <td>{fmtUsd(coutParArticle(r))}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="bo-note">Aucune routine enregistrée pour l&apos;instant : le relevé commence à la prochaine récolte ou génération.</p>}
      <p className="bo-note">{c.routines.length} dernière{c.routines.length > 1 ? "s" : ""} routine{c.routines.length > 1 ? "s" : ""} affichée{c.routines.length > 1 ? "s" : ""} ; totaux calculés sur les {c.conservees} conservée{c.conservees > 1 ? "s" : ""}.</p>
    </div>
  );
}
