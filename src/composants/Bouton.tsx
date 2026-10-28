// Bouton (M3-106) : variantes primaire, secondaire, discret, danger ; trois
// tailles ; état de chargement (désactivé, aria-busy, indicateur qui tourne).
// type="button" par défaut : un bouton dans un formulaire ne le soumet que si
// on le demande. Toutes les props natives de <button> passent, ref comprise.

import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx";
import { Icone } from "./Icone";

export type VarianteBouton = "primaire" | "secondaire" | "discret" | "danger";
export type TailleBouton = "petite" | "normale" | "grande";

export type BoutonProps = ComponentPropsWithRef<"button"> & {
  variante?: VarianteBouton;
  taille?: TailleBouton;
  chargement?: boolean;
  icone?: string;
  pleineLargeur?: boolean;
};

export function Bouton({ variante = "secondaire", taille = "normale", chargement = false, icone, pleineLargeur = false,
  type = "button", disabled, className, children, ...rest }: BoutonProps) {
  return (
    <button {...rest} type={type} disabled={disabled || chargement} aria-busy={chargement || undefined}
      className={cx("ui-bouton", `ui-bouton--${variante}`, `ui-bouton--${taille}`, chargement && "ui-bouton--chargement", pleineLargeur && "ui-bouton--plein", className)}>
      {chargement ? <span className="ui-bouton-roue" aria-hidden="true" /> : icone && <Icone nom={icone} size={taille === "petite" ? 14 : 16} />}
      {children}
    </button>
  );
}
