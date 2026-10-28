"use client";

import { useState } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { zoneClassOf } from "@shared/model.js";
import { useConsole } from "../store";
import { Modale } from "./Modale";

export function ModaleRegenerer() {
  const c = useConsole();
  const flash = useFlash();
  const [alt, setAlt] = useState("");
  const [force, setForce] = useState(false);
  const sel = c.sel;
  if (!sel) return null;
  /* Hors zone (M3-85) : le serveur refuse sans confirmation. La fenêtre le dit
     d'emblée et propose la confirmation, au lieu d'un refus après coup. */
  const outside = (sel.zoneClass || zoneClassOf(sel.zone)) === "nonhab";
  const go = () => {
    if (outside && !force) return flash("Cochez « Régénérer quand même » pour confirmer, ou classez l'article sans diffusion", true);
    void c.regenerate(alt.trim() || null, force);
  };
  return (
    <Modale titre="Renvoyer à l'IA" onClose={c.fermerModale}>
      {outside && <p className="md-alerte">Ce sujet est hors des zones couvertes : une nouvelle version coûte un appel LLM pour un article qui ne sera pas publié. Le classer sans diffusion est en général le bon geste.</p>}
      <p className="md-texte">Une nouvelle version sera générée{c.moi.llmProvider === "mock" ? " (mode mock)" : ""}. Vous pouvez ajouter une consigne.</p>
      <textarea className="cr-in" rows={3} aria-label="Consigne pour l'IA" placeholder="Consigne facultative (ex. « plus court, angle emploi »)" value={alt} onChange={(e) => setAlt(e.target.value)} />
      {outside && <label className="md-case md-case--regen"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Régénérer quand même</label>}
      <div className="md-pied"><button className="cr-btn pub" type="button" onClick={go}><Icone nom="RotateCcw" size={15} />Relancer</button></div>
    </Modale>
  );
}
