"use client";

// Préférences de poste : départements suivis, affichage (FEAT), clavier.
// La capture d'une touche se fait au clavier : on appuie sur la touche qu'on
// veut, et c'est exactement celle-là qui est enregistrée.

import { useId, useState } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { ecrirePrefs, lirePrefs, appliquerTheme } from "@/composants/prefs";
import { zoneOf } from "@shared/model.js";
import { departementsDeLaFile } from "@/relireArticles/relireArticles.regles";
import { libelleTouche, normKey, raccourcis, validerTouche } from "@/reglerPreferences/reglerPreferences.regles";
import { useConsole } from "../store";
import { Modale } from "./Modale";

export function ModalePreferences() {
  const c = useConsole();
  const flash = useFlash();
  const initial = lirePrefs();
  const [depts, setDepts] = useState<string[]>((initial.depts as string[]) || []);
  const [dark, setDark] = useState(initial.theme === "dark");
  const [plag, setPlag] = useState(!!(initial.features as Record<string, boolean> | undefined)?.antiPlagiat);
  const [keysEnabled, setKeysEnabled] = useState(initial.keysEnabled !== false);
  const [keysOff, setKeysOff] = useState<string[]>((initial.keysOff as string[]) || []);
  const [keys, setKeys] = useState<Record<string, string>>((initial.keys as Record<string, string>) || {});
  const [enAttente, setEnAttente] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const id = useId();

  const feats = c.moi.feats;
  const choix = departementsDeLaFile(c.index);
  const { actions } = raccourcis(c.moi.keys, { keys, keysOff, keysEnabled });

  const enregistrer = () => {
    const patch: Record<string, unknown> = { depts, keysEnabled, keysOff, keys };
    // une FEAT absente de l'écran garde la préférence du poste telle quelle
    if (feats.dark !== false) patch.theme = dark ? "dark" : "auto";
    if (feats.antiPlagiat !== false) patch.features = { ...((initial.features as object) || {}), antiPlagiat: plag };
    ecrirePrefs(patch);
    appliquerTheme(feats);
    c.fermerModale();
    flash("Préférences enregistrées");
  };

  /* Capture en phase de CAPTURE : la frappe n'atteint pas le clavier global. */
  const onKeyCapture = (e: React.KeyboardEvent) => {
    if (!enAttente) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { setEnAttente(null); setMsg(""); return; }
    const refus = validerTouche(e.key, enAttente, actions);
    if (refus) { setMsg(`Touche refusée : ${refus}.`); return; }
    setKeys((k) => ({ ...k, [enAttente]: normKey(e.key) as string }));
    setEnAttente(null);
    setMsg("Touche prise. Pensez à enregistrer.");
  };

  return (
    <Modale titre="Préférences" onClose={c.fermerModale}>
      <div onKeyDownCapture={onKeyCapture}>
        <div className="cr-lbl" id={`${id}-depts`}>Départements suivis</div>
        <div role="group" aria-labelledby={`${id}-depts`} className="md-depts">
          {choix.map((d) => (
            <label key={d} className="md-dept">
              <input type="checkbox" checked={depts.includes(d)} onChange={(e) => setDepts((l) => (e.target.checked ? [...l, d] : l.filter((x) => x !== d)))} /> {d} <span className="cr-ink-3">({zoneOf(d) === "hab" ? "habilitée" : "non hab."})</span>
            </label>
          ))}
        </div>
        <div role="group" aria-labelledby={`${id}-aff`}>
        <div className="cr-lbl" id={`${id}-aff`}>Affichage</div>
        {feats.dark !== false && <label className="md-case md-case--haut"><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Mode sombre (FEAT)</label>}
        {feats.antiPlagiat !== false && <label className="md-case"><input type="checkbox" checked={plag} onChange={(e) => setPlag(e.target.checked)} /> Contrôle anti-plagiat systématique (FEAT)</label>}
        {feats.dark === false && feats.antiPlagiat === false && <p className="md-aucune">Aucune option d&apos;affichage ouverte à votre rôle.</p>}
        </div>
        <div className="cr-lbl md-sec" id={`${id}-kb`}>Clavier</div>
        <label className="md-case md-case--kb"><input type="checkbox" checked={keysEnabled} onChange={(e) => setKeysEnabled(e.target.checked)} /> Raccourcis clavier actifs</label>
        <div className="kb-edit" role="group" aria-labelledby={`${id}-kb`}>
          {actions.map((a) => {
            const libre = !a.bornePar;
            return (
              <div key={a.id} className={`kb-row${libre ? "" : " kb-borne"}`}>
                <label className="kb-cb"><input type="checkbox" aria-label={`Activer « ${a.label} »`} disabled={!libre} checked={libre && !keysOff.includes(a.id)} onChange={(e) => setKeysOff((l) => (e.target.checked ? l.filter((x) => x !== a.id) : [...l, a.id]))} /></label>
                <span className="kb-lab">{a.label}</span>
                {libre
                  ? <button type="button" aria-label={`Touche de « ${a.label} » : ${enAttente === a.id ? "en attente" : libelleTouche(a)}`} className={`kb-key${enAttente === a.id ? " kb-attente" : ""}`} onClick={() => { setEnAttente(a.id); setMsg("Appuyez sur la touche voulue. Échap pour annuler."); }}>{enAttente === a.id ? "appuyez…" : libelleTouche(a)}</button>
                  : <span className="kb-off">{a.bornePar}</span>}
              </div>
            );
          })}
        </div>
        <p className="kb-msg" aria-live="polite">{msg}</p>
        <div className="md-pied md-pied--large"><button className="cr-btn pub" type="button" onClick={enregistrer}><Icone nom="Check" size={15} />Enregistrer</button></div>
      </div>
    </Modale>
  );
}
