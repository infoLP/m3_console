// Titre (M3-106) : niveau visuel h1 à h4, balise réelle réglable par `as`
// (un titre de niveau 2 visuel peut être un h3 dans le plan du document).
// Kicker (au-dessus) et sous-titre (au-dessous) facultatifs : avec l'un ou
// l'autre, le tout est groupé dans un <hgroup>.

import type { ReactNode } from "react";
import { cx } from "./cx";

export type NiveauTitre = 1 | 2 | 3 | 4;
export type BaliseTitre = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div";

export type TitreProps = {
  niveau?: NiveauTitre;
  as?: BaliseTitre;
  kicker?: ReactNode;
  sousTitre?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
};

export function Titre({ niveau = 2, as, kicker, sousTitre, id, className, children }: TitreProps) {
  const Balise = as ?? (`h${niveau}` as const);
  const titre = <Balise id={id} className={cx("ui-titre", `ui-titre--n${niveau}`, !kicker && !sousTitre && className)}>{children}</Balise>;
  if (!kicker && !sousTitre) return titre;
  return (
    <hgroup className={cx("ui-titre-groupe", className)}>
      {kicker && <p className="ui-titre-kicker">{kicker}</p>}
      {titre}
      {sousTitre && <p className="ui-titre-sous">{sousTitre}</p>}
    </hgroup>
  );
}
