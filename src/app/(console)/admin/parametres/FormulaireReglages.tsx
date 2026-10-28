"use client";

// Onglet Paramètres, porté de settingsView() + zonesWidget() + siteIconCard().
// Toutes les valeurs sont dans un seul état : une section repliée garde ce
// qu'on y a saisi (M3-82). « Enregistrer » n'envoie que ce qui a changé, pour
// qu'un réglage jamais touché garde la valeur du moteur (M3-109, B2).

import { useRef, useState, useTransition, type ReactNode } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { ecrirePrefs, usePrefs } from "@/composants/prefs";
import { ConfirmationSurPlace, Etiquette } from "@/composants/primitives";
import {
  aideDe, basculerDept, basculerRegion, CONSEQUENCE_RETRAIT_ICONE, consequenceRetourDefaut, departementsCouverts, descriptionSpec,
  etatReglage, ICONE_ACCEPT, iconeTropLourde, libelleIcone, nomDepartement, regionsPourZones, sectionsAvecCles, texteDefaut, texteZones,
  valeursDe, valeursModifiees, zonesDepuisTexte, cleesRegleesIci,
  type Icone as IconeSite, type Spec, type Specs, type Valeurs,
} from "@/gererReglages/gererReglages.regles";
import { enregistrerIcone, enregistrerReglages, retirerIcone, revenirAuDefaut } from "@/gererReglages/gererReglages.action";

export function FormulaireReglages({ settings, specs, stored, icone: iconeInitiale }: { settings: Record<string, unknown>; specs: Specs; stored: string[]; icone: IconeSite | null }) {
  const flash = useFlash();
  const fichierIcone = useRef<HTMLInputElement>(null);
  const [valeurs, setValeurs] = useState<Valeurs>(() => valeursDe(settings, specs));
  /* Valeurs telles que lues au serveur : « Enregistrer » envoie l'écart. */
  const [initiales, setInitiales] = useState<Valeurs>(() => valeursDe(settings, specs));
  const [enBase, setReglees] = useState<ReadonlySet<string>>(() => new Set(stored));
  const reglees = cleesRegleesIci(enBase, initiales, specs);
  const repliees = new Set(usePrefs().settingsFolded || []);
  const [icone, setIcone] = useState<IconeSite | null>(iconeInitiale);
  const [enCours, lancer] = useTransition();

  const sections = sectionsAvecCles(specs);
  const poser = (k: string, v: string) => setValeurs((x) => ({ ...x, [k]: v }));
  /* Repliable (M3-82), mémorisé par poste. Le repli masque les lignes sans les
     démonter : une valeur saisie reste dans son état et part avec « Enregistrer ». */
  const replier = (id: string) => {
    const n = new Set(repliees);
    if (n.has(id)) n.delete(id); else n.add(id);
    ecrirePrefs({ settingsFolded: [...n] });
  };
  const enregistrer = () => lancer(async () => {
    const patch = valeursModifiees(valeurs, initiales);
    if (!Object.keys(patch).length) return flash("Aucune modification à enregistrer");
    const r = await enregistrerReglages(patch);
    if (!r.ok) return flash(r.erreur, true);
    const lues = valeursDe(r.data.settings, specs);
    setValeurs(lues); setInitiales(lues); setReglees(new Set(r.data.stored));
    flash("Paramètres enregistrés — si des seuils ont changé, « Recalculer les scores » dans l'onglet Dernier run");
  });
  /* Revenir au défaut : seule la valeur de ce réglage est remplacée, une saisie
     en cours ailleurs dans le formulaire est gardée. Un échec est rejeté, et
     ConfirmationSurPlace l'affiche à côté du bouton. */
  const remettre = async (k: string) => {
    const r = await revenirAuDefaut(k);
    if (!r.ok) throw new Error(r.erreur);
    const v = valeursDe(r.data.settings, specs)[k];
    setValeurs((x) => ({ ...x, [k]: v })); setInitiales((x) => ({ ...x, [k]: v })); setReglees(new Set(r.data.stored));
    flash(`${aideDe(k)?.label || k} : valeur par défaut rétablie`);
  };

  /* Recharge aussi l'icône de l'onglet courant : sinon l'administrateur ne
     verrait le résultat qu'en rechargeant la page. */
  const rafraichirOnglet = () => { const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (link) link.href = `/site-icon?t=${Date.now()}`; };
  const choisirIcone = (file: File | undefined) => {
    if (!file) return;
    const trop = iconeTropLourde(file.size);
    if (trop) return flash(trop, true);
    lancer(async () => {
      let dataUrl: string;
      try {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error("fichier illisible"));
          fr.readAsDataURL(file);
        });
      } catch (e) { return flash((e as Error).message, true); }
      const r = await enregistrerIcone(dataUrl);
      if (!r.ok) return flash(r.erreur, true);
      setIcone(r.data.icon); rafraichirOnglet(); flash("Icône du site enregistrée");
    });
  };
  const retirer = async () => {
    const r = await retirerIcone();
    if (!r.ok) throw new Error(r.erreur);
    setIcone(null); rafraichirOnglet(); flash("Icône du site retirée — le navigateur reprend la sienne");
  };

  return (
    <>
      <div className="bo-card"><h3>Paramètres <button className="bo-btn primary" type="button" onClick={enregistrer} disabled={enCours}><Icone nom="Check" size={13} />Enregistrer</button></h3>
        <div className="bo-scroll"><table className="bo-table bo-settings"><thead><tr><th>Réglage</th><th>Valeur</th><th>Valeurs admises</th></tr></thead><tbody>
          {sections.map((sec) => {
            const folded = repliees.has(sec.id);
            return (
              <SectionLignes key={sec.id} id={sec.id} title={sec.title} note={sec.note} n={sec.keys.length} folded={folded} onToggle={() => replier(sec.id)}>
                {sec.keys.map((k) => <LigneReglage key={k} k={k} spec={specs[k]} valeurs={valeurs} reglees={reglees} hidden={folded} onChange={poser} onReset={remettre} />)}
              </SectionLignes>
            );
          })}
        </tbody></table></div></div>

      <div className="bo-card"><h3>Icône du site</h3>
        <div className="bo-site-icon">
          {icone
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="bo-site-icon-prev" src={`/site-icon?v=${encodeURIComponent(icone.etag)}`} alt="Icône actuelle" width={48} height={48} />
            : <div className="bo-site-icon-prev bo-site-icon-none" aria-hidden="true">—</div>}
          <div>
            <div>{libelleIcone(icone)}</div>
            <div className="bo-actions mt-2">
              {/* Un vrai bouton, et non un <label> habillé en bouton : le champ fichier est
                  masqué et un <label> ne prend pas le focus, on ne l'atteignait pas au clavier. */}
              <button className="bo-btn primary" type="button" onClick={() => fichierIcone.current?.click()}><Icone nom="Image" size={13} />{icone ? "Changer l'icône" : "Choisir une icône"}</button>
              <input ref={fichierIcone} type="file" accept={ICONE_ACCEPT} hidden aria-label="Fichier de l'icône du site" onChange={(e) => { choisirIcone(e.target.files?.[0]); e.target.value = ""; }} />
              {icone && <ConfirmationSurPlace libelle="Retirer" icone="Trash" taille="petite" desactive={enCours}
                consequence={CONSEQUENCE_RETRAIT_ICONE} libelleConfirmer="Retirer l'icône" libelleEnCours="Retrait…" onConfirm={retirer} />}
            </div>
            <p className="bo-note mt-2">Onglet du navigateur et favoris, sur la console, le back-office et la page de connexion. PNG ou SVG carré conseillé (64 × 64 px ou plus), ICO, JPEG, WebP et GIF acceptés, 256 Ko au plus. Visible au prochain chargement de page.</p>
          </div>
        </div></div>
    </>
  );
}

function SectionLignes({ id, title, note, n, folded, onToggle, children }: { id: string; title: string; note?: string; n: number; folded: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      <tr className="bo-group bo-fold"><td colSpan={3}>
        <button className="bo-fold-btn" type="button" onClick={onToggle} aria-expanded={!folded} data-sec={id}>
          <span className="bo-fold-ic" aria-hidden="true">{folded ? "▸" : "▾"}</span><b>{title}</b> <span className="bo-note">{n} réglage{n > 1 ? "s" : ""}</span>
        </button>
        {note && <div className="bo-note" hidden={folded}>{note}</div>}
      </td></tr>
      {children}
    </>
  );
}

type PropsLigne = { k: string; spec: Spec; valeurs: Valeurs; reglees: ReadonlySet<string>; hidden: boolean; onChange: (k: string, v: string) => void; onReset: (k: string) => Promise<void> };

function LigneReglage({ k, spec, valeurs, reglees, hidden, onChange, onReset }: PropsLigne) {
  const help = aideDe(k);
  const id = `set-${k}`;
  const tete = (
    <td><label htmlFor={id}><b>{help ? help.label : k}</b></label> <span className="mono bo-note">{k}</span>
      {help && <div className="bo-note bo-help">{help.help}</div>}</td>
  );
  const origine = <OrigineReglage k={k} libelle={help ? help.label : k} spec={spec} reglees={reglees} onReset={onReset} />;
  if (spec.type === "zones") {
    return <tr hidden={hidden}>{tete}<td colSpan={2} className="bo-zones-cell"><ZonesCouvertes id={id} valeur={valeurs[k]} onChange={(v) => onChange(k, v)} />{origine}</td></tr>;
  }
  if (spec.type === "dept") {
    return (
      <tr hidden={hidden}>{tete}
        <td><select id={id} name={k} value={valeurs[k]} onChange={(e) => onChange(k, e.target.value)}><option value="">— aucun —</option>
          {departementsCouverts(valeurs).map((d) => <option key={d} value={d}>{d} · {nomDepartement(d)}</option>)}</select></td>
        <td className="bo-note">un département couvert<br />défaut : {texteDefaut(spec)}{origine}</td></tr>
    );
  }
  return (
    <tr hidden={hidden}>{tete}
      <td>{spec.values
        ? <select id={id} name={k} value={valeurs[k]} onChange={(e) => onChange(k, e.target.value)}>{spec.values.map((v) => <option key={v}>{v}</option>)}</select>
        : <input id={id} name={k} value={valeurs[k]} onChange={(e) => onChange(k, e.target.value)} />}</td>
      <td className="bo-note">{descriptionSpec(spec)}<br />défaut : {texteDefaut(spec)}{origine}</td></tr>
  );
}

/* « Réglé ici » ou « valeur par défaut » (M3-109, B2) ; un réglage posé ici peut
   revenir au défaut, confirmé sur place avec sa conséquence. */
function OrigineReglage({ k, libelle, spec, reglees, onReset }: { k: string; libelle: string; spec: Spec; reglees: ReadonlySet<string>; onReset: (k: string) => Promise<void> }) {
  const etat = etatReglage(k, reglees);
  return (
    <div className="bo-actions mt-2">
      <Etiquette ton={etat.regle ? "brand" : "neutre"}>{etat.libelle}</Etiquette>
      {etat.regle && <ConfirmationSurPlace libelle="Revenir au défaut" icone="RotateCcw" taille="petite" varianteDeclencheur="secondaire"
        consequence={consequenceRetourDefaut(libelle, spec)} libelleConfirmer="Revenir au défaut" libelleEnCours="Retour…" onConfirm={() => onReset(k)} />}
    </div>
  );
}

/* Zones couvertes (M3-74) : des cases par département, rangées par région. Les
   régions déjà couvertes viennent en tête, ouvertes ; les autres sont repliées. */
function ZonesCouvertes({ id, valeur, onChange }: { id: string; valeur: string; onChange: (v: string) => void }) {
  const sel = zonesDepuisTexte(valeur);
  const regions = regionsPourZones(sel);
  return (
    <>
      <input type="hidden" id={id} value={valeur} readOnly />
      <div className="bo-zones">{regions.map((r) => (
        <details key={r.code} className="bo-zone-reg" open={r.n > 0}>
          <summary><b>{r.nom}</b> <span className="bo-note">{r.n}/{r.depts.length}</span></summary>
          <div className="bo-zone-grid">
            <label className="bo-zone-all"><input type="checkbox" checked={r.toute} onChange={(e) => onChange(texteZones(basculerRegion(sel, r.code, e.target.checked)))} /> Toute la région</label>
            {r.depts.map((d) => <label key={d.code} className="bo-zone-dept"><input type="checkbox" checked={sel.has(d.code)} onChange={(e) => onChange(texteZones(basculerDept(sel, d.code, e.target.checked)))} /> <span><span className="mono">{d.code}</span> {d.nom}</span></label>)}
          </div>
        </details>
      ))}</div>
    </>
  );
}
