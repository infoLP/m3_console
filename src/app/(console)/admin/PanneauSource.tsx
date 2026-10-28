"use client";

// Panneau d'édition d'une source (M3-110, B5), sur le Tiroir du socle. Tous les
// champs qu'éditait autrefois la ligne du tableau ; chaque saisie modifie la
// source EN LOCAL et la marque modifiée — rien ne part au serveur avant
// « Enregistrer (N) », qui remplace toute la table comme avant.
// En plus : l'état de récolte et la fiabilité en clair, « Tester la source »
// (résultat en ligne) et la suppression confirmée sur place (B4).

import { useState, type ChangeEvent } from "react";
import { Bouton, Champ, ConfirmationSurPlace, Etiquette, Message, Tiroir } from "@/composants/primitives";
import { SOURCE_TYPES } from "@shared/sources.js";
import { SCOPE_LEVELS } from "@shared/zones.js";
import {
  affichageFiabilite, consequenceSuppression, etatRecolte, indiceIntervalle, resumeTest, texteZone, urlDe,
  type Fiabilite, type ResultatTest, type Source,
} from "@/gererSources/gererSources.regles";

const NIVEAUX = Object.entries(SCOPE_LEVELS as Record<string, string>);
const TYPES = SOURCE_TYPES as string[];

/* Où en est le test d'une source : en cours, résultat, ou erreur d'appel
   (réseau, 409 « un test est déjà en cours »…). */
export type EtatTest = { enCours: true } | { enCours: false; resultat: ResultatTest } | { enCours: false; erreur: string };

export function PanneauSource({ s, f, maintenant, modifiee, enregistree, idZones, test, testOccupe, onChange, onBlurOrg, onTest, onSupprimer, onFermer }: {
  s: Source; f: Fiabilite | undefined; maintenant: number; modifiee: boolean; enregistree: boolean; idZones: string;
  test: EtatTest | undefined; testOccupe: boolean;
  onChange: (id: string, champ: string, valeur: string | boolean) => boolean;
  onBlurOrg: (id: string) => void; onTest: (id: string) => void; onSupprimer: (id: string) => void; onFermer: () => void;
}) {
  /* Le texte de la zone est libre pendant la frappe ; dès que la zone retenue
     change (saisie valide, ou pré-remplissage par commune), le champ suit. */
  const cleZone = `${s.dept || ""}|${s.region || ""}`;
  const [zone, setZone] = useState({ cle: cleZone, texte: texteZone(s), invalide: false });
  if (zone.cle !== cleZone) setZone({ cle: cleZone, texte: texteZone(s), invalide: false });
  const iv = indiceIntervalle(s);
  const fia = affichageFiabilite(f);
  const rec = etatRecolte(f, maintenant);
  const champ = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { onChange(s.id, k, e.target.value); };
  const fermer = () => { onBlurOrg(s.id); onFermer(); };

  return (
    <Tiroir ouvert onFermer={fermer} libelleFermer="Fermer le panneau de la source"
      titre={<>{s.name || "Source sans nom"}{modifiee && <> <Etiquette ton="brand">modifiée</Etiquette></>}</>}
      pied={<Bouton variante="primaire" onClick={fermer}>Terminé</Bouton>}>
      <div className="bo-panneau">
        <p className="bo-note">Les modifications restent locales : « Enregistrer » en haut de l&apos;onglet les envoie toutes ensemble.</p>

        <section className="bo-panneau-section" aria-labelledby="bo-p-ident">
          <h3 id="bo-p-ident" className="bo-panneau-titre">Identité</h3>
          <Champ libelle="Nom" name="name" value={s.name} onChange={champ("name")} />
          <Champ libelle="Organisation" name="organisation" value={s.organisation || ""} placeholder="—"
            aide="L'émetteur : regroupe par exemple le magazine, les communiqués et les documents d'une même mairie."
            onChange={champ("organisation")} onBlur={() => onBlurOrg(s.id)} />
          <div className="bo-panneau-ligne">
            <Champ libelle="Volet">
              <select name="kind" value={s.kind || "public"} onChange={champ("kind")}><option value="public">public</option><option value="private">privé</option></select>
            </Champ>
            <Champ libelle="Type">
              <select name="type" value={s.type} onChange={champ("type")}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </Champ>
            <Champ libelle="Priorité" name="priority" value={s.priority || ""} onChange={champ("priority")} classeChamp="bo-panneau-court" />
          </div>
          <label className="bo-check"><input type="checkbox" name="active" checked={!!s.active} onChange={(e) => onChange(s.id, "active", e.target.checked)} /> Active (récoltée)</label>
        </section>

        <section className="bo-panneau-section" aria-labelledby="bo-p-recolte">
          <h3 id="bo-p-recolte" className="bo-panneau-titre">Récolte</h3>
          <Champ libelle="URL récupérée" name="url" className="mono" value={urlDe(s)} onChange={champ("url")} placeholder="https://…" inputMode="url" />
          <Champ libelle="Sélecteur CSS" name="selector" className="mono" value={s.selector || ""} onChange={champ("selector")} placeholder="a.article (option)" />
          <Champ libelle="Intervalle (jours)" name="intervalDays" inputMode="numeric" value={String(s.intervalDays ?? "")} placeholder={iv.hint}
            aide={`Au plus une récolte planifiée tous les N jours ; vide = déduit de la fréquence, 0 = à chaque récolte. ${iv.title}.`}
            onChange={champ("intervalDays")} classeChamp="bo-panneau-court" />
        </section>

        <section className="bo-panneau-section" aria-labelledby="bo-p-zone">
          <h3 id="bo-p-zone" className="bo-panneau-titre">Rattachement</h3>
          <div className="bo-panneau-ligne">
            <Champ libelle="Commune" name="commune" value={s.commune || ""} onChange={champ("commune")} />
            <Champ libelle="Niveau" aide="Commune ou département : l'article prend ce département si son contenu ne cite aucun lieu. Région : la portée régionale. Nationale : seul le contenu le situe.">
              <select name="scopeLevel" value={s.scopeLevel || ""} onChange={champ("scopeLevel")}><option value="">—</option>{NIVEAUX.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Champ>
          </div>
          <Champ libelle="Zone" name="zone" list={idZones} value={zone.texte} placeholder="—"
            aide="Département (« 17 · Charente-Maritime ») ou région (« Région · Nouvelle-Aquitaine »). Tapez quelques lettres pour choisir."
            erreur={zone.invalide ? "Zone non reconnue : choisissez un département ou une région de la liste. La zone précédente est conservée." : undefined}
            onChange={(e) => { const invalide = onChange(s.id, "zone", e.target.value); setZone((z) => ({ ...z, texte: e.target.value, invalide })); }} />
        </section>

        <section className="bo-panneau-section" aria-labelledby="bo-p-diag">
          <h3 id="bo-p-diag" className="bo-panneau-titre">Diagnostic</h3>
          <dl className="bo-panneau-dl">
            <dt>Dernière récolte</dt>
            <dd><Etiquette ton={rec.ton}>{rec.texte}</Etiquette>{rec.date && <span className="bo-note"> · {rec.date}</span>}<br /><span className="bo-note">{rec.titre}</span></dd>
            <dt>Fiabilité</dt>
            <dd><span className="bo-pre">{fia.titre}</span></dd>
          </dl>
          <div className="bo-panneau-actions">
            <Bouton icone="Gauge" chargement={test?.enCours} disabled={testOccupe || !enregistree} onClick={() => onTest(s.id)}
              aria-describedby={!enregistree ? "bo-p-test-aide" : undefined}>
              {test?.enCours ? "Test en cours…" : "Tester la source"}
            </Bouton>
            {!enregistree && <span id="bo-p-test-aide" className="bo-note">Enregistrez d&apos;abord la source pour la tester.</span>}
            {enregistree && modifiee && <span className="bo-note">Le test porte sur la version enregistrée.</span>}
          </div>
          {/* Région live présente dès l'ouverture : le résultat qui y naît est annoncé. */}
          <div aria-live="polite">{test && !test.enCours && <ResultatDuTest t={test} />}</div>
        </section>

        <section className="bo-panneau-section bo-panneau-danger" aria-labelledby="bo-p-suppr">
          <h3 id="bo-p-suppr" className="bo-panneau-titre">Supprimer</h3>
          <ConfirmationSurPlace libelle="Supprimer la source" icone="Trash" libelleConfirmer="Supprimer"
            consequence={consequenceSuppression(f, enregistree)} onConfirm={() => onSupprimer(s.id)} />
        </section>
      </div>
    </Tiroir>
  );
}

function ResultatDuTest({ t }: { t: EtatTest }) {
  if (t.enCours) return null;
  if ("erreur" in t) return <Message ton="erreur" titre="Le test n'a pas pu être lancé">{t.erreur}</Message>;
  const r = resumeTest(t.resultat);
  return (
    <Message ton={r.ton} titre={r.titre}>
      {r.details.map((d) => <p key={d}>{d}</p>)}
      {r.exemples.length > 0 && (
        <>
          <p>Exemples :</p>
          <ul className="bo-panneau-exemples">{r.exemples.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
    </Message>
  );
}
