"use client";

// La barre de décision (M3-107, axe C2), collée en bas de l'article et toujours
// visible : la conformité compacte (les cinq critères de analyze() en pastilles
// + « n/5 »), le ranking, la rubrique, et la décision. Les actions et leurs
// règles sont celles de l'ancienne barre de Scene, sans changement : renvoyer à
// l'IA, classer sans diffusion, envoyer en parution (grisé tant que les cinq
// critères ne sont pas remplis, ou selon le rôle), remettre dans la file.
// Une ligne quand la place suffit, deux au plus : l'état, puis les actions.
// Une pastille en échec ouvre le détail sur ses preuves (« pourquoi »).

import { useId, useState } from "react";
import { Bouton, ConfirmationSurPlace, Etiquette } from "@/composants/primitives";
import { Icone } from "@/composants/Icone";
import { cx } from "@/composants/cx";
import { can, MOCK_PUBLISH_REFUSAL, readyTitle, STATUSES, writtenByMock } from "@shared/model.js";
import { analyze, scoringSettings } from "@shared/scoring.js";
import { illustrationBlocked, ILLUSTRATION_REFUSAL } from "@shared/feats.js";
import { criteresManquants, refusConformite, type Article } from "@/relireArticles/relireArticles.regles";
import { useConsole } from "./store";
import { pastillesConformite, type CibleDetail } from "./disposition.logique";

const STATUTS = STATUSES as Record<string, { label: string }>;

export type BarreDecisionProps = {
  sel: Article;
  /** Ouvre le panneau détaillé (tiroir) ou s'y place (colonne). */
  onDetail: (cible?: CibleDetail) => void;
  /** Le panneau est déjà affiché en colonne : pas de bouton « Détail ». */
  detailEnColonne: boolean;
  detailOuvert: boolean;
};

export function BarreDecision({ sel, onDetail, detailEnColonne, detailOuvert }: BarreDecisionProps) {
  const c = useConsole();
  const id = useId();
  const [sched, setSched] = useState("");
  const A = analyze(sel);
  const st = scoringSettings() as Record<string, number>;
  const feats = c.moi.feats;
  const role = c.moi.role;
  const pending = sel.status === "a_revoir" || sel.status === "signale";
  const mock = writtenByMock(sel);
  const noImg = !mock && illustrationBlocked(sel, feats);
  /* M3-72 : grisé tant que les cinq critères ne sont pas remplis — le serveur
     refuse de toute façon (relireArticles.action.ts). */
  const manquants = criteresManquants(sel, st, { sansIllustration: !!feats.sansIllustration });
  const pubOff = mock || noImg || manquants.length > 0 || !can(role, "publish");
  const pubd = sel.status === "publie";
  /* La raison du grisé, exposée aussi à un lecteur d'écran (aria-describedby). */
  const raisonPub = mock ? (MOCK_PUBLISH_REFUSAL as string) : noImg ? (ILLUSTRATION_REFUSAL as string) : refusConformite(manquants) ?? undefined;
  const pastilles = pastillesConformite(A);
  const etat = pending ? readyTitle(sel, A)
    : sel.status === "valide" ? "Validé — en attente de parution" : pubd ? "Envoyé en parution" : sel.status === "archive" ? "Classé sans diffusion" : STATUTS[sel.status]?.label || sel.status;

  return (
    <div className="cr-barre" role="region" aria-label="Décision sur l'article">
      <div className="cr-barre-in">
        <div className="cr-barre-etat">
          <div className="cr-barre-pips" role="group" aria-label={`Conformité : ${A.passed} critère${A.passed > 1 ? "s" : ""} sur ${A.total}`}>
            {pastilles.map((p) => p.ok
              ? <span key={p.cle} className="cr-barre-pip ok" role="img" aria-label={`${p.libelle} : conforme`} title={`${p.libelle} — conforme`}><i aria-hidden="true"></i></span>
              : <button key={p.cle} type="button" className="cr-barre-pip no" aria-label={`${p.libelle} : à corriger — voir pourquoi`} title={`${p.libelle} — à corriger : voir pourquoi`}
                        aria-haspopup={detailEnColonne ? undefined : "dialog"} onClick={() => onDetail({ section: "preuves", critere: p.cle })}><i aria-hidden="true"></i></button>)}
            <span className={cx("cr-barre-n", A.passed === A.total ? "ok" : "no")} aria-hidden="true">{A.passed}/{A.total}</span>
          </div>
          <span className="cr-barre-score" title="Ranking éditorial"><Icone nom="Gauge" size={13} /><span className="cr-sr">Ranking </span><b>{sel.ranking}</b>/100</span>
          <Etiquette rubrique={sel.cat} title="Rubrique" />
          <span className="cr-barre-t" title={etat}>{etat}</span>
          {!detailEnColonne && (
            <Bouton taille="petite" variante="secondaire" icone="Sliders" className="cr-barre-detail" aria-haspopup="dialog" aria-expanded={detailOuvert}
                    onClick={() => onDetail()}>Détail</Bouton>
          )}
        </div>
        <div className="cr-barre-actions">
          {pending ? (
            <>
              <label className="cr-schedule"><Icone nom="Clock" size={13} /><span className="cr-barre-long">Parution planifiée</span>
                <input type="datetime-local" id="sched" aria-label="Parution planifiée" value={sched} onChange={(e) => setSched(e.target.value)} /></label>
              <Bouton variante={mock ? "primaire" : "secondaire"} icone="RotateCcw" aria-label="Renvoyer à l'IA" onClick={() => c.ouvrirModale({ kind: "reai" })}>
                Renvoyer<span className="cr-barre-long"> à l&apos;IA</span></Bouton>
              {/* B4 : classer et envoyer se confirment sur place, conséquence écrite. Les enveloppes
                  (conf-arch, conf-pub) sont les cibles du clavier (CoqueConsole). */}
              <span id="conf-arch" className="cr-barre-conf">
                <ConfirmationSurPlace varianteDeclencheur="secondaire" icone="Archive" libelle={<>Classer<span className="cr-barre-long"> SANS diffusion</span></>}
                  libelleConfirmer="Classer sans diffusion"
                  consequence="L'article est classé sans diffusion : il quitte la file à traiter et n'est pas publié. Il reste consultable dans l'Historique, où vous pourrez le remettre dans la file."
                  onConfirm={() => c.decide("archive", "classé sans diffusion", "Archive")} />
              </span>
              <span id="conf-pub" className="cr-barre-conf" title={pubOff ? raisonPub : undefined}>
                <ConfirmationSurPlace varianteDeclencheur={mock ? "secondaire" : "primaire"} icone="Send" desactive={pubOff} className={mock ? undefined : "cr-barre-pub"}
                  libelle={<>Envoyer<span className="cr-barre-long"> en parution</span></>} libelleConfirmer="Envoyer en parution"
                  consequence={sched
                    ? `L'article est programmé pour le ${new Date(sched).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })} : il quitte la file à traiter et paraîtra à cette date.`
                    : "L'article est envoyé en parution (simulé) : il quitte la file à traiter et devient « Envoyé en parution ». Vous pourrez le remettre dans la file depuis l'article."}
                  onConfirm={() => c.publishArticle(sched ? new Date(sched).toISOString() : null)} />
              </span>
              {pubOff && raisonPub && <span id={`${id}-pub`} className="cr-sr">{raisonPub}</span>}
            </>
          ) : (
            <>
              {sel.publication?.url && <a className="cr-lien-ext" href={sel.publication.url} target="_blank" rel="noopener noreferrer"><Icone nom="Globe" size={13} />Voir la parution<span className="cr-sr"> (nouvel onglet)</span></a>}
              <Bouton variante="secondaire" icone="RotateCcw" onClick={() => c.decide("a_revoir", "remis dans la file", "RotateCcw")}>Remettre dans la file</Bouton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
