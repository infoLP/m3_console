// Message (M3-106) : bandeau info, succès, avertissement, erreur. L'erreur est
// annoncée tout de suite (role="alert", assertif) ; les autres poliment
// (role="status"). Attention : une région live n'annonce que ce qui change
// APRÈS son insertion — pour un message qui apparaît au fil de l'action, rendre
// le Message à vide d'abord ou passer par le toast.

import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icone } from "./Icone";

export type TonMessage = "info" | "succes" | "avertissement" | "erreur";

export type MessageProps = {
  ton?: TonMessage;
  titre?: ReactNode;
  action?: ReactNode;
  onFermer?: () => void;
  className?: string;
  children?: ReactNode;
};

const ICONE: Record<TonMessage, string> = { info: "Bell", succes: "Check", avertissement: "Shield", erreur: "XCircle" };

export function Message({ ton = "info", titre, action, onFermer, className, children }: MessageProps) {
  return (
    <div role={ton === "erreur" ? "alert" : "status"} className={cx("ui-message", `ui-message--${ton}`, className)}>
      <span className="ui-message-icone" aria-hidden="true"><Icone nom={ICONE[ton]} size={16} /></span>
      <div className="ui-message-corps">
        {titre && <p className="ui-message-titre">{titre}</p>}
        {children && <div className="ui-message-texte">{children}</div>}
      </div>
      {action && <div className="ui-message-action">{action}</div>}
      {onFermer && (
        <button type="button" className="ui-message-fermer" onClick={onFermer} aria-label="Fermer le message">
          <Icone nom="X" size={14} />
        </button>
      )}
    </div>
  );
}
