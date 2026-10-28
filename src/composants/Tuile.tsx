// Tuile (M3-106) : un indicateur chiffré. Libellé, valeur (chiffres tabulaires),
// unité ; ton facultatif (neutre, go, amber, stop) qui colore la valeur et le
// liseré ; tendance facultative (hausse, baisse, stable) avec son texte. Avec
// `href`, toute la tuile est un lien ; avec `onClick` (et sans `href`), un bouton :
// une action côté client, comme ouvrir la file filtrée (R12, M3-108).

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type TonTuile = "neutre" | "go" | "amber" | "stop";
export type Tendance = { sens: "hausse" | "baisse" | "stable"; texte: ReactNode };

export type TuileProps = {
  libelle: ReactNode;
  valeur: ReactNode;
  unite?: ReactNode;
  ton?: TonTuile;
  tendance?: Tendance;
  href?: string;
  /* Ignoré si `href` est posé : un lien reste un lien. */
  onClick?: () => void;
  className?: string;
};

const FLECHE = { hausse: "↑", baisse: "↓", stable: "→" } as const;

export function Tuile({ libelle, valeur, unite, ton = "neutre", tendance, href, onClick, className }: TuileProps) {
  const contenu = (
    <>
      <span className="ui-tuile-libelle">{libelle}</span>
      <span className="ui-tuile-valeur">
        {valeur}
        {unite && <span className="ui-tuile-unite">{unite}</span>}
      </span>
      {tendance && (
        <span className={cx("ui-tuile-tendance", `ui-tuile-tendance--${tendance.sens}`)}>
          <span aria-hidden="true">{FLECHE[tendance.sens]}</span> {tendance.texte}
        </span>
      )}
    </>
  );
  const bouton = !href && !!onClick;
  const classes = cx("ui-tuile", `ui-tuile--${ton}`, (href || bouton) && "ui-tuile--lien", bouton && "ui-tuile--bouton", className);
  if (href) return <Link href={href} className={classes}>{contenu}</Link>;
  if (bouton) return <button type="button" className={classes} onClick={onClick}>{contenu}</button>;
  return <div className={classes}>{contenu}</div>;
}
