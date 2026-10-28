"use client";

// Onglet Sources (M3-110, lot 4 de M3-99). La table est en LECTURE (B5) : nom,
// volet, type, dernière récolte, zone, fréquence, fiabilité, active ; un clic
// (ou Entrée sur le nom) ouvre PanneauSource, où se font toutes les saisies.
// Les modifications restent locales jusqu'à « Enregistrer (N) », qui remplace
// toute la table (contrat inchangé). Filtres et recherche vivent dans l'URL
// (B3) ; suppression et restauration se confirment sur place (B4).

import { memo, useEffect, useMemo, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { Bouton, ConfirmationSurPlace, Etiquette, Message } from "@/composants/primitives";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { zoneChoices } from "@shared/zones.js";
import {
  affichageFiabilite, CAUSES, compterProblemes, compteurs, CONSEQUENCE_RESTAURATION, decouperSurlignage, effacerFiltres, etatRecolte,
  figerOrganisation, filtreActif, filtrerSources, filtresVersUrl, frequenceAffichee, groupes, LIBELLE_CAUSE, nouvelleSource,
  proposerOrganisations, proposerZones, regionsPourFiltre, sansZoneAvecCommune, texteZone, TOUS_PROBLEMES, appliquerChamp,
  type Fiabilite, type Filtres, type Source, type TonFiabilite,
} from "@/gererSources/gererSources.regles";
import { enregistrerSources, resoudreCommunes, restaurerReferentiel, testerSource } from "@/gererSources/gererSources.action";
import { marquerCandidatAjoute } from "@/gererConcurrents/gererConcurrents.action";
import { marquesCandidat } from "@/gererConcurrents/gererConcurrents.regles";
import { PanneauSource, type EtatTest } from "./PanneauSource";
import { FurtifSources } from "./FurtifSources";

const ID_ZONES = "bo-zone-list";
const NB_COLONNES = 8;
const TON_FIA: Record<TonFiabilite, "go" | "amber" | "stop" | "neutre"> = { on: "go", warn: "amber", bad: "stop", off: "neutre" };

/* `fiabilite` : lecture seule, par id, tenue hors de l'état des lignes — rien
   de ce qui est enregistré ne la contient. `maintenant` : fixé par la page. */
export function TableauSources({ initiales, fiabilite, brouillon, messageBrouillon, filtresInitiaux, maintenant }: {
  initiales: Source[]; fiabilite: Record<string, Fiabilite>; brouillon: Source | null; messageBrouillon: string | null;
  filtresInitiaux: Filtres; maintenant: number;
}) {
  const flash = useFlash();
  /* Source pré-remplie depuis une demande (onglet Tickets) : proposée en tête,
     déjà « modifiée », pas enregistrée, panneau ouvert — comme « Ajouter ». */
  const [sources, setSources] = useState<Source[]>(() => (brouillon ? [brouillon, ...initiales] : initiales));
  const [enregistrees, setEnregistrees] = useState<Set<string>>(() => new Set(initiales.map((s) => s.id)));
  const [dirty, setDirty] = useState<Set<string>>(() => new Set(brouillon ? [brouillon.id] : []));
  const [removed, setRemoved] = useState(false);
  const [filtres, setFiltres] = useState<Filtres>(filtresInitiaux);
  const [ouverte, setOuverte] = useState<string | null>(brouillon ? brouillon.id : null);
  const [tests, setTests] = useState<Record<string, EtatTest>>({});
  const [enCours, lancer] = useTransition();

  useEffect(() => { if (messageBrouillon) flash(messageBrouillon, !brouillon); }, [messageBrouillon, brouillon, flash]);

  /* B3 : l'URL suit les filtres. history.replaceState plutôt que router.replace :
     même effet visible (pas de nouvelle entrée d'historique, pas de
     rechargement), synchronisé avec le routeur de Next, mais sans relancer le
     rendu serveur de la page — donc sans relire 400 sources à chaque frappe. */
  useEffect(() => {
    const avant = new URLSearchParams(window.location.search);
    const apres = filtresVersUrl(filtres, avant).toString();
    if (apres === avant.toString()) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${apres ? `?${apres}` : ""}`);
  }, [filtres]);

  const ctx = useMemo(() => ({ fiabilite, maintenant }), [fiabilite, maintenant]);
  const marquer = (ids: string[]) => setDirty((d) => { const n = new Set(d); ids.forEach((i) => n.add(i)); return n; });
  const modifier = (id: string, champ: string, valeur: string | boolean): boolean => {
    let invalide = false;
    setSources((l) => l.map((s) => {
      if (s.id !== id) return s;
      const r = appliquerChamp(s, champ, valeur);
      invalide = !!r.invalide;
      return r.source;
    }));
    if (!invalide) marquer([id]);
    return invalide;
  };
  const figer = (id: string) => setSources((l) => l.map((s) => (s.id === id ? figerOrganisation(s) : s)));
  const changer = (p: Partial<Filtres>) => setFiltres((f) => ({ ...f, ...p }));

  const lignes = useMemo(() => filtrerSources(sources, filtres, ctx), [sources, filtres, ctx]);
  const zones = useMemo(() => regionsPourFiltre(sources), [sources]);
  const pb = useMemo(() => compterProblemes(sources, ctx), [sources, ctx]);
  const c = compteurs(sources);
  const canSave = dirty.size > 0 || removed;
  const hiddenInactive = filtres.activeOnly ? sources.filter((s) => !s.active).length : 0;
  const actif = filtreActif(filtres);
  const source = ouverte ? sources.find((s) => s.id === ouverte) : undefined;
  const testOccupe = Object.values(tests).some((t) => t.enCours);

  const remplacerTout = (liste: Source[]) => {
    setSources(liste); setEnregistrees(new Set(liste.map((s) => s.id))); setDirty(new Set()); setRemoved(false);
  };
  const enregistrer = () => lancer(async () => {
    /* M3-122 : une source ouverte depuis un domaine candidat le fait passer à
       « ajouté », une fois enregistrée — pas avant. */
    const { ids, propres } = marquesCandidat(sources);
    const r = await enregistrerSources(propres);
    if (!r.ok) return flash(r.erreur, true);
    remplacerTout(r.data.sources);
    const marques = await Promise.all(ids.map((id) => marquerCandidatAjoute(id)));
    const echec = marques.find((m) => !m.ok);
    if (echec && !echec.ok) return flash(`Sources enregistrées, mais le domaine candidat n'a pas pu passer à « ajouté » : ${echec.erreur}`, true);
    flash(ids.length ? "Sources enregistrées ; le domaine candidat est marqué « ajouté »" : "Sources enregistrées");
  });
  const ajouter = () => {
    const s = nouvelleSource(filtres.kind);
    setSources((l) => [s, ...l]); marquer([s.id]);
    changer({ q: "", activeOnly: false, probleme: "" });
    setOuverte(s.id);
  };
  const preRemplirOrganisations = () => {
    const r = proposerOrganisations(sources);
    setSources(r.sources); marquer(r.ids);
    flash(r.ids.length
      ? `${r.ids.length} source(s) pré-remplie(s) par domaine — relisez leur organisation, puis « Enregistrer »`
      : "Aucune proposition : pas de source sans organisation partageant un domaine");
  };
  const preRemplirZones = () => lancer(async () => {
    const todo = sansZoneAvecCommune(sources);
    if (!todo.length) return flash("Aucune source avec une commune et sans zone");
    const r = await resoudreCommunes([...new Set(todo.map((s) => s.commune!))]);
    if (!r.ok) return flash(r.erreur, true);
    const p = proposerZones(sources, r.data.communes);
    setSources(p.sources); marquer(p.ids);
    flash(`${p.filled} source(s) pré-remplie(s) — relisez leur niveau et leur zone, puis « Enregistrer »`
      + (p.left.length ? `. Non trouvées : ${p.left.slice(0, 8).join(", ")}${p.left.length > 8 ? "…" : ""}` : ""), !p.filled);
  });
  const supprimer = (id: string) => {
    setOuverte(null);
    setSources((l) => l.filter((x) => x.id !== id));
    setDirty((d) => { const n = new Set(d); n.delete(id); return n; });
    if (enregistrees.has(id)) setRemoved(true);
    flash("Source retirée — « Enregistrer » pour confirmer");
  };
  /* Erreur levée : ConfirmationSurPlace l'affiche sur place et reste ouverte. */
  const restaurer = async () => {
    const r = await restaurerReferentiel();
    if (!r.ok) throw new Error(r.erreur);
    setOuverte(null);
    remplacerTout(r.data.sources);
    flash(`${r.data.total} sources restaurées (${r.data.active} actives)`);
  };
  /* Un test à la fois : le bouton est désactivé tant qu'un appel tourne. */
  const tester = async (id: string) => {
    if (testOccupe) return;
    setTests((t) => ({ ...t, [id]: { enCours: true } }));
    const r = await testerSource(id);
    setTests((t) => ({ ...t, [id]: r.ok ? { enCours: false, resultat: r.data } : { enCours: false, erreur: r.erreur } }));
  };

  const ligne = (s: Source) => (
    <Ligne key={s.id} s={s} f={fiabilite[s.id]} maintenant={maintenant} q={filtres.q} modifiee={dirty.has(s.id)} onOuvrir={setOuverte} />
  );
  const corps = filtres.grouper
    ? groupes(lignes).map((g) => (
        <GroupeLignes key={g.key || g.sources[0].id} label={g.label} n={g.sources.length}>{g.sources.map(ligne)}</GroupeLignes>
      ))
    : lignes.map(ligne);

  return (
    <>
    <div className="bo-card">
      <h3>Sources <span className="bo-note">{c.actives}/{c.total} actives · public {c.public} · privé {c.prive}</span></h3>

      <div className="bo-actions">
        <Bouton icone="Plus" onClick={ajouter}>Ajouter une source</Bouton>
        <Bouton icone="Globe" onClick={preRemplirOrganisations}
          title="Propose une organisation aux sources qui n'en ont pas et partagent un nom de domaine — à relire avant d'enregistrer">Pré-remplir par domaine</Bouton>
        <Bouton icone="MapPin" onClick={preRemplirZones} disabled={enCours}
          title="Propose le département des sources qui ont une commune mais pas de zone — à relire avant d'enregistrer">Pré-remplir la zone par commune</Bouton>
        <ConfirmationSurPlace libelle="Restaurer le référentiel" icone="RotateCcw" varianteDeclencheur="secondaire" desactive={enCours}
          libelleConfirmer="Restaurer" libelleEnCours="Restauration…" consequence={CONSEQUENCE_RESTAURATION} onConfirm={restaurer} />
        <Bouton variante="primaire" icone="Check" className="bo-enregistrer" onClick={enregistrer} disabled={!canSave || enCours} chargement={enCours}>
          Enregistrer{dirty.size ? ` (${dirty.size})` : ""}
        </Bouton>
      </div>

      <div className="bo-actions" role="search" aria-label="Filtrer les sources">
        <input className="bo-in bo-recherche" type="search" name="filtreTexte" placeholder="Nom, organisation, commune, catégorie…" aria-label="Rechercher une source"
          value={filtres.q} onChange={(e) => changer({ q: e.target.value })} />
        <select className="bo-in" name="filtreVolet" aria-label="Filtrer par volet" value={filtres.kind} onChange={(e) => changer({ kind: e.target.value })}>
          <option value="">Public + privé</option>
          <option value="public">Public seulement</option>
          <option value="private">Privé seulement</option>
        </select>
        <select className="bo-in" name="filtreZone" aria-label="Filtrer par zone" value={filtres.zone} onChange={(e) => changer({ zone: e.target.value })}>
          <option value="">Toutes les zones</option>
          <option value="none">Sans zone ({zones.sansZone})</option>
          {zones.regions.map((r) => (
            <optgroup key={r.code} label={`${r.nom} (${r.n})`}>
              <option value={`r:${r.code}`}>{r.nom} (toute la région)</option>
              {r.depts.map((d) => <option key={d.code} value={`d:${d.code}`}>{d.code} · {d.nom} ({d.n})</option>)}
            </optgroup>
          ))}
        </select>
        <label className="bo-check"><input type="checkbox" name="activesSeulement" checked={filtres.activeOnly} onChange={(e) => changer({ activeOnly: e.target.checked })} /> Actives seulement</label>
        <label className="bo-check"><input type="checkbox" name="grouperParOrganisation" checked={filtres.grouper} onChange={(e) => changer({ grouper: e.target.checked })} /> Grouper par organisation</label>
        {actif && <Bouton variante="discret" taille="petite" icone="X" onClick={() => setFiltres(effacerFiltres)}>Effacer les filtres</Bouton>}
      </div>

      {pb.total > 0 && (
        <div className="bo-puces" role="group" aria-label="Sources avec un problème">
          <Puce actif={filtres.probleme === TOUS_PROBLEMES} onClick={() => changer({ probleme: filtres.probleme === TOUS_PROBLEMES ? "" : TOUS_PROBLEMES })}>
            <b>{pb.total}</b> avec un problème
          </Puce>
          {CAUSES.filter((k) => pb.parCause[k] > 0).map((k) => (
            <Puce key={k} actif={filtres.probleme === k} onClick={() => changer({ probleme: filtres.probleme === k ? "" : k })}>
              {LIBELLE_CAUSE[k]} <b>{pb.parCause[k]}</b>
            </Puce>
          ))}
        </div>
      )}

      {removed && <Message ton="avertissement">Des sources ont été retirées — « Enregistrer » pour confirmer la suppression.</Message>}

      <p className="ui-sr" aria-live="polite">{lignes.length} source{lignes.length > 1 ? "s" : ""} affichée{lignes.length > 1 ? "s" : ""}</p>
      <div className="bo-scroll"><table className="bo-table bo-sources"><thead><tr>
        <th scope="col">Nom</th><th scope="col">Volet</th><th scope="col">Type</th>
        <th scope="col" title="Date et état de la dernière tentative de récolte">Dernière récolte</th>
        <th scope="col">Zone</th>
        <th scope="col" title="Intervalle saisi, sinon déduit du champ « fréquence » de la source">Fréquence</th>
        <th scope="col" title="Score sur 100 : disponibilité, rendement des récoltes, fraîcheur, sort éditorial des articles. « — » : pas encore assez de récoltes. Survolez une valeur pour le détail.">Fiabilité</th>
        <th scope="col">Active</th></tr></thead>
        <tbody>{corps}</tbody></table></div>
      {lignes.length === 0 && <p className="bo-note bo-vide">Aucune source ne correspond à ces filtres.</p>}
      <datalist id={ID_ZONES}>{(zoneChoices() as string[]).map((z) => <option key={z} value={z} />)}</datalist>
      {hiddenInactive > 0 && <p className="bo-note bo-vide">{hiddenInactive} source(s) inactive(s) masquée(s) — décochez « actives seulement » pour les voir.</p>}

      {source && (
        <PanneauSource key={source.id} s={source} f={fiabilite[source.id]} maintenant={maintenant} modifiee={dirty.has(source.id)}
          enregistree={enregistrees.has(source.id)} idZones={ID_ZONES} test={tests[source.id]} testOccupe={testOccupe}
          onChange={modifier} onBlurOrg={figer} onTest={tester} onSupprimer={supprimer} onFermer={() => setOuverte(null)} />
      )}
    </div>
    {/* M3-117 : liste blanche du furtif, chargée à part (état de récolte). */}
    <FurtifSources />
    </>
  );
}

function Puce({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="bo-puce" aria-pressed={actif} onClick={onClick}>{children}</button>;
}

function GroupeLignes({ label, n, children }: { label: string | null; n: number; children: ReactNode }) {
  return (
    <>
      {label && <tr className="bo-group"><td colSpan={NB_COLONNES}><Icone nom="Users" size={13} /><b>{label}</b> <span className="bo-note">· {n} source{n > 1 ? "s" : ""}</span></td></tr>}
      {children}
    </>
  );
}

function Surligne({ texte, q }: { texte: string; q: string }) {
  return <>{decouperSurlignage(texte, q).map((m, i) => (m.marque ? <mark key={i}>{m.texte}</mark> : <span key={i}>{m.texte}</span>))}</>;
}

/* Une ligne en lecture. Le nom est un vrai bouton (clavier, lecteur d'écran) ;
   le clic ailleurs sur la ligne fait la même chose, pour la souris. */
const Ligne = memo(function Ligne({ s, f, maintenant, q, modifiee, onOuvrir }: {
  s: Source; f: Fiabilite | undefined; maintenant: number; q: string; modifiee: boolean; onOuvrir: (id: string) => void;
}) {
  const fia = affichageFiabilite(f);
  const rec = etatRecolte(f, maintenant);
  const zone = texteZone(s);
  const clic = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("button, a")) onOuvrir(s.id); };
  return (
    <tr className="bo-ligne" onClick={clic}>
      <td>
        <button type="button" className="bo-nom" onClick={() => onOuvrir(s.id)} aria-label={`Modifier la source ${s.name || "sans nom"}`}>
          <Surligne texte={s.name || "Source sans nom"} q={q} />
        </button>
        {modifiee && <> <Etiquette ton="brand">modifiée</Etiquette></>}
        {s.organisation && <div className="bo-note"><Surligne texte={s.organisation} q={q} /></div>}
      </td>
      <td>{s.kind === "private" ? "privé" : "public"}</td>
      <td className="mono">{s.type}</td>
      <td><Etiquette ton={rec.ton} title={rec.titre}>{rec.texte}</Etiquette>{rec.date && <div className="bo-note">{rec.date}</div>}</td>
      <td>{zone || <span className="bo-note">Sans zone</span>}</td>
      <td>{frequenceAffichee(s)}</td>
      <td><Etiquette ton={TON_FIA[fia.ton]} title={fia.titre}>{fia.texte}</Etiquette></td>
      <td>{s.active ? "Oui" : <span className="bo-note">Non</span>}</td>
    </tr>
  );
});
