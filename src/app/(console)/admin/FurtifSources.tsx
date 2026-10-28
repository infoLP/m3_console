"use client";

// Liste blanche du crawler furtif (M3-117, suite de M3-57). Lecture de l'état de
// récolte (harvest/sources-state.json) : sources lues en furtif depuis un 403,
// et sources mises à l'écart. Seule action : retirer une source de la liste
// blanche, confirmée sur place. Administrateur seulement (403 sinon, côté API).

import { useEffect, useState } from "react";
import { ConfirmationSurPlace, Etiquette, Message } from "@/composants/primitives";
import { useFlash } from "@/composants/Toast";
import {
  CONSEQUENCE_RETRAIT_FURTIF, dernierResultat, quandParis,
  type LigneEcart, type LigneFurtif, type ListeBlancheFurtif,
} from "@/gererSources/gererSources.regles";
import { lireListeFurtif, retirerDuFurtif } from "@/gererSources/gererSources.action";

export function FurtifSources() {
  const flash = useFlash();
  const [liste, setListe] = useState<ListeBlancheFurtif | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    lireListeFurtif().then((r) => {
      if (!vivant) return;
      if (r.ok) setListe(r.data);
      else setErreur(r.erreur);
    });
    return () => { vivant = false; };
  }, []);

  /* Erreur levée : ConfirmationSurPlace l'affiche sur place et reste ouverte. */
  const retirer = async (l: LigneFurtif) => {
    const r = await retirerDuFurtif(l.id);
    if (!r.ok) throw new Error(r.erreur);
    setListe(r.data);
    flash(`« ${l.name} » retirée de la liste blanche du furtif`);
  };

  return (
    <div className="bo-card bo-furtif">
      <h3>Crawler furtif <span className="bo-note">liste blanche et sources mises à l&apos;écart</span></h3>
      {erreur && <Message ton="erreur">{erreur}</Message>}
      {!liste && !erreur && <p className="bo-note">Chargement…</p>}
      {liste && (
        <>
          <h4>Liste blanche ({liste.furtif.length})</h4>
          {liste.furtif.length === 0
            ? <p className="bo-note bo-vide">Aucune source n&apos;est lue en furtif.</p>
            : (
              <div className="bo-scroll"><table className="bo-table"><thead><tr>
                <th scope="col">Source</th><th scope="col">En furtif depuis</th><th scope="col">Dernier re-test</th>
                <th scope="col">Dernier résultat</th><th scope="col"><span className="bo-note">Action</span></th>
              </tr></thead><tbody>
                {liste.furtif.map((l) => <LigneListeBlanche key={l.id} l={l} onRetirer={retirer} />)}
              </tbody></table></div>
            )}

          <h4>Mises à l&apos;écart ({liste.ecart.length})</h4>
          {liste.ecart.length === 0
            ? <p className="bo-note bo-vide">Aucune source n&apos;est à l&apos;écart.</p>
            : (
              <div className="bo-scroll"><table className="bo-table"><thead><tr>
                <th scope="col">Source</th><th scope="col">À l&apos;écart jusqu&apos;au</th><th scope="col">Échecs d&apos;affilée</th>
                <th scope="col">Dernier résultat</th>
              </tr></thead><tbody>
                {liste.ecart.map((l) => <LigneMiseALEcart key={l.id} l={l} />)}
              </tbody></table></div>
            )}
        </>
      )}
    </div>
  );
}

function NomSource({ l }: { l: LigneFurtif | LigneEcart }) {
  return <>{l.name}{!l.connue && <div className="bo-note">plus au référentiel</div>}</>;
}

function LigneListeBlanche({ l, onRetirer }: { l: LigneFurtif; onRetirer: (l: LigneFurtif) => Promise<void> }) {
  const d = dernierResultat(l);
  return (
    <tr>
      <td><NomSource l={l} /></td>
      <td>{quandParis(l.since)}</td>
      <td>{l.checkedAt ? quandParis(l.checkedAt) : <span className="bo-note">pas encore</span>}
        {l.prochainRetest && <div className="bo-note">prochain : {quandParis(l.prochainRetest)}</div>}</td>
      <td><Etiquette ton={d.ton}>{d.texte}</Etiquette></td>
      <td>
        <ConfirmationSurPlace libelle="Retirer" varianteDeclencheur="discret" taille="petite"
          ariaLabel={`Retirer ${l.name} de la liste blanche du furtif`}
          libelleConfirmer="Retirer" libelleEnCours="Retrait…" consequence={CONSEQUENCE_RETRAIT_FURTIF} onConfirm={() => onRetirer(l)} />
      </td>
    </tr>
  );
}

function LigneMiseALEcart({ l }: { l: LigneEcart }) {
  const d = dernierResultat(l);
  return (
    <tr>
      <td><NomSource l={l} />{l.enFurtif && <div className="bo-note">en liste blanche du furtif</div>}</td>
      <td>{quandParis(l.quarantinedUntil)}</td>
      <td>{l.failures}</td>
      <td><Etiquette ton={d.ton}>{d.texte}</Etiquette></td>
    </tr>
  );
}
