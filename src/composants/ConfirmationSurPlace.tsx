"use client";

// ConfirmationSurPlace (M3-106, base de l'axe B4) : « destructif confirmé sur
// place, conséquence écrite ». Le bouton déclencheur est remplacé, au même
// endroit, par la conséquence en toutes lettres puis Confirmer (danger) et
// Annuler — pas de modale qui sort la question de son contexte. Échap annule ;
// le focus va sur Annuler à l'ouverture (le choix sans dégât) et revient au
// déclencheur à la fermeture. Pendant onConfirm (async), état « en cours ».
// La logique vit dans ConfirmationSurPlace.logique.ts.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Bouton, type TailleBouton, type VarianteBouton } from "./Bouton";
import { cibleFocus, ETAT_INITIAL, messageEchec as messageParDefaut, transition, type EtatConfirmation, type EvenementConfirmation } from "./ConfirmationSurPlace.logique";
import { cx } from "./cx";

export type ConfirmationSurPlaceProps = {
  libelle: ReactNode;
  consequence: ReactNode;
  onConfirm: () => void | Promise<void>;
  libelleConfirmer?: ReactNode;
  libelleAnnuler?: ReactNode;
  libelleEnCours?: ReactNode;
  varianteDeclencheur?: VarianteBouton;
  taille?: TailleBouton;
  icone?: string;
  desactive?: boolean;
  messageEchec?: (e: unknown) => string;
  className?: string;
  /* Transmis au bouton déclencheur (R13) : raccourcis clavier, nom accessible
     distinct du libellé visible, infobulle. */
  id?: string;
  ariaLabel?: string;
  title?: string;
};

export function ConfirmationSurPlace({ libelle, consequence, onConfirm, libelleConfirmer = "Confirmer", libelleAnnuler = "Annuler",
  libelleEnCours = "En cours…", varianteDeclencheur = "danger", taille = "normale", icone, desactive = false,
  messageEchec = messageParDefaut, className, id, ariaLabel, title }: ConfirmationSurPlaceProps) {
  const [etat, setEtat] = useState<EtatConfirmation>(ETAT_INITIAL);
  const precedent = useRef<EtatConfirmation>(ETAT_INITIAL);
  const declencheur = useRef<HTMLButtonElement>(null);
  const annuler = useRef<HTMLButtonElement>(null);
  const idConsequence = useId();

  /* Le focus suit la transition, une fois le nouveau rendu en place. */
  useEffect(() => {
    const cible = cibleFocus(precedent.current, etat);
    precedent.current = etat;
    if (cible === "annuler") annuler.current?.focus();
    if (cible === "declencheur" && declencheur.current?.isConnected) declencheur.current.focus();
  }, [etat]);

  const envoyer = (ev: EvenementConfirmation) => setEtat((e) => transition(e, ev));

  const confirmer = async () => {
    envoyer({ type: "confirmer" });
    try {
      await onConfirm();
      envoyer({ type: "reussite" });
    } catch (e) {
      envoyer({ type: "echec", message: messageEchec(e) });
    }
  };

  const clavier = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    /* Échap est consommé ici : un Tiroir ou une Modale autour ne doit pas se
       fermer en même temps. Pendant en_cours, il est consommé sans effet. */
    e.preventDefault();
    e.stopPropagation();
    envoyer({ type: "touche", touche: e.key });
  };

  if (etat.phase === "repos") {
    return (
      <Bouton ref={declencheur} variante={varianteDeclencheur} taille={taille} icone={icone} disabled={desactive}
        className={className} id={id} aria-label={ariaLabel} title={title} onClick={() => envoyer({ type: "ouvrir" })}>
        {libelle}
      </Bouton>
    );
  }

  const enCours = etat.phase === "en_cours";
  return (
    <div role="group" aria-labelledby={idConsequence} className={cx("ui-confirmation", className)} onKeyDown={clavier}>
      <p id={idConsequence} className="ui-confirmation-consequence">{consequence}</p>
      <div className="ui-confirmation-actions">
        <Bouton variante="danger" taille={taille} chargement={enCours} onClick={confirmer}>
          {enCours ? libelleEnCours : libelleConfirmer}
        </Bouton>
        <Bouton ref={annuler} variante="secondaire" taille={taille} disabled={enCours} onClick={() => envoyer({ type: "annuler" })}>
          {libelleAnnuler}
        </Bouton>
      </div>
      {etat.phase === "confirmation" && etat.erreur && <p role="alert" className="ui-confirmation-erreur">{etat.erreur}</p>}
    </div>
  );
}
