"use client";

// Sous-onglet Sources → Concurrents (M3-120) : la liste des sites concurrents.
// Ajouter, modifier, désactiver (le site reste listé, il ne sera plus crawlé)
// ou retirer. M3-122 : colonne « Dernier scan » (date, voie, erreur).

import { useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { ConfirmationSurPlace } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import { SAISIE_VIDE, consequenceRetrait, dernierScan, refusSaisie, type Concurrent, type Saisie } from "@/gererConcurrents/gererConcurrents.regles";
import { activerConcurrent, ajouterConcurrent, modifierConcurrent, relireConcurrents, retirerConcurrent } from "@/gererConcurrents/gererConcurrents.action";

export function TableauConcurrents({ initiaux }: { initiaux: Concurrent[] }) {
  const flash = useFlash();
  const [liste, setListe] = useState<Concurrent[]>(initiaux);
  const [saisie, setSaisie] = useState<Saisie>(SAISIE_VIDE);
  const [edition, setEdition] = useState<Concurrent | null>(null);
  const [enCours, lancer] = useTransition();

  const relire = async () => {
    const r = await relireConcurrents();
    if (r.ok) setListe(r.data.competitors);
  };
  const champ = (k: keyof Saisie, v: string) => setSaisie((s) => ({ ...s, [k]: v }));
  const annuler = () => { setEdition(null); setSaisie(SAISIE_VIDE); };

  const enregistrer = () => lancer(async () => {
    const refus = refusSaisie(saisie);
    if (refus) return flash(refus, true);
    const r = edition ? await modifierConcurrent(edition.id, saisie) : await ajouterConcurrent(saisie);
    if (!r.ok) return flash(r.erreur, true);
    flash(edition ? `Concurrent « ${r.data.competitor.label} » modifié` : `Concurrent « ${r.data.competitor.label} » ajouté`);
    annuler();
    await relire();
  });

  const basculer = (c: Concurrent) => lancer(async () => {
    const r = await activerConcurrent(c.id, !c.active);
    if (!r.ok) return flash(r.erreur, true);
    flash(c.active ? `« ${c.label} » désactivé : il ne sera plus crawlé` : `« ${c.label} » réactivé`);
    await relire();
  });

  /* Erreur levée : ConfirmationSurPlace l'affiche sur place et reste ouverte. */
  const retirer = async (c: Concurrent) => {
    const r = await retirerConcurrent(c.id);
    if (!r.ok) throw new Error(r.erreur);
    flash(`« ${c.label} » retiré de la liste`);
    if (edition?.id === c.id) annuler();
    await relire();
  };

  const actifs = liste.filter((c) => c.active).length;

  return (
    <>
      <div className="bo-card"><h3>Concurrents <span className="bo-note">{actifs}/{liste.length} suivi(s)</span></h3>
        <p className="bo-hint">
          Les sites dont M3 analysera les articles pour y repérer des sources à proposer (liens et organismes cités).
          Rien n&apos;entre dans le référentiel sans relecture. Un site désactivé reste listé mais n&apos;est plus crawlé.
        </p>
        {liste.length ? (
          <div className="bo-scroll"><table className="bo-table"><thead><tr>
            <th scope="col">Libellé</th><th scope="col">Site</th><th scope="col">État</th><th scope="col">Dernier scan</th><th scope="col">Ajouté par</th>
            <th scope="col"><span className="bo-note">Actions</span></th></tr></thead><tbody>
            {liste.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td className="mono"><a href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a></td>
                <td>{c.active ? <span className="bo-ok">suivi</span> : <span className="bo-discret">désactivé</span>}</td>
                <td><DernierScan c={c} /></td>
                <td>{c.createdBy || <span className="bo-note">—</span>}</td>
                <td>
                  <div className="bo-actions">
                    <button className="bo-btn" type="button" disabled={enCours} aria-label={`Modifier ${c.label}`}
                      onClick={() => { setEdition(c); setSaisie({ label: c.label, url: c.url }); }}><Icone nom="Pencil" size={13} />Modifier</button>
                    <button className="bo-btn" type="button" disabled={enCours} aria-label={`${c.active ? "Désactiver" : "Réactiver"} ${c.label}`}
                      onClick={() => basculer(c)}>{c.active ? "Désactiver" : "Réactiver"}</button>
                    <ConfirmationSurPlace libelle="Retirer" taille="petite" desactive={enCours} ariaLabel={`Retirer ${c.label}`}
                      consequence={consequenceRetrait(c)} libelleConfirmer="Retirer" libelleEnCours="Retrait…" onConfirm={() => retirer(c)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <p className="bo-note">Aucun concurrent suivi pour l&apos;instant.</p>}
      </div>

      <div className="bo-card"><h3>{edition ? `Modifier « ${edition.label} »` : "Ajouter un concurrent"}</h3>
        <div className="bo-actions">
          <input className="bo-in" name="label" aria-label="Libellé du concurrent" placeholder="Libellé (ex. Sud Ouest)" value={saisie.label}
            onChange={(e) => champ("label", e.target.value)} />
          <input className="bo-in" name="url" type="url" aria-label="Adresse du site concurrent" placeholder="https://www.exemple.fr" value={saisie.url}
            onChange={(e) => champ("url", e.target.value)} />
          <button className="bo-btn primary" type="button" onClick={enregistrer} disabled={enCours}>
            <Icone nom={edition ? "Check" : "Plus"} size={13} />{edition ? "Enregistrer" : "Ajouter"}</button>
          {edition && <button className="bo-btn" type="button" onClick={annuler} disabled={enCours}>Annuler</button>}
        </div>
      </div>
    </>
  );
}

function DernierScan({ c }: { c: Concurrent }) {
  const d = dernierScan(c);
  return <>{d.texte === "jamais" ? <span className="bo-note">jamais</span> : d.texte}
    {d.detail && <div className={d.erreur ? "bo-sev-error" : "bo-note"}>{d.erreur ? `erreur : ${d.detail}` : d.detail}</div>}</>;
}
