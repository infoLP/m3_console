"use client";

// Demande d'ajout de source (M3-92). Les refus se disent dans la fenêtre, qui
// reste ouverte : rien de saisi ne se perd sur une adresse mal tapée.

import { useId, useState } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { SCOPE_LEVELS, zoneChoices } from "@shared/zones.js";
import { CHAMPS_VIDES, construireDemande, type ChampsDemande } from "@/demanderSource/demanderSource.regles";
import { envoyerDemande } from "@/demanderSource/demanderSource.action";
import { useConsole } from "../store";
import { Modale } from "./Modale";

const NIVEAUX = Object.entries(SCOPE_LEVELS as Record<string, string>);
export function ModaleDemande() {
  const c = useConsole();
  const flash = useFlash();
  const base = useId();
  const id = (k: keyof ChampsDemande) => `${base}-${k}`;
  const [ch, setCh] = useState<ChampsDemande>(CHAMPS_VIDES);
  const [msg, setMsg] = useState("");
  const [enCours, setEnCours] = useState(false);
  const poser = (k: keyof ChampsDemande) => (e: { target: { value: string } }) => setCh((x) => ({ ...x, [k]: e.target.value }));
  const envoyer = async () => {
    const r = construireDemande(ch);
    if ("erreur" in r) return setMsg(r.erreur);
    setEnCours(true);
    const res = await envoyerDemande(r.demande);
    setEnCours(false);
    if (!res.ok) return setMsg(res.erreur);
    c.fermerModale();
    flash("Demande envoyée à l'administrateur");
  };
  return (
    <Modale titre="Demander l'ajout d'une source" onClose={c.fermerModale}>
      <div className="cr-field"><label className="cr-lbl" htmlFor={id("name")}>Nom de la source *</label><input className="cr-in" value={ch.name} id={id("name")} onChange={poser("name")} placeholder="Ex. Chambre d'agriculture 17" /></div>
      <div className="cr-field"><label className="cr-lbl" htmlFor={id("url")}>Adresse (URL) *</label><input className="cr-in mono" value={ch.url} id={id("url")} onChange={poser("url")} placeholder="https://…" /></div>
      <div className="cr-field"><label className="cr-lbl" htmlFor={id("organisation")}>Organisation</label><input className="cr-in" value={ch.organisation} id={id("organisation")} onChange={poser("organisation")} placeholder="L'émetteur, ex. Mairie de La Rochelle" /></div>
      <div className="cr-row">
        <div className="cr-field md-demi"><label className="cr-lbl" htmlFor={id("sourceKind")}>Volet</label><select className="cr-sel" value={ch.sourceKind} id={id("sourceKind")} onChange={poser("sourceKind")}><option value="">Je ne sais pas</option><option value="public">Public</option><option value="private">Privé</option></select></div>
        <div className="cr-field md-demi"><label className="cr-lbl" htmlFor={id("type")}>Type</label><select className="cr-sel" value={ch.type} id={id("type")} onChange={poser("type")}><option value="">Je ne sais pas</option><option value="rss">Flux RSS</option><option value="article">Liste d&apos;articles</option><option value="site">Site web</option><option value="pdf">Document PDF</option></select></div>
      </div>
      <div className="cr-row">
        <div className="cr-field md-demi"><label className="cr-lbl" htmlFor={id("commune")}>Commune</label><input className="cr-in" value={ch.commune} id={id("commune")} onChange={poser("commune")} placeholder="Ex. Rochefort" /></div>
        <div className="cr-field md-demi"><label className="cr-lbl" htmlFor={id("scopeLevel")}>Niveau</label><select className="cr-sel" value={ch.scopeLevel} id={id("scopeLevel")} onChange={poser("scopeLevel")}><option value="">Je ne sais pas</option>{NIVEAUX.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div className="cr-field"><label className="cr-lbl" htmlFor={id("zone")}>Zone (département ou région)</label><input className="cr-in" list="tk-zone-list" value={ch.zone} id={id("zone")} onChange={poser("zone")} placeholder="Tapez « 17 » ou « Région · … »" />
        <datalist id="tk-zone-list">{(zoneChoices() as string[]).map((z) => <option key={z} value={z} />)}</datalist></div>
      <div className="cr-row">
        <div className="cr-field md-demi"><label className="cr-lbl" htmlFor={id("category")}>Rubrique</label><input className="cr-in" value={ch.category} id={id("category")} onChange={poser("category")} placeholder="Ex. Économie" /></div>
        <div className="cr-field md-demi"><label className="cr-lbl" htmlFor={id("frequency")}>Fréquence de publication</label><input className="cr-in" value={ch.frequency} id={id("frequency")} onChange={poser("frequency")} placeholder="Ex. hebdomadaire" /></div>
      </div>
      <div className="cr-field"><label className="cr-lbl" htmlFor={id("note")}>Note</label><textarea className="cr-in" rows={3} value={ch.note} id={id("note")} onChange={poser("note")} placeholder="Pourquoi cette source, type de contenu…" /></div>
      <p className="tk-msg md-erreur" aria-live="polite">{msg}</p>
      <p className="md-note">La demande arrive dans l&apos;onglet Tickets du back-office, à votre nom.</p>
      <div className="md-pied"><button className="cr-btn pub" type="button" onClick={envoyer} disabled={enCours}><Icone nom="Send" size={15} />Envoyer la demande</button></div>
    </Modale>
  );
}
