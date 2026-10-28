// Trace des relances après hallucination (M3-55), pour la fiche d'un article :
// version d'origine puis chaque relance, avec moteur, verdict, nombre
// d'hallucinations, motif de saut, et la version retenue. Rien si l'article n'a
// pas de checks.regen. Non monté ici : le tiroir de détail l'embarquera.

import { Carte, Etiquette } from "@/composants/primitives";
import { traceRelances, type ChecksRegen } from "@/relireArticles/relireArticles.regen";

const ISSUES: Record<string, string> = {
  ok: "Une relance a passé la relecture.",
  hallucination_persistante: "Hallucination persistante : la meilleure version est gardée, l'article est signalé.",
  aucune_relance: "Aucune relance possible : l'article est signalé.",
};

export function Relances({ article }: { article: { checks?: unknown } }) {
  const regen = (article.checks as { regen?: ChecksRegen | null } | null | undefined)?.regen;
  const lignes = traceRelances(regen);
  if (!regen || lignes.length === 0) return null;
  const issue = regen.issue ? ISSUES[regen.issue] : null;
  /* Sans titre : la section du détail qui l'enveloppe s'appelle déjà « Relances ». */
  return (
    <Carte variante="aplat">
      {issue && <p className="m-0 mb-3 text-xs text-ink-2">{issue}</p>}
      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Versions successives">
        {lignes.map((l) => (
          <li key={l.numero} className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <span className="font-bold">{l.numero}.</span>
            <span>{l.etape}</span>
            <span className="font-mono text-xs text-ink-2">{l.moteur}</span>
            {l.verdict && <Etiquette ton={l.ton}>{l.verdict}</Etiquette>}
            {l.hallucinations && <span className="text-xs text-ink-3">{l.hallucinations}</span>}
            {l.motif && <span className="text-xs text-amber">{l.motif}</span>}
            {l.retenue && <Etiquette ton="brand">Version retenue</Etiquette>}
          </li>
        ))}
      </ol>
    </Carte>
  );
}
