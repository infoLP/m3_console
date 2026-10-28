"use client";

// Onglet LLM — prompts de génération (M3-56), rendu explicite par M3-111 :
// fil d'héritage de la portée, légende des variables (rôle, exemple,
// indispensable), aperçu à côté du texte, valeurs des variables surlignées.
// Un prompt général, et des surcharges par moteur ou par modèle. Chaque
// enregistrement est une nouvelle version (historique en base, ajout seul).
// La liste des variables est fermée et le format de sortie verrouillé : la
// validation est celle du serveur (src/llm/prompts/template.js), montrée ici
// avant l'enregistrement, refaite là-bas de toute façon.

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import {
  baliserPourApercu, ciblesPrompts, erreursPrompt, etatCible, famillesVariables, filHeritage, insererVariable,
  modelesPourSurcharge, segmentsApercu, texteInitial,
  type CiblePrompt, type EtatMaillon, type Moteur, type PromptsLLM, type VersionPrompt,
} from "@/gererMoteursIA/gererMoteursIA.regles";
import { apercuPrompt, enregistrerPrompt, historiquePrompt, restaurerPrompt, supprimerPrompt } from "@/gererMoteursIA/gererMoteursIA.action";
import { ConfirmationSurPlace, Etiquette } from "@/composants/primitives";

const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("fr-FR") : "");

/* Bloc de texte préformaté, lisible et borné en hauteur (classes Tailwind du @theme : 90 × 4 px = 360 px, 2 × 4 px = 8 px). */
const PRE = "m-0 mt-2 max-h-90 flex-[1_1_100%] overflow-auto whitespace-pre-wrap";

const ETAT_MAILLON: Record<EtatMaillon, { texte: string; ton: "go" | "neutre" | "amber" }> = {
  en_vigueur: { texte: "en vigueur", ton: "go" },
  masque: { texte: "remplacé", ton: "neutre" },
  ignore: { texte: "invalide, sauté", ton: "amber" },
  vide: { texte: "aucun texte", ton: "neutre" },
};

export function PromptsGeneration({ data, moteurs }: { data: PromptsLLM | null; moteurs: Moteur[] }) {
  if (!data) {
    return (
      <div className="bo-card">
        <div className="bo-card-h"><h3>Prompts de génération</h3></div>
        <div className="llm-state warn"><Icone nom="Shield" size={14} /> Prompts illisibles (base injoignable, ou migration 017 non appliquée) : la génération utilise le prompt par défaut du code.</div>
      </div>
    );
  }
  return <Editeur data={data} moteurs={moteurs} />;
}

function Editeur({ data, moteurs }: { data: PromptsLLM; moteurs: Moteur[] }) {
  const flash = useFlash();
  const router = useRouter();
  const [enCours, lancer] = useTransition();
  const zone = useRef<HTMLTextAreaElement>(null);

  const [ajouts, setAjouts] = useState<{ providerId: string; model: string }[]>([]);
  const cibles = ciblesPrompts(data, moteurs, ajouts);
  const [cle, setCle] = useState(cibles[0].cle);
  const cible: CiblePrompt = cibles.find((c) => c.cle === cle) || cibles[0];

  const [brouillons, setBrouillons] = useState<Record<string, string>>({});
  const initial = texteInitial(cible, data);
  const texte = brouillons[cible.cle] ?? initial;
  const modifie = texte !== initial || !cible.courant;
  const erreurs = erreursPrompt(texte);
  const [erreursServeur, setErreursServeur] = useState<string[]>([]);

  /* `source` : le texte envoyé à l'aperçu, pour signaler un aperçu périmé. */
  const [apercu, setApercu] = useState<{ cle: string; text: string; source: string } | null>(null);
  const [historique, setHistorique] = useState<{ cle: string; rows: VersionPrompt[] } | null>(null);

  /* Nouvelle surcharge de modèle : moteur + identifiant du modèle. */
  const [nvMoteur, setNvMoteur] = useState(moteurs[0]?.id || "");
  const [nvModele, setNvModele] = useState("");
  const moteurNv = moteurs.find((p) => p.id === nvMoteur);

  const ecrire = (t: string) => { setBrouillons((b) => ({ ...b, [cible.cle]: t })); setErreursServeur([]); };
  const choisir = (c: string) => { setCle(c); setApercu(null); setHistorique(null); setErreursServeur([]); };

  const inserer = (nom: string) => {
    const el = zone.current;
    const r = insererVariable(texte, el?.selectionStart ?? texte.length, el?.selectionEnd ?? texte.length, nom);
    ecrire(r.texte);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(r.curseur, r.curseur); } });
  };

  const apresEcriture = (rows: VersionPrompt[]) => {
    setBrouillons((b) => { const n = { ...b }; delete n[cible.cle]; return n; });
    if (historique?.cle === cible.cle) setHistorique({ cle: cible.cle, rows });
    setErreursServeur([]);
    router.refresh();
  };

  const enregistrer = () => lancer(async () => {
    const r = await enregistrerPrompt(cible.providerId, cible.model, texte);
    if (!r.ok) { setErreursServeur(r.erreurs); return flash(r.erreur, true); }
    apresEcriture(r.data.history);
    flash(`${cible.libelle} : version ${r.data.history.length} enregistrée`);
  });
  /* Destructif confirmé sur place, conséquence écrite (M3-99, B4) : un échec
     lève, et ConfirmationSurPlace l'affiche en alerte sans refermer. */
  const supprimer = async () => {
    const r = await supprimerPrompt(cible.providerId, cible.model);
    if (!r.ok) throw new Error(r.erreur);
    apresEcriture(r.data.history);
    flash(cible.portee === "general" ? "Prompt général remis au défaut du code" : "Surcharge supprimée : le niveau supérieur s'applique");
  };
  const restaurer = async (v: VersionPrompt) => {
    const r = await restaurerPrompt(v.id);
    if (!r.ok) { setErreursServeur(r.erreurs); throw new Error(r.erreur); }
    apresEcriture(r.data.history);
    flash(`Version ${v.version} restaurée (nouvelle version ${r.data.history.length})`);
  };
  const voirHistorique = () => {
    if (historique?.cle === cible.cle) return setHistorique(null);
    lancer(async () => {
      const r = await historiquePrompt(cible.providerId, cible.model);
      if (!r.ok) return flash(r.erreur, true);
      setHistorique({ cle: cible.cle, rows: r.data.history });
    });
  };
  const voirApercu = () => lancer(async () => {
    const r = await apercuPrompt(baliserPourApercu(texte));
    if (!r.ok) return flash(r.erreur, true);
    setApercu({ cle: cible.cle, text: r.data.text, source: texte });
  });
  const ajouterModele = () => {
    const m = nvModele.trim();
    if (!nvMoteur || !m) return;
    setAjouts((a) => [...a, { providerId: nvMoteur, model: m }]);
    setNvModele("");
    choisir(JSON.stringify([nvMoteur, m]));
  };

  const listeErreurs = erreursServeur.length ? erreursServeur : erreurs;
  const fil = filHeritage(cible, data, moteurs);
  const familles = famillesVariables(data.variables);
  const apercuVisible = apercu?.cle === cible.cle ? apercu : null;
  const idZone = "llm-prompt-texte";
  const idErreurs = "llm-prompt-erreurs";
  return (
    <div className="bo-card">
      <div className="bo-card-h"><h3>Prompts de génération</h3></div>
      <p className="bo-note">Le prompt envoyé au moteur pour rédiger un article. Il se règle à trois niveaux, le <b>prompt général</b>, celui d&apos;un <b>moteur</b> et celui d&apos;un seul <b>modèle</b> : le plus précis l&apos;emporte. Les chiffres (longueurs, nombre d&apos;intertitres…) ne s&apos;écrivent pas en dur : ce sont des <b>variables</b>, remplacées par le code à chaque génération. Chaque enregistrement est une nouvelle version.</p>

      <div className="llm-field"><label htmlFor="llm-prompt-portee">Portée</label>
        <select id="llm-prompt-portee" className="bo-in" value={cible.cle} onChange={(e) => choisir(e.target.value)}>
          {cibles.map((c) => <option key={c.cle} value={c.cle}>{c.libelle}{c.courant ? " — surchargé" : ""}</option>)}
        </select>
      </div>
      <div className="llm-prompt-bloc">
        <ol className="llm-prompt-fil" aria-label="Ordre de priorité pour cette portée, du plus précis au défaut du code">
          {fil.map((m) => (
            <li key={m.portee} className={`llm-prompt-maillon ${m.etat}`} aria-current={m.etat === "en_vigueur" ? "true" : undefined}>
              <span>{m.libelle}</span> <Etiquette ton={ETAT_MAILLON[m.etat].ton}>{ETAT_MAILLON[m.etat].texte}</Etiquette>
            </li>
          ))}
        </ol>
        <p className="llm-prompt-aide">{etatCible(cible, data).replace(/\.$/, "")}{cible.courant?.createdAt ? ` · ${date(cible.courant.createdAt)}` : ""}. La génération lit cette chaîne dans l&apos;ordre et prend le premier texte valide.</p>
      </div>
      {moteurs.length > 0 && (
        <details className="llm-prompt-replie">
          <summary>Ajouter un prompt propre à un modèle</summary>
          <p className="llm-prompt-aide">À réserver à un modèle qui suit mal le prompt de son moteur (consignes ignorées, longueurs non tenues). Sinon, modifier le prompt du moteur ou le prompt général : chaque surcharge est un texte de plus à tenir à jour.</p>
          <div className="llm-field"><label htmlFor="llm-prompt-nv-modele">Modèle</label>
          <select aria-label="Moteur de la nouvelle surcharge" className="bo-in" value={nvMoteur} onChange={(e) => setNvMoteur(e.target.value)}>
            {moteurs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input id="llm-prompt-nv-modele" className="bo-in mono" list="llm-prompt-modeles" placeholder="identifiant du modèle" value={nvModele} onChange={(e) => setNvModele(e.target.value)} />
          <datalist id="llm-prompt-modeles">{moteurNv ? modelesPourSurcharge(moteurNv).map((m) => <option key={m} value={m} />) : null}</datalist>
          <button className="bo-btn" type="button" onClick={ajouterModele} disabled={!nvMoteur || !nvModele.trim()}><Icone nom="Plus" size={13} />Ajouter</button>
          </div>
        </details>
      )}

      <div className="llm-sep">Texte du prompt — {cible.libelle}</div>
      <div className={`llm-prompt-duo${apercuVisible ? " avec-apercu" : ""}`}>
        <div className="llm-prompt-col">
          <label htmlFor={idZone} className="llm-prompt-titre-col">Texte, avec ses variables</label>
          <textarea id={idZone} ref={zone} className="bo-in mono w-full resize-y" rows={20} spellCheck={false}
            value={texte} onChange={(e) => ecrire(e.target.value)} aria-invalid={listeErreurs.length > 0} aria-describedby={idErreurs} maxLength={data.maxLength} />
          <div id={idErreurs} role="status" aria-live="polite">
            {listeErreurs.length > 0
              ? <div className="llm-prompt-aide warn"><b>À corriger avant d&apos;enregistrer :</b><ul>{listeErreurs.map((e) => <li key={e}>{e}</li>)}</ul></div>
              : modifie && <div className="llm-prompt-aide">Modèle valide.</div>}
          </div>
        </div>
        {apercuVisible && (
          <div className="llm-prompt-col">
            <div className="llm-prompt-titre-col">Aperçu — article d&apos;exemple, réglages actuels, aucun appel au LLM</div>
            <pre className="llm-hint llm-prompt-apercu" tabIndex={0} aria-label="Aperçu du prompt rendu">
              {segmentsApercu(apercuVisible.text).map((g, i) => g.variable
                ? <mark key={i} className="llm-prompt-valeur" title={`{{${g.variable}}}`}>{g.texte}</mark>
                : g.texte)}
            </pre>
            <p className="llm-prompt-aide">Surligné : ce que chaque variable est devenue (survoler pour voir son nom). Le format de sortie verrouillé termine le texte.{apercuVisible.source !== texte ? " Le texte a changé depuis cet aperçu : le rafraîchir." : ""}</p>
          </div>
        )}
      </div>

      <section className="llm-prompt-legende" aria-labelledby="llm-prompt-legende-titre">
        <h4 id="llm-prompt-legende-titre">Variables</h4>
        <p className="llm-prompt-aide">Une variable s&apos;écrit <code>{"{{nom}}"}</code> ; à chaque génération, le code la remplace par sa valeur. Le bouton « + » l&apos;insère à la position du curseur. Une variable <Etiquette ton="amber">indispensable</Etiquette> doit figurer dans le texte, sinon l&apos;enregistrement est refusé. Les exemples sont les valeurs pour l&apos;article d&apos;exemple de l&apos;aperçu.</p>
        {familles.map((f) => (
          <div key={f.titre} className="llm-prompt-famille">
            <h5>{f.titre}</h5>
            {f.aide && <p className="llm-prompt-aide">{f.aide}</p>}
            <ul className="llm-prompt-vars">
              {f.variables.map((v) => (
                <li key={v.nom} className="llm-prompt-var">
                  <div className="llm-prompt-var-h">
                    <button type="button" className="bo-btn" onClick={() => inserer(v.nom)} aria-label={`Insérer {{${v.nom}}} à la position du curseur`}>
                      <Icone nom="Plus" size={12} /><code>{`{{${v.nom}}}`}</code>
                    </button>
                    {v.requise ? <Etiquette ton="amber">indispensable</Etiquette> : null}
                  </div>
                  <p className="llm-prompt-desc">{v.description}</p>
                  <p className="llm-prompt-ex"><span>Exemple :</span> {v.exemple ? <code>{v.exemple}</code> : <i>vide pour cet article</i>}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="llm-actions">
        <button className="bo-btn primary" type="button" onClick={enregistrer} disabled={enCours || erreurs.length > 0 || !modifie}><Icone nom="Check" size={13} />Enregistrer</button>
        <button className="bo-btn" type="button" onClick={voirApercu} disabled={enCours}><Icone nom="FileText" size={13} />{apercuVisible ? "Rafraîchir l’aperçu" : "Aperçu à côté du texte"}</button>
        <button className="bo-btn" type="button" onClick={voirHistorique} disabled={enCours} aria-expanded={historique?.cle === cible.cle}><Icone nom="Clock" size={13} />Historique</button>
        {brouillons[cible.cle] !== undefined && <button className="bo-btn" type="button" onClick={() => { setBrouillons((b) => { const n = { ...b }; delete n[cible.cle]; return n; }); setErreursServeur([]); }}><Icone nom="RotateCcw" size={13} />Annuler les modifications</button>}
        {cible.portee === "general"
          ? <button className="bo-btn" type="button" onClick={() => ecrire(data.defaultTemplate)} disabled={enCours || texte === data.defaultTemplate}><Icone nom="RotateCcw" size={13} />Repartir du défaut du code</button>
          : null}
        {cible.courant && (
          <ConfirmationSurPlace
            key={`suppr-${cible.cle}`}
            libelle={cible.portee === "general" ? "Revenir au défaut du code" : "Supprimer la surcharge"}
            icone="Trash"
            consequence={cible.portee === "general"
              ? "Le prompt général reprendra le texte par défaut du code dès la prochaine génération. L'historique des versions est conservé."
              : `La surcharge « ${cible.libelle} » est retirée : le niveau supérieur (moteur ou prompt général) s'appliquera dès la prochaine génération. L'historique des versions est conservé.`}
            libelleConfirmer={cible.portee === "general" ? "Revenir au défaut" : "Supprimer"}
            onConfirm={supprimer}
            desactive={enCours}
          />
        )}
      </div>

      {historique?.cle === cible.cle && (
        <>
          <div className="llm-sep">Historique — {cible.libelle}</div>
          {historique.rows.length === 0
            ? <div className="llm-note">Aucune version enregistrée.</div>
            : <ul className="llm-list" aria-label="Versions">
                {historique.rows.map((v, i) => (
                  <li key={v.id} className="llm-field">
                    <span className="llm-kind">Version {v.version} · {date(v.createdAt)} · {v.createdBy || "auteur inconnu"}{v.template == null ? " · surcharge supprimée" : ""}{i === 0 ? " · en vigueur" : ""}</span>
                    {i > 0 && (
                      <ConfirmationSurPlace
                        libelle={v.template == null ? "Revenir à cet état" : "Restaurer"}
                        icone="RotateCcw"
                        varianteDeclencheur="secondaire"
                        consequence={v.template == null
                          ? `La surcharge sera de nouveau supprimée, comme en version ${v.version} : le niveau supérieur s'appliquera dès la prochaine génération.`
                          : `La version ${v.version} redevient le prompt en vigueur (enregistrée comme nouvelle version) et s'appliquera dès la prochaine génération.`}
                        libelleConfirmer="Restaurer"
                        onConfirm={() => restaurer(v)}
                        desactive={enCours}
                      />
                    )}
                  </li>
                ))}
              </ul>}
        </>
      )}

      <details className="llm-prompt-replie">
        <summary>Format de sortie — ajouté automatiquement à la fin, verrouillé</summary>
        <p className="llm-prompt-aide">Le code l&apos;ajoute après tout prompt, général ou surchargé : il ne se modifie pas ici, et un prompt qui tente de le redéfinir est refusé.</p>
        <pre className={`llm-hint ${PRE}`} tabIndex={0} aria-label="Format de sortie verrouillé">{data.outputFormat}</pre>
      </details>
    </div>
  );
}
