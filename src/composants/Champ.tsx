// Champ (M3-106) : libellé relié au contrôle (htmlFor/id, généré par useId si
// l'appelant n'en donne pas), aide et erreur reliées par aria-describedby,
// aria-invalid quand il y a une erreur. Le contrôle est l'enfant (input, select,
// textarea…), complété par clonage ; sans enfant, un <input> qui reçoit toutes
// les autres props.

import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cx } from "./cx";

type ControleProps = { id?: string; className?: string; required?: boolean; "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" };

export type ChampProps = Omit<ComponentProps<"input">, "children"> & {
  libelle: ReactNode;
  aide?: ReactNode;
  erreur?: ReactNode;
  requis?: boolean;
  classeChamp?: string;
  children?: ReactElement<ControleProps>;
};

export function Champ({ libelle, aide, erreur, requis = false, classeChamp, id, className, children, ...inputProps }: ChampProps) {
  const auto = useId();
  const enfant = isValidElement(children) ? children : null;
  const idControle = id ?? enfant?.props.id ?? `${auto}-c`;
  const idAide = aide ? `${auto}-aide` : undefined;
  const idErreur = erreur ? `${auto}-err` : undefined;
  const decrit = [enfant?.props["aria-describedby"], idAide, idErreur].filter(Boolean).join(" ") || undefined;
  const aria = { id: idControle, "aria-describedby": decrit, "aria-invalid": erreur ? true : undefined, required: requis || undefined };

  const controle = enfant
    ? cloneElement(enfant, { ...aria, className: cx("ui-champ-controle", enfant.props.className) })
    : <input {...inputProps} {...aria} className={cx("ui-champ-controle", className)} />;

  return (
    <div className={cx("ui-champ", !!erreur && "ui-champ--erreur", classeChamp)}>
      <label className="ui-champ-libelle" htmlFor={idControle}>
        {libelle}{requis && <span className="ui-champ-requis" aria-hidden="true"> *</span>}
      </label>
      {controle}
      {aide && <p id={idAide} className="ui-champ-aide">{aide}</p>}
      {erreur && <p id={idErreur} className="ui-champ-erreur">{erreur}</p>}
    </div>
  );
}
