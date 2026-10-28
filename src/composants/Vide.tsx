// Vide (M3-106) : LE motif « rien / pas encore fait ». Un seul dessin pour
// toute l'application — une file vide, une liste sans résultat, une étape pas
// encore lancée se reconnaissent du même coup d'œil. D'où l'absence de prop
// d'icône ou de couleur : seuls le texte et l'action varient.

import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icone } from "./Icone";

export type VideProps = {
  titre: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function Vide({ titre, message, action, compact = false, className }: VideProps) {
  return (
    <div className={cx("ui-vide", compact && "ui-vide--compact", className)}>
      <span className="ui-vide-icone" aria-hidden="true"><Icone nom="Inbox" size={compact ? 18 : 24} /></span>
      <p className="ui-vide-titre">{titre}</p>
      {message && <p className="ui-vide-message">{message}</p>}
      {action && <div className="ui-vide-action">{action}</div>}
    </div>
  );
}
