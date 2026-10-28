"use client";

// Le panneau détaillé de l'article (M3-107, axe C2) : rattachement, paramètres éditoriaux, source,
// illustration, SEO — et deux emplacements livrés par d'autres lots : les
// preuves (« le pourquoi », worker C2) et la trace des relances (worker C4).
// M3-113 : la conformité et la relecture automatique, qui répétaient les
// Preuves, sont retirées ; le ranking se lit « score / seuil (Paramètres) ».
// Un seul contenu (ContenuDetail), deux enveloppes : la colonne de droite au-delà
// de 1400 px (Scene), le Tiroir droit en dessous (TiroirDetail).

import { useEffect, useId, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { Icone } from "@/composants/Icone";
import { Tiroir } from "@/composants/primitives";
import { cx } from "@/composants/cx";
import { zoneClassOf } from "@shared/model.js";
import { meterCls, olCountLabel, rankBand, seoComplete, SEUIL_FORT_ALIGNEMENT } from "@shared/scoring.js";
import { outlineOf } from "@shared/model.js";
import type { Article } from "@/relireArticles/relireArticles.regles";
import { checkIllustrationUrl, choisir, editerChamp, structure } from "@/editerArticle/editerArticle.regles";
import { useConsole } from "./store";
import { ancreDetail, ancresCible, type CibleDetail, type SectionDetail } from "./disposition.logique";

const CATS = ["Économie", "Culture", "Environnement", "Société", "Sport"];

/** Les sections livrées ailleurs : rendues telles quelles, à leur place. */
export type EmplacementsDetail = {
  /** <Preuves article={sel} /> (worker C2). Peut poser ancrePreuve(critere) sur chaque critère. */
  preuves?: ReactNode;
  /** <Relances article={sel} /> (worker C4). */
  relances?: ReactNode;
};

export type ContenuDetailProps = EmplacementsDetail & {
  sel: Article;
  /** Section où se placer à l'ouverture (et à chaque nouvelle cible). */
  cible?: CibleDetail | null;
};

function Section({ section, icone, titre, children }: { section: SectionDetail; icone: string; titre: string; children: ReactNode }) {
  const id = ancreDetail(section);
  return (
    <section id={id} className="cr-detail-sec" aria-labelledby={`${id}-t`} tabIndex={-1}>
      <h3 id={`${id}-t`} className="cr-panel-h"><Icone nom={icone} size={13} />{titre}</h3>
      {children}
    </section>
  );
}

/** Le contenu du panneau, sans enveloppe : colonne ou tiroir. */
export function ContenuDetail({ sel, cible, preuves, relances }: ContenuDetailProps) {
  const c = useConsole();
  const id = useId();
  const band = rankBand(sel.ranking) as { lab: string; key: string };
  const feats = c.moi.feats;
  const seuil = Number(c.moi.scoring?.ranking_threshold) || 60;
  const [motifOuvert, setMotifOuvert] = useState(false);
  const motif = String(sel.rankingReason || "").trim();
  const seoLocal = !!feats.seoLocal;
  const champ = (nom: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => c.editer(editerChamp(sel, nom, e.target.value));
  const choix = (nom: string) => (e: ChangeEvent<HTMLSelectElement>) => { void c.editerMaintenant(choisir(sel, nom, e.target.value)); };
  const blur = () => { void c.flushPersist(); };

  /* Se placer sur la cible : après le rendu ET après le focus initial du Tiroir
     (ses effets passent après ceux de ses enfants), d'où l'image suivante. Une
     cible absente retombe sur la section Preuves. */
  useEffect(() => {
    if (!cible) return;
    const ancres = [...ancresCible(cible), ancreDetail("preuves")];
    const image = requestAnimationFrame(() => {
      const el = ancres.map((a) => document.getElementById(a)).find(Boolean);
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(image);
  }, [cible]);

  return (
    <div className="cr-ctrl">
      {preuves && <Section section="preuves" icone="FileText" titre="Preuves">{preuves}</Section>}
      {relances && <Section section="relances" icone="RotateCcw" titre="Relances">{relances}</Section>}
      {seoLocal && (
        <Section section="rattachement" icone="MapPin" titre="Rattachement">
          <p className="cr-note">{(sel.zoneClass || zoneClassOf(sel.zone)) === "hab" ? "Zone habilitée" : "Zone non habilitée"}</p>
          <div className="cr-row">
            <input className="cr-in cr-in--large" value={sel.zone.dept || sel.zone.commune || ""} onChange={champ("dept")} onBlur={blur} aria-label="Département" placeholder="Département" />
            <input className="cr-in mono cr-in--etroit" value={sel.zone.num || ""} onChange={champ("num")} onBlur={blur} aria-label="Numéro de département" placeholder="N°" />
          </div>
          <input className="cr-in" value={sel.zone.region || ""} onChange={champ("region")} onBlur={blur} aria-label="Région" placeholder="Région" />
        </Section>
      )}
      <Section section="parametres" icone="Sliders" titre="Paramètres éditoriaux">
        <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-cat`}><Icone nom="Type" size={12} />Rubrique</label>
          <select className="cr-sel" id={`${id}-cat`} value={sel.cat} onChange={choix("cat")}>{[...new Set([sel.cat, ...CATS])].map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
        <div className="cr-field">
          <div className="cr-rank-top"><div>
            <label className="cr-lbl" htmlFor={`${id}-rank`}><Icone nom="Gauge" size={12} />Ranking éditorial</label>
            <input className="cr-rank-inp" id={`${id}-rank`} type="number" min={0} max={100} value={sel.ranking} onChange={champ("rank")} onBlur={blur} /></div>
            <span className={`cr-rank-lab cr-rank--${band.key}`}>{band.lab}</span></div>
          <p className="cr-rank-score">Score <b>{Number(sel.ranking) || 0}</b> / seuil {seuil} (Paramètres)</p>
          <RangRanking valeur={sel.ranking} seuil={seuil} bande={band.key} />
          <p className="cr-rank-legende">Sous le seuil : moins de {seuil} · Aligné : {seuil} à {SEUIL_FORT_ALIGNEMENT - 1} · Fort : {SEUIL_FORT_ALIGNEMENT} et plus</p>
          <div className="cr-rank-motif-t">
            <span className="cr-lbl" id={`${id}-rankwhy-t`}>Motif du ranking</span>
            <button className="cr-add" type="button" aria-expanded={motifOuvert} aria-controls={`${id}-rankwhy`} onClick={() => setMotifOuvert((o) => !o)}>
              <Icone nom={motifOuvert ? "Check2" : "Type"} size={13} />{motifOuvert ? "Terminer" : "Modifier le motif"}
            </button>
          </div>
          {motifOuvert
            ? <textarea className="cr-in" rows={4} id={`${id}-rankwhy`} aria-labelledby={`${id}-rankwhy-t`} placeholder="Justification du ranking" value={sel.rankingReason || ""} onChange={champ("rankwhy")} onBlur={blur} autoFocus />
            : <p className="cr-rank-motif" id={`${id}-rankwhy`} aria-labelledby={`${id}-rankwhy-t`}>{motif || "Aucun motif enregistré."}</p>}
        </div>
      </Section>
      <Section section="source" icone="Link2" titre="Source">
        <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-srctype`}>Type de source</label>
          <select className="cr-sel" id={`${id}-srctype`} value={sel.source?.type || "none"} onChange={choix("srctype")}><option value="site">Lien web</option><option value="pdf">Document PDF</option><option value="none">Aucune source</option></select></div>
        {sel.source && sel.source.type !== "none" && (
          <>
            <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-srclabel`}>Intitulé</label><input className="cr-in" id={`${id}-srclabel`} value={sel.source.label || ""} onChange={champ("srclabel")} onBlur={blur} placeholder="Ex. Communiqué de presse" /></div>
            <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-srcurl`}>Lien (URL)</label><input className="cr-in mono" id={`${id}-srcurl`} value={sel.source.url || ""} onChange={champ("srcurl")} onBlur={blur} placeholder="https://…" /></div>
            {sel.source.url && <a className="cr-lien-ext" href={sel.source.url} target="_blank" rel="noopener noreferrer"><Icone nom="Globe" size={13} />Ouvrir la source<span className="cr-sr"> (nouvel onglet)</span></a>}
          </>
        )}
      </Section>
      <Section section="illustration" icone="Image" titre="Illustration">
        {sel.illustration ? (
          <>
            <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-illourl`}>Image (URL)</label><input className="cr-in mono" id={`${id}-illourl`} value={sel.illustration.url || ""} onChange={champ("illourl")} onBlur={blur} placeholder="https://…/photo.jpg" aria-describedby={`${id}-illoaide`} /></div>
            {/* M3-66 : URL du web (téléversée à la parution) ou lien de la médiathèque du site cible (réutilisé). */}
            {checkIllustrationUrl(sel.illustration.url) && <p className="cr-note" role="alert">{checkIllustrationUrl(sel.illustration.url)} L&apos;article partira sans image.</p>}
            <p className="cr-note" id={`${id}-illoaide`}>Adresse d&apos;une image du web, ou lien vers un média de la médiathèque WordPress. Une image trouvée sur le net : son droit d&apos;usage est à votre charge ; l&apos;adresse d&apos;origine est gardée avec l&apos;image.</p>
            <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-illocredit`}>Crédit</label><input className="cr-in" id={`${id}-illocredit`} value={sel.illustration.credit || ""} onChange={champ("illocredit")} onBlur={blur} placeholder="© Auteur / Agence" /></div>
            <button className="cr-add cr-add--danger" type="button" onClick={() => c.editerMaintenant(structure.illoDel(sel))}><Icone nom="X" size={13} />Retirer l&apos;illustration</button>
          </>
        ) : (
          <>
            <p className="cr-note">Aucune illustration fournie.</p>
            <button className="cr-add" type="button" onClick={() => c.editerMaintenant(structure.illoAdd(sel))}><Icone nom="Plus" size={13} />Ajouter une illustration</button>
          </>
        )}
      </Section>
      {seoLocal && <PanneauSeo sel={sel} />}
    </div>
  );
}

/* Jauge du ranking : la largeur et le seuil sont des données, seules valeurs
   passées en style (des variables, jamais une couleur — la couleur suit la
   bande, en classe). Le repère du seuil suit les Paramètres (M3-113). */
function RangRanking({ valeur, seuil, bande }: { valeur: number; seuil: number; bande: string }) {
  const pct = Math.max(0, Math.min(100, Number(valeur) || 0));
  const s = Math.max(0, Math.min(100, seuil));
  return (
    <div className="cr-rank-track" aria-hidden="true" style={{ "--pct": `${pct}%`, "--seuil": `${s}%` } as CSSProperties}>
      <div className={`cr-rank-fill cr-rank--${bande}`}></div><div className="cr-rank-thr"></div>
    </div>
  );
}

/* SEO (M3-91 : seulement si la FEAT est ouverte). */
function PanneauSeo({ sel }: { sel: Article }) {
  const c = useConsole();
  const [kw, setKw] = useState("");
  const id = useId();
  const seo = seoComplete(sel);
  const champ = (nom: string) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => c.editer(editerChamp(sel, nom, e.target.value));
  const blur = () => { void c.flushPersist(); };
  const plan = outlineOf(sel) as { t: string; x: string; ref: string }[];
  const nKw = (sel.seo.keywords || []).length;
  return (
    <Section section="seo" icone="Sparkles" titre="SEO — suggestions modifiables">
      <div className="cr-field"><div className="cr-flab"><label className="cr-lbl" htmlFor={`${id}-mt`}><Icone nom="Type" size={12} />Balise titre</label><span className={meterCls(sel.seo.metaTitle.length, 0, 60)}>{sel.seo.metaTitle.length}/60</span></div>
        <textarea className="cr-in mono" rows={2} id={`${id}-mt`} value={sel.seo.metaTitle} onChange={champ("mt")} onBlur={blur} /></div>
      <div className="cr-field"><div className="cr-flab"><label className="cr-lbl" htmlFor={`${id}-md`}><Icone nom="AlignLeft" size={12} />Méta-description</label><span className={meterCls(sel.seo.metaDescription.length, 70, 160)}>{sel.seo.metaDescription.length}/160</span></div>
        <textarea className="cr-in mono" rows={3} id={`${id}-md`} value={sel.seo.metaDescription} onChange={champ("md")} onBlur={blur} /></div>
      <div className="cr-field"><label className="cr-lbl" htmlFor={`${id}-slug`}><Icone nom="Link2" size={12} />Slug URL</label>
        <div className="cr-slug"><span className="p">/</span><input id={`${id}-slug`} value={sel.seo.slug} onChange={champ("slug")} onBlur={blur} /></div></div>
      <div className="cr-field"><div className="cr-flab"><label className="cr-lbl" htmlFor={`${id}-kw`}><Icone nom="Hash" size={12} />Mots-clés</label><span className={cx("cr-count", nKw < 3 && "warn")}>{nKw} · min 3</span></div>
        <div className="cr-kw">
          {(sel.seo.keywords || []).map((k) => <span key={k} className="cr-chip">{k}<button type="button" aria-label={`Retirer le mot-clé « ${k} »`} onClick={() => c.editerMaintenant(structure.kwRemove(sel, k))}><Icone nom="X" size={11} /></button></span>)}
          <span className="cr-kw-add"><Icone nom="Plus" size={12} className="cr-ink-3" /><input id={`${id}-kw`} placeholder="mot-clé + Entrée" value={kw} onChange={(e) => setKw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const m = structure.kwAdd(sel, kw); if (m) { void c.editerMaintenant(m); setKw(""); } } }} /></span>
        </div></div>
      <div className="cr-field"><div className="cr-flab"><span className="cr-lbl" id={`${id}-hn`}><Icone nom="Type" size={12} />Structure Hn</span><span className={cx("cr-count", !seo.olOK && "warn")}>{olCountLabel(seo)}</span></div>
        <div role="group" aria-labelledby={`${id}-hn`}>
          {plan.map((o) => {
            const isH1 = o.ref === "title";
            return (
              <div key={o.ref} className="cr-olrow">
                {isH1 ? <span className="cr-oltag">H1</span>
                  : <select value={o.t} aria-label={`Niveau de « ${o.x || "Intitulé"} »`} onChange={(e) => c.editerMaintenant(choisir(sel, `ollevel:${o.ref}`, e.target.value))}><option value="H2">H2</option><option value="H3">H3</option></select>}
                <input value={o.x} aria-label={isH1 ? "Titre de l'article (H1)" : "Intitulé de l'intertitre"} placeholder={isH1 ? "Titre de l'article" : "Intitulé"} onChange={champ(`ol:${o.ref}`)} onBlur={blur} />
                {isH1 ? <span className="cr-para-del cr-invisible" aria-hidden="true"><Icone nom="X" size={13} /></span>
                  : <button className="cr-para-del" type="button" title="Supprimer l'intertitre" aria-label={`Supprimer l'intertitre « ${o.x || "sans intitulé"} »`} onClick={() => c.editerMaintenant(structure.blockDel(sel, o.ref))}><Icone nom="X" size={13} /></button>}
              </div>
            );
          })}
        </div>
        <button className="cr-add cr-add--suite" type="button" onClick={() => c.editerMaintenant(structure.blockAdd(sel, "h2"))}><Icone nom="Plus" size={13} />Ajouter un intertitre</button>
        <div className="cr-olhint">Le plan est le corps de l&apos;article : renommer une ligne renomme l&apos;intertitre dans le texte.</div></div>
    </Section>
  );
}

export type TiroirDetailProps = ContenuDetailProps & { ouvert: boolean; onFermer: () => void };

/** L'enveloppe tiroir (droite, par-dessus l'article), sous 1400 px. */
export function TiroirDetail({ ouvert, onFermer, ...contenu }: TiroirDetailProps) {
  return (
    <Tiroir ouvert={ouvert} onFermer={onFermer} cote="droite" titre="Détail de l'article" libelleFermer="Fermer le détail" className="cr-tiroir-detail">
      <ContenuDetail {...contenu} />
    </Tiroir>
  );
}
