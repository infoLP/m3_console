"use client";

import { Icone } from "@/composants/Icone";
import { usePrefs } from "@/composants/prefs";
import { etatTouche, libelleTouche, raccourcis } from "@/reglerPreferences/reglerPreferences.regles";
import { useConsole } from "../store";
import { Modale } from "./Modale";

export function ModaleRaccourcis() {
  const c = useConsole();
  const prefs = usePrefs();
  const { actions, actifGlobal } = raccourcis(c.moi.keys, prefs);
  return (
    <Modale titre="Raccourcis clavier" onClose={c.fermerModale}>
      <p className="md-intro">
        Actifs sur la Relecture. Aucun ne se déclenche pendant que vous écrivez : dès que le curseur est dans un champ, les touches redeviennent des lettres.
        {!actifGlobal && <><br /><b>Les raccourcis sont actuellement désactivés.</b></>}
      </p>
      <dl className="kb-list">
        {actions.map((a) => {
          const etat = etatTouche(a);
          return (
            <div key={a.id} className="md-contents">
              <dt><kbd className={a.actif ? undefined : "kb-mort"}>{libelleTouche(a)}</kbd></dt>
              <dd>{a.label}{etat && etat.startsWith(" ") ? etat : etat ? <span className="kb-off">{etat}</span> : null}</dd>
            </div>
          );
        })}
        <dt><kbd>?</kbd></dt><dd>Cet aide-mémoire</dd>
        <dt><kbd>Échap</kbd></dt><dd>Quitter le champ en cours, ou annuler une action armée</dd>
      </dl>
      <div className="md-pied md-pied--large">
        <button className="cr-btn ghost" type="button" onClick={() => c.ouvrirModale({ kind: "prefs" })}><Icone nom="Settings" size={15} />Changer mes touches</button>
      </div>
    </Modale>
  );
}
