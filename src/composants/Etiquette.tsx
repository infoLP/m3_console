// Etiquette (M3-106) : pastille. Trois façons de la colorer, par ordre de
// priorité : `statut` (clé de STATUSES, couleur --status-<clé>, libellé par
// défaut celui de STATUSES), `rubrique` (nom de rubrique, couleurs
// --rub-<slug> et --rub-<slug>-tint), sinon `ton`.

import type { CSSProperties, ReactNode } from "react";
import { STATUSES } from "@shared/model.js";
import { cx } from "./cx";

export type TonEtiquette = "neutre" | "brand" | "go" | "amber" | "stop";
export type StatutCle = keyof typeof STATUSES;

export type EtiquetteProps = {
  ton?: TonEtiquette;
  statut?: StatutCle;
  rubrique?: string;
  title?: string;
  className?: string;
  children?: ReactNode;
};

/** « Économie » → « economie » : le suffixe des jetons --rub-<slug>. */
export function slugRubrique(nom: string): string {
  return nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function Etiquette({ ton = "neutre", statut, rubrique, title, className, children }: EtiquetteProps) {
  if (statut) {
    return (
      <span title={title} className={cx("ui-etiquette", "ui-etiquette--statut", `ui-etiquette--statut-${statut}`, className)}>
        {children ?? STATUSES[statut]?.label ?? statut}
      </span>
    );
  }
  if (rubrique) {
    const s = slugRubrique(rubrique);
    /* Valeur dynamique (la rubrique vient des données) : seules des var() passent
       par le style, jamais une couleur. Rubrique sans jeton : retombe sur --brand. */
    const vars = { "--ui-etiquette-c": `var(--rub-${s}, var(--brand))`, "--ui-etiquette-fond": `var(--rub-${s}-tint, var(--brand-tint))` } as CSSProperties;
    return <span title={title} className={cx("ui-etiquette", "ui-etiquette--rubrique", className)} style={vars}>{children ?? rubrique}</span>;
  }
  return <span title={title} className={cx("ui-etiquette", `ui-etiquette--${ton}`, className)}>{children}</span>;
}
