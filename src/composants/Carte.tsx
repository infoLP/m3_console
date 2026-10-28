// Carte (M3-106) : conteneur de bloc. Titre et actions d'en-tête facultatifs ;
// variante « encadree » (fond, filet, ombre) ou « aplat » (fond seul, sans filet
// ni ombre). Avec un titre, la section est nommée par lui (aria-labelledby).

import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Titre } from "./Titre";

export type VarianteCarte = "encadree" | "aplat";

export type CarteProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  titre?: ReactNode;
  niveauTitre?: 2 | 3 | 4;
  actions?: ReactNode;
  variante?: VarianteCarte;
  as?: "section" | "article" | "div" | "aside";
  children?: ReactNode;
};

export function Carte({ titre, niveauTitre = 3, actions, variante = "encadree", as: Balise = "section", className, children, ...rest }: CarteProps) {
  const idTitre = useId();
  return (
    <Balise {...rest} aria-labelledby={titre ? idTitre : rest["aria-labelledby"]} className={cx("ui-carte", `ui-carte--${variante}`, className)}>
      {(titre || actions) && (
        <div className="ui-carte-tete">
          {titre && <Titre niveau={niveauTitre} id={idTitre} className="ui-carte-titre">{titre}</Titre>}
          {actions && <div className="ui-carte-actions">{actions}</div>}
        </div>
      )}
      <div className="ui-carte-corps">{children}</div>
    </Balise>
  );
}
