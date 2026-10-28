"use client";

// Tiroir (M3-106) : panneau latéral en superposition, générique — file et
// détail de la console (lot 1), panneau d'édition des sources (lot 4).
// Accessibilité, comme Modale : dialogue modal nommé par son titre, focus posé
// à l'ouverture, piégé (piegeFocus.ts, partagé avec les modales) et rendu à
// l'élément d'origine à la fermeture ; Échap ferme. Clic sur le voile : ferme,
// sauf fermerSurVoile={false} (formulaire en cours de saisie, par exemple).
// Largeur : Tiroir.logique.ts (plein / demi / confortable selon l'écran).
// Rendu par PORTAIL dans un conteneur .cr posé sur <body> : rendu sur place, il
// héritait du contexte d'empilement de la coque (.cr-shell, .bo-shell : z-index 1)
// et passait sous la colonne de navigation (.cr-side : z-index 3). Le conteneur
// porte .cr pour garder les jetons, clair comme sombre (data-theme est sur <html>).

import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cibleTab, FOCUSABLES } from "@/app/(console)/console/modales/piegeFocus";
import { cx } from "./cx";
import { Icone } from "./Icone";
import { formatTiroir, type FormatTiroir } from "./Tiroir.logique";

export type CoteTiroir = "gauche" | "droite";

export type TiroirProps = {
  ouvert: boolean;
  onFermer: () => void;
  titre: ReactNode;
  cote?: CoteTiroir;
  fermerSurVoile?: boolean;
  actions?: ReactNode;
  pied?: ReactNode;
  libelleFermer?: string;
  className?: string;
  children?: ReactNode;
};

const abonner = (rappel: () => void) => {
  window.addEventListener("resize", rappel);
  return () => window.removeEventListener("resize", rappel);
};
const formatCourant = (): FormatTiroir => formatTiroir(window.innerWidth);
const formatServeur = (): FormatTiroir => "confortable";

/* Conteneur unique des tiroirs, créé à la demande et gardé. */
export const ID_PORTAIL_TIROIR = "m3-portail-tiroir";
function hotePortail(): HTMLElement {
  let el = document.getElementById(ID_PORTAIL_TIROIR);
  if (!el) {
    el = document.createElement("div");
    el.id = ID_PORTAIL_TIROIR;
    el.className = "cr ui-portail";
    document.body.appendChild(el);
  }
  return el;
}
const sansAbonnement = () => () => {};
/* null côté serveur et à l'hydratation : le tiroir se rend alors sur place, puis
   passe dans le portail au rendu suivant (le focus suit, cf. l'effet plus bas). */
const hoteClient = () => hotePortail();
const hoteServeur = () => null;

export function Tiroir({ ouvert, ...props }: TiroirProps) {
  return ouvert ? <PanneauTiroir {...props} /> : null;
}

function PanneauTiroir({ onFermer, titre, cote = "droite", fermerSurVoile = true, actions, pied, libelleFermer = "Fermer", className, children }: Omit<TiroirProps, "ouvert">) {
  const idTitre = useId();
  const panneau = useRef<HTMLDivElement>(null);
  const format = useSyncExternalStore(abonner, formatCourant, formatServeur);
  const hote = useSyncExternalStore(sansAbonnement, hoteClient, hoteServeur);

  /* À l'ouverture : on retient qui avait le focus et on le pose sur le premier
     élément du corps (à défaut, le bouton Fermer). À la fermeture, retour. */
  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    const el = panneau.current;
    if (el) {
      const corps = el.querySelector<HTMLElement>(`.ui-tiroir-corps :is(${FOCUSABLES})`);
      (corps || el.querySelector<HTMLElement>(FOCUSABLES) || el).focus();
    }
    return () => { if (origine && origine.isConnected) origine.focus(); };
  }, [hote]);

  const clavier = (e: KeyboardEvent) => {
    /* Un enfant qui a déjà traité la touche (ConfirmationSurPlace et son Échap) a la priorité. */
    if (e.defaultPrevented) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFermer(); return; }
    if (e.key !== "Tab" || !panneau.current) return;
    const liste = Array.from(panneau.current.querySelectorAll<HTMLElement>(FOCUSABLES));
    const i = cibleTab(liste.length, liste.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (i === null) return;
    e.preventDefault();
    liste[i].focus();
  };

  const rendu = (
    <div className={cx("ui-tiroir-voile", `ui-tiroir-voile--${cote}`)} onClick={(e) => { if (fermerSurVoile && e.target === e.currentTarget) onFermer(); }}>
      <div ref={panneau} role="dialog" aria-modal="true" aria-labelledby={idTitre} tabIndex={-1} onKeyDown={clavier}
        className={cx("ui-tiroir", `ui-tiroir--${cote}`, `ui-tiroir--${format}`, className)}>
        <div className="ui-tiroir-tete">
          <h2 id={idTitre} className="ui-tiroir-titre">{titre}</h2>
          {actions && <div className="ui-tiroir-actions">{actions}</div>}
          <button type="button" className="ui-tiroir-fermer" onClick={onFermer} aria-label={libelleFermer}><Icone nom="X" size={16} /></button>
        </div>
        <div className="ui-tiroir-corps">{children}</div>
        {pied && <div className="ui-tiroir-pied">{pied}</div>}
      </div>
    </div>
  );
  return hote ? createPortal(rendu, hote) : rendu;
}
