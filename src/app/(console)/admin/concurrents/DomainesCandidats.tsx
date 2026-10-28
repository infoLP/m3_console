"use client";

// Domaines candidats (M3-122) : les domaines que les concurrents citent et que
// le référentiel n'a pas, trouvés par le scan. Filtre par statut (nouveaux par
// défaut). L'administrateur crée la source (Sources, pré-remplie ; le candidat
// passe à « ajouté » à l'enregistrement), le superutilisateur la propose (une
// demande dans l'onglet Demandes) ; les deux écartent.

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { quandParis } from "@/gererSources/gererSources.regles";
import { STATUTS, actionsCandidat, consequenceEcart, hrefCreerSource, type Candidat, type StatutCandidat } from "@/gererConcurrents/gererConcurrents.regles";
import { ecarterCandidat, lireCandidats, proposerCandidat } from "@/gererConcurrents/gererConcurrents.action";

const ARTICLES_VISIBLES = 3;

export function DomainesCandidats({ initiaux, role }: { initiaux: Candidat[]; role: string }) {
  const flash = useFlash();
  const [statut, setStatut] = useState<StatutCandidat>("nouveau");
  const [liste, setListe] = useState<Candidat[]>(initiaux);
  const [enCours, lancer] = useTransition();

  const relire = async (s: StatutCandidat) => {
    const r = await lireCandidats(s);
    if (!r.ok) return flash(r.erreur, true);
    setListe(r.data.candidates);
  };
  const filtrer = (s: StatutCandidat) => lancer(async () => { setStatut(s); await relire(s); });

  const ecarter = (c: Candidat) => lancer(async () => {
    const r = await ecarterCandidat(c.id);
    if (!r.ok) return flash(r.erreur, true);
    flash(`« ${c.domain} » écarté`);
    await relire(statut);
  });
  const proposer = (c: Candidat) => lancer(async () => {
    const r = await proposerCandidat(c.id);
    if (!r.ok) return flash(r.erreur, true);
    flash(`« ${c.domain} » proposé à l'administrateur (onglet Demandes)`);
    await relire(statut);
  });

  return (
    <div className="bo-card"><h3>Domaines candidats <span className="bo-note">{liste.length} domaine(s)</span></h3>
      <p className="bo-hint">
        Les domaines que les concurrents citent dans leurs articles et qui ne sont pas encore au référentiel.
        Rien n&apos;y entre sans relecture : l&apos;administrateur crée la source, le superutilisateur la propose.
      </p>
      <nav className="bo-puces" aria-label="Filtrer les candidats par statut">
        {STATUTS.map(([k, libelle]) => (
          <button key={k} type="button" className="bo-puce" aria-pressed={statut === k} disabled={enCours} onClick={() => filtrer(k)}>{libelle}</button>
        ))}
      </nav>
      {liste.length ? (
        <div className="bo-scroll"><table className="bo-table"><thead><tr>
          <th scope="col">Domaine</th><th scope="col">Occurrences</th><th scope="col">Cité par</th><th scope="col">Articles</th>
          <th scope="col">Dernière occurrence</th><th scope="col"><span className="bo-note">Actions</span></th></tr></thead><tbody>
          {liste.map((c) => {
            const a = actionsCandidat(role, c);
            return (
              <tr key={c.id}>
                <td className="mono"><a href={`https://${c.domain}`} target="_blank" rel="noreferrer noopener">{c.domain}</a>
                  {c.decidedBy && c.status !== "nouveau" && <div className="bo-note">par {c.decidedBy}{c.decidedAt ? `, ${quandParis(c.decidedAt)}` : ""}</div>}</td>
                <td>{c.occurrences}</td>
                <td>{c.competitors.map((x) => x.label).join(", ") || <span className="bo-note">—</span>}</td>
                <td>
                  {c.articles.slice(0, ARTICLES_VISIBLES).map((x) => (
                    <div key={x.url}><a href={x.url} target="_blank" rel="noreferrer noopener" title={x.url}>{x.title || x.url}</a></div>
                  ))}
                  {c.articles.length > ARTICLES_VISIBLES && <div className="bo-note">et {c.articles.length - ARTICLES_VISIBLES} autre(s)</div>}
                </td>
                <td>{quandParis(c.lastSeenAt)}</td>
                <td>
                  <div className="bo-actions">
                    {a.creer && <Link className="bo-btn primary" href={hrefCreerSource(c)} aria-label={`Créer la source ${c.domain}`}>
                      <Icone nom="Plus" size={13} />Créer la source</Link>}
                    {a.proposer && <button className="bo-btn primary" type="button" disabled={enCours} aria-label={`Proposer ${c.domain}`}
                      onClick={() => proposer(c)}>Proposer</button>}
                    {a.ecarter && <button className="bo-btn" type="button" disabled={enCours} aria-label={`Écarter ${c.domain}`}
                      title={consequenceEcart(c)} onClick={() => ecarter(c)}>Écarter</button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <p className="bo-note bo-vide">Aucun domaine dans cette catégorie.</p>}
    </div>
  );
}
