"use client";

// La file du jour : zones, volets, pastilles de département, filtre source,
// cartes. Héritée de l'ancien front HTML (supprimé).

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icone } from "@/composants/Icone";
import { ecrirePrefs, lirePrefs, usePrefs } from "@/composants/prefs";
import { catInfo, zoneLabel } from "@shared/model.js";
import { nf } from "@shared/scoring.js";
import {
  choixJours, CONFORMITY_CRITERIA, dateCourte, datesArticle, departmentsInZone, filteredIndex, groupesParJour, jourDeGeneration, jourOuvert, FOCUS_LABELS, libellePastille, pendingInDept, pendingInKind, pendingInZone,
  filtreSources, VERDICTS_RELECTURE, type Ligne,
} from "@/relireArticles/relireArticles.regles";
import { useConsole } from "./store";

function Pips({ row }: { row: Ligne }) {
  const d = (row.scores && row.scores.conformity && row.scores.conformity.detail) || {};
  return (
    <div className="cr-pips">
      {CONFORMITY_CRITERIA.map(([k, label]) => {
        const ok = !!d[k];
        const txt = `${label} — ${ok ? "conforme" : "à corriger"}`;
        return <i key={k} className={`cr-pip ${ok ? "ok" : "no"}`} role="img" title={txt} aria-label={txt}></i>;
      })}
    </div>
  );
}

/* Les dates de la carte (M3-90) : génération toujours, récupération et parution
   de la source quand l'index les porte. L'article ouvert les montre toutes. */
function DatesCarte({ row }: { row: Ligne }) {
  const d = datesArticle(row);
  const parts: [string, string | null][] = [["Généré", d.generation], ["Récupéré", d.recuperation], ["Source", d.publicationSource]];
  const vues = parts.filter(([, v]) => v);
  if (!vues.length) return null;
  return (
    <div className="cr-card-meta cr-card-meta--dates">
      {vues.map(([lab, v]) => <span key={lab} title={`${lab} le ${dateCourte(v)}`}>{lab} <b className="w5">{dateCourte(v)}</b></span>)}
    </div>
  );
}

/** La file : en colonne (page de relecture) ou dans le TiroirFile, qui porte
    alors le titre « File du jour » — l'en-tête ne garde que le compte. */
export function Rail({ enTiroir = false }: { enTiroir?: boolean }) {
  const c = useConsole();
  const { index, portee } = c;
  const list = filteredIndex(index, portee);
  const deps = departmentsInZone(index, portee, portee.zone);
  const srcs = filtreSources(index, portee, c.referentiel);
  const cat = catInfo as (n: string) => { token: string };
  const railJours = usePrefs().railJours;
  const groupes = groupesParJour(list);
  const entetes = useRef<(HTMLButtonElement | null)[]>([]);
  const basculer = (jour: string, ouvert: boolean) => { ecrirePrefs({ railJours: choixJours(lirePrefs().railJours, jour, ouvert) }); };

  /* L'article ouvert (raccourcis j/k, accueil) doit rester visible : son jour
     se déplie s'il est replié. Une fois par sélection seulement, pour que
     l'utilisateur puisse le replier ensuite. */
  const selJour = (() => { const a = c.selId ? list.find((r) => r.id === c.selId) : null; return a ? jourDeGeneration(a) : null; })();
  useEffect(() => {
    if (selJour && !jourOuvert(selJour, groupesParJour(filteredIndex(index, portee)), lirePrefs().railJours)) basculer(selJour, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement quand la sélection change
  }, [c.selId, selJour]);

  /* En-têtes de jour au clavier (motif accordéon WAI-ARIA) : flèches haut et
     bas, Début et Fin passent d'un jour à l'autre ; Entrée et Espace replient. */
  const naviguer = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = groupes.length;
    const cible = ({ ArrowDown: (i + 1) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    entetes.current[cible]?.focus();
  };

  return (
    <aside className="cr-col-file" aria-label={enTiroir ? undefined : "File du jour"}>
      <div className="cr-rail-head">
        {enTiroir ? <span className="cr-rail-title">{list.length} article{list.length > 1 ? "s" : ""} dans la portée</span>
          : <><span className="cr-rail-title">File du jour</span><span className="cr-rail-title cr-rail-n">{list.length}</span></>}
      </div>
      <div className="cr-zone-tabs">
        <button className={`cr-ztab hab${portee.zone === "hab" ? " on" : ""}`} type="button" onClick={() => c.setPortee({ zone: "hab", dept: null, sourceFilter: "" })}><Icone nom="Shield" size={14} />Zone habilitée <span className="n">{pendingInZone(index, portee, "hab")}</span></button>
        <button className={`cr-ztab nonhab${portee.zone === "nonhab" ? " on" : ""}`} type="button" onClick={() => c.setPortee({ zone: "nonhab", dept: null, sourceFilter: "" })}>Zone non habilitée <span className="n">{pendingInZone(index, portee, "nonhab")}</span></button>
      </div>
      <div className="cr-kind-tabs">
        {([["", "Tout"], ["public", "Public"], ["private", "Privé"]] as const).map(([k, lab]) => (
          <button key={k} className={`cr-kind${portee.kind === k ? " on" : ""}`} type="button" onClick={() => c.setPortee({ kind: k, sourceFilter: "" })}>{lab} <span className="n">{pendingInKind(index, portee, k)}</span></button>
        ))}
      </div>
      {deps.length > 0 && (
        <div className={`cr-zones${portee.zone === "nonhab" ? " nonhab" : ""}`}>
          {deps.map((z) => (
            <button key={z.num} className={`cr-zone-pill${portee.dept === z.num ? " on" : ""}`} type="button" onClick={() => c.setPortee({ dept: portee.dept === z.num ? null : z.num, sourceFilter: "" })}>{libellePastille(z)} <span className="n">{pendingInDept(index, portee, z.num)}</span></button>
          ))}
        </div>
      )}
      {(srcs.nbSources > 1 || !!portee.sourceFilter) && (
        <div className="cr-src-filter">
          {/* M3-59 : toutes les sources de la portée, même sans article, et
              celles d'une même organisation groupées. */}
          <select className="cr-sel" aria-label="Filtrer par source" value={portee.sourceFilter} onChange={(e) => c.setPortee({ sourceFilter: e.target.value }, true)}>
            <option value="">Toutes les sources ({srcs.total})</option>
            {srcs.groupes.map((g) => g.cle ? (
              <optgroup key={g.cle} label={`${g.label} — ${g.sources.length} sources`}>
                <option value={g.cle}>Toute l&apos;organisation ({g.count})</option>
                {g.sources.map((s) => <option key={s.cle} value={s.cle}>{s.label} ({s.count})</option>)}
              </optgroup>
            ) : g.sources.map((s) => <option key={s.cle} value={s.cle}>{s.label} ({s.count})</option>))}
          </select>
        </div>
      )}
      {portee.focus && (
        <div className="cr-focus"><Icone nom="Gauge" size={13} />
          <span>Depuis l&apos;accueil · {FOCUS_LABELS[portee.focus] || portee.focus}</span>
          <button type="button" onClick={() => c.setPortee({ focus: "" }, true)} title="Afficher toute la file" aria-label="Afficher toute la file"><Icone nom="X" size={13} /></button>
        </div>
      )}
      <div className="cr-rail">
        {!list.length && <div className="cr-rail-empty">{portee.focus ? "Aucun article ne répond à ce filtre dans cette zone." : "Aucun brouillon dans cette zone ce matin."}</div>}
        {groupes.map((g, i) => {
          const ouvert = jourOuvert(g.jour, groupes, railJours);
          const idListe = `cr-jour-${g.jour}`;
          const nb = g.articles.length;
          return (
            <section key={g.jour} className="cr-jour" aria-label={`Générés le ${g.libelle}`}>
              <button type="button" className="cr-jour-btn" aria-expanded={ouvert} aria-controls={idListe}
                      ref={(el) => { entetes.current[i] = el; }} onKeyDown={(e) => naviguer(e, i)} onClick={() => basculer(g.jour, !ouvert)}>
                <span className="cr-jour-ic" aria-hidden="true">{ouvert ? "▾" : "▸"}</span>
                <span className="cr-jour-date">{g.libelle}</span>
                <span className="n">{nb} article{nb > 1 ? "s" : ""}</span>
              </button>
              <div id={idListe} className="cr-jour-liste" hidden={!ouvert}>
                {g.articles.map((a) => {
                  const ci = cat(a.cat);
                  const on = a.id === c.selId;
                  const done = a.status !== "a_revoir" && a.status !== "signale";
                  return (
                    <button key={a.id} className={`cr-card cat-${ci.token}${on ? " on" : ""}${done ? " done" : ""}${a.status === "signale" ? " sig" : ""}`} type="button" onClick={() => c.selectArticle(a.id)}>
                      <span className="cr-card-spine"></span>
                      {a.status === "publie" && <span className="cr-badge pub"><Icone nom="Check" size={11} sw={3} />En parution</span>}
                      {a.status === "archive" && <span className="cr-badge cls"><Icone nom="Archive" size={11} />Classé</span>}
                      {a.status === "valide" && <span className="cr-badge val"><Icone nom="Check" size={11} sw={3} />Validé</span>}
                      {a.status === "signale" && <span className="cr-badge sig"><Icone nom="XCircle" size={11} />Signalé</span>}
                      <div className="cr-card-top"><span className="cr-cat">{a.cat}</span></div>
                      <div className="cr-card-h">{a.title}</div>
                      <div className="cr-card-zone"><Icone nom="MapPin" size={12} />{zoneLabel(a.zone)} <span className="reg">· {a.zone?.region || ""}</span></div>
                      <div className="cr-card-meta">
                        <span><Icone nom="Gauge" size={13} /><b>{a.ranking}</b></span>
                        <span><Icone nom="AlignLeft" size={13} /><b>{nf(a.signs)}</b> signes</span>
                        <span><Icone nom="Clock" size={13} /><b>{a.reading}</b> min</span>
                      </div>
                      <DatesCarte row={a} />
                      {(a.reviewVerdict === "a_corriger" || a.reviewVerdict === "rejet") && (
                        <div className={`cr-relu cr-relu-${VERDICTS_RELECTURE[a.reviewVerdict].ton}`}>
                          <span className="cr-relu-dot" aria-hidden="true"></span>relu : {VERDICTS_RELECTURE[a.reviewVerdict].label.toLowerCase()}
                        </div>
                      )}
                      <Pips row={a} />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
