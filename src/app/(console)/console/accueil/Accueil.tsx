"use client";

// L'accueil, cumulatif par rôle (M3-108, axe C7) : une première vue « affiche »
// — ma file, ce qui cloche, et selon le palier ce qui a tourné cette nuit, les
// coûts et les alertes — et le détail derrière un clic. La page serveur a déjà
// décidé des sections et n'a envoyé que leurs résumés ; la file elle-même vient
// de l'index de la console, déjà chargé pour tous.

import { useState } from "react";
import { Carte, Tuile, Vide } from "@/composants/primitives";
import { FLAG_LABELS } from "@shared/model.js";
import { nf } from "@shared/scoring.js";
import { CONFORMITY_CRITERIA, queueSummary } from "@/relireArticles/relireArticles.regles";
import type { CoutRoutines } from "@/consulterCoutRoutines/consulterCoutRoutines.regles";
import { useConsole } from "../store";
import { ResumeCoutRoutines } from "./CoutRoutines";
import { CetteNuit, type Nuit } from "./CetteNuit";
import { Alertes, type Alerte } from "./Alertes";

const plural = (n: number, s = "s") => (n > 1 ? s : "");
const DRAPEAUX = FLAG_LABELS as Record<string, string>;

export type Sections = { file: boolean; cloche: boolean; nuit: boolean; couts: boolean; alertes: boolean };

export function Accueil({ sections, rythme, nuit, couts, alertes }: {
  sections: Sections;
  rythme: { medianMinutes: number | null; sample: number } | null;
  /* null : section hors palier ; "indisponible" : la lecture a échoué. */
  nuit: Nuit | "indisponible" | null;
  couts: CoutRoutines | null;
  alertes: Alerte[] | "indisponible" | null;
}) {
  const c = useConsole();
  /* L'heure d'arrivée sur la page : l'estimation de fin se calcule dessus. */
  const [maintenant] = useState(() => Date.now());
  const q = queueSummary(c.index);
  const go = (o: { zone?: string; kind?: string; focus?: string }) => () => { void c.gotoFile(o); };

  const criteres = CONFORMITY_CRITERIA.map(([k, lab]) => ({ lab, n: q.missing[k] || 0 })).sort((a, b) => b.n - a.n);
  const pire = criteres[0];
  const nonPubliables = q.pending - q.ready;
  const m = rythme?.medianMinutes ?? null;
  const fin = m != null && q.pending ? new Date(maintenant + q.pending * m * 60000) : null;

  return (
    <div className="grid gap-4">
      {/* Palier relecteur — ma file. */}
      <Carte titre="Ma file" actions={<span className="text-xs text-ink-2">{q.pending} article{plural(q.pending)} à traiter</span>}>
        {q.pending ? (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            <Tuile libelle={`prêt${plural(q.ready)} à publier`} valeur={q.ready} ton={q.ready ? "go" : "neutre"} onClick={q.ready ? go({ focus: "ready" }) : undefined} />
            <Tuile libelle="zone habilitée" valeur={q.hab} onClick={q.hab ? go({ zone: "hab" }) : undefined} />
            <Tuile libelle="zone non habilitée" valeur={q.nonhab} ton={q.nonhab ? "amber" : "neutre"} onClick={q.nonhab ? go({ zone: "nonhab" }) : undefined} />
          </div>
        ) : <Vide compact titre="La file est vide" message="Aucun article n'attend de relecture." />}
        {q.pending > 0 && (
          <details className="mt-3">
            <summary className="text-sm text-ink-2 cursor-pointer">Temps de relecture</summary>
            <p className="text-sm mt-2">
              Charge de lecture : <b>{nf(q.readingMinutes)} min</b> pour {q.pending} article{plural(q.pending)} (signes ÷ vitesse de lecture réglée ; ni vérifications ni corrections).
              {" "}{m == null ? "Rythme réel : pas encore mesurable (aucune décision sur 30 jours)." : <>Rythme réel : {nf(m)} min par article (médiane de {rythme?.sample} écart{plural(rythme?.sample || 0)}){fin ? <>, file traitée vers <b>{fin.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</b> sans interruption</> : null}.</>}
            </p>
          </details>
        )}
      </Carte>

      {/* Palier relecteur — ce qui cloche. */}
      <Carte titre="Ce qui cloche">
        {!q.pending ? <Vide compact titre="Rien à signaler" message="La file est vide : aucun article à vérifier." />
          : !q.signale && !q.horsSujet && !nonPubliables ? <Vide compact titre="Rien à signaler" message="Tous les articles de la file passent les cinq critères." /> : (
          <>
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
              <Tuile libelle={`signalé${plural(q.signale)}`} valeur={q.signale} ton={q.signale ? "stop" : "neutre"} onClick={q.signale ? go({ focus: "signale" }) : undefined} />
              <Tuile libelle="non publiables en l'état" valeur={nonPubliables} ton={nonPubliables ? "amber" : "neutre"} />
              <Tuile libelle={(DRAPEAUX.hors_sujet || "hors sujet").toLowerCase()} valeur={q.horsSujet} onClick={q.horsSujet ? go({ focus: "hors_sujet" }) : undefined} />
            </div>
            {q.scored > 0 && (
              <details className="mt-3">
                <summary className="text-sm text-ink-2 cursor-pointer">
                  Critères non satisfaits{pire?.n ? ` — le plus fréquent : « ${pire.lab} » (${pire.n})` : ""}
                </summary>
                <ul className="grid gap-2 mt-2">
                  {criteres.map((r) => (
                    <li key={r.lab} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] gap-3 items-center text-sm">
                      <span>{r.lab}</span>
                      <progress className="w-full" max={q.scored} value={r.n} aria-label={`${r.lab} : ${r.n} sur ${q.scored}`} />
                      <b className="tabular-nums">{r.n}</b>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-2 mt-2">Sur les {q.scored} article{plural(q.scored)} notés de la file{q.pending - q.scored > 0 ? ` ; ${q.pending - q.scored} sans score n'y entrent pas` : ""}.</p>
              </details>
            )}
          </>
        )}
      </Carte>

      {/* Palier super utilisateur — cette nuit. */}
      {sections.nuit && nuit && <CetteNuit nuit={nuit} />}

      {/* Palier administrateur — coûts (FEAT coutRoutines) et alertes. */}
      {sections.couts && couts && (
        <Carte titre="Le coût des routines" actions={<span className="text-xs text-ink-2">LLM, en dollars</span>}>
          <ResumeCoutRoutines c={couts} />
        </Carte>
      )}
      {sections.alertes && alertes && <Alertes alertes={alertes} />}
    </div>
  );
}
