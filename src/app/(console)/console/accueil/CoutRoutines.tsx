// Coût des routines (M3-105) — le résumé de l'Accueil, palier administrateur
// (M3-108). Le détail est au back-office (Exécutions). `null` : FEAT fermée au
// rôle, le serveur n'a rien envoyé, la section n'existe pas.

import { Tuile, Vide } from "@/composants/primitives";
import type { CoutRoutines } from "@/consulterCoutRoutines/consulterCoutRoutines.regles";
import { coutAffiche, coutMoyenArticle, coutParArticle, fmtUsd, fmtTokens, LIBELLE_ORIGINE, typeRoutine } from "@/consulterCoutRoutines/coutRoutines.calcul.js";

const ORIGINE = LIBELLE_ORIGINE as Record<string, string>;
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function ResumeCoutRoutines({ c }: { c: CoutRoutines }) {
  const { jour, mois } = c.totaux;
  const der = c.routines[0];
  const total = (t: typeof jour) => (t.cout > 0 || !t.tokens ? fmtUsd(t.cout) : `— (${fmtTokens(t.tokens)})`);
  return (
    <>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
        <Tuile libelle={`aujourd'hui · ${jour.routines} routine${jour.routines > 1 ? "s" : ""}`} valeur={total(jour)} />
        <Tuile libelle={`ce mois · ${mois.articles} article${mois.articles > 1 ? "s" : ""}`} valeur={total(mois)} />
        <Tuile libelle="par article, ce mois" valeur={fmtUsd(coutMoyenArticle(mois))} href="/admin/executions" />
      </div>
      {der ? (
        <details className="mt-3">
          <summary className="text-sm text-ink-2 cursor-pointer">Dernière routine : {ORIGINE[der.origine] || der.origine}, {quand(der.at)}</summary>
          <p className="text-sm mt-2">
            {typeRoutine(der)}
            {der.generation ? `, génération ${coutAffiche(der.generation)}, ${der.generation.crees} article${der.generation.crees > 1 ? "s" : ""}` : ""}
            {coutParArticle(der) != null ? ` (${fmtUsd(coutParArticle(der))} l'article)` : ""}
            {der.statut === "echec" ? " — en échec" : der.statut === "partielle" ? ` — ${der.erreur || "partielle"}` : ""}.
            {c.registre ? <> Dépense LLM totale du mois, régénérations et relectures comprises : {c.registre.mois.cout != null ? fmtUsd(c.registre.mois.cout) : `— (${fmtTokens(c.registre.mois.tokens)})`}.</> : null}
          </p>
        </details>
      ) : <Vide compact titre="Aucune routine enregistrée" message="Le relevé commence à la prochaine récolte ou génération." />}
    </>
  );
}
