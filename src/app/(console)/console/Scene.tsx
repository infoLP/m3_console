"use client";

// La relecture : la file, l'article ouvert (en-tête éditable, corps en blocs),
// la barre de décision et le panneau détaillé. Hérité de l'ancien front HTML
// (supprimé), dont le rafraîchissement à la main n'a plus lieu d'être : tout se
// recalcule au rendu.
// Mise en page (M3-107, axe C2 ; disposition.logique.ts) : sous 1000 px la file
// et le détail sont des tiroirs et l'article prend toute la largeur ; de 1000 à
// 1400 px la file est une colonne étroite, le détail un tiroir ; au-delà, trois
// colonnes. La barre de décision reste collée en bas de l'article partout.

import { useCallback, useState, useSyncExternalStore } from "react";
import { Bouton } from "@/composants/primitives";
import { Icone } from "@/composants/Icone";
import { cx } from "@/composants/cx";
import { asBlocks, BLOCK_TYPES, catInfo, FLAG_LABELS, writtenByMock, zoneLabel } from "@shared/model.js";
import { nf, readingOf, seoComplete, wordsOf } from "@shared/scoring.js";
import { dateCourte, datesArticle, filteredIndex, type Article, type Bloc } from "@/relireArticles/relireArticles.regles";
import { editerTexte, structure } from "@/editerArticle/editerArticle.regles";
import { BarreDecision } from "./BarreDecision";
import { Editable } from "./Editable";
import { Preuves } from "./Preuves";
import { Rail } from "./Rail";
import { Relances } from "./Relances";
import { ContenuDetail, TiroirDetail, type EmplacementsDetail } from "./TiroirDetail";
import { TiroirFile } from "./TiroirFile";
import { disposition, type CibleDetail, type Disposition } from "./disposition.logique";
import { useConsole } from "./store";

const DRAPEAUX = FLAG_LABELS as Record<string, string>;
const TYPES = BLOCK_TYPES as string[];

/* La largeur d'écran, comme le Tiroir du socle. Au rendu serveur (et à
   l'hydratation) : trois colonnes ; les media queries de console.css masquent
   d'ici là les colonnes qui n'ont pas leur place, sans attendre le script. */
const abonner = (rappel: () => void) => {
  window.addEventListener("resize", rappel);
  return () => window.removeEventListener("resize", rappel);
};
const LARGE: Disposition = disposition(Infinity);
let derniere: Disposition = LARGE;
const dispositionCourante = (): Disposition => {
  const d = disposition(window.innerWidth);
  /* Même objet tant que rien ne change : useSyncExternalStore compare par identité. */
  if (d.file !== derniere.file || d.detail !== derniere.detail) derniere = d;
  return derniere;
};
const dispositionServeur = (): Disposition => LARGE;

/* LE point de branchement des sections livrées par d'autres lots, commun aux
   deux enveloppes du panneau (colonne et tiroir) :
     preuves  : <Preuves> (worker C2), mise en avant du critère visé ;
     relances : <Relances> (worker C4).
   Une pastille en échec de la barre ouvre le panneau sur ancrePreuve(critère)
   (= idPreuve de Preuves.tsx), à défaut sur la section, à défaut sur la conformité. */
/* Relances se tait sans trace de relance : pas de section vide pour autant. */
const aDesRelances = (a: Article) => !!(a.checks as { regen?: unknown } | null | undefined)?.regen;

/* Les Preuves jugent avec les Paramètres (moi.scoring) et la FEAT « Parution
   sans illustration » du rôle (M3-113), pas avec les défauts. */
function emplacements(sel: Article, cible: CibleDetail | null, moi: { scoring: Record<string, number> | null; feats: Record<string, boolean> }): EmplacementsDetail {
  return { preuves: <Preuves article={sel} settings={moi.scoring} sansIllustration={!!moi.feats.sansIllustration} focus={cible?.critere} />, relances: aDesRelances(sel) ? <Relances article={sel as { checks?: unknown }} /> : undefined };
}

/* Espace réservé à plat (M3-99) : ni dégradé de rubrique, ni grain, ni vignette. */
function Illustration({ a }: { a: Article }) {
  if (a.illustration) {
    const url = a.illustration.url && a.illustration.url.trim();
    return (
      <div className="cr-illo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="" onError={(e) => { (e.target as HTMLImageElement).hidden = true; }} />}
        <span className="cr-illo-tag"><Icone nom="Image" size={12} />Illustration fournie</span>
        <Icone nom="Image" size={46} className="cr-illo-icon" />
        <span className="cr-illo-cred">{a.illustration.credit || "Crédit à compléter"}</span>
      </div>
    );
  }
  return (
    <div className="cr-illo cr-illo--manque">
      <span className="cr-illo-tag"><Icone nom="Image" size={12} />Aucune illustration</span>
      <div className="cr-illo-manque"><Icone nom="Image" size={40} className="cr-illo-icon" /><div>À fournir avant parution</div></div>
    </div>
  );
}

function SourceHero({ a }: { a: Article }) {
  if (a.source && a.source.type !== "none" && a.source.url) {
    return <a className="cr-hm cr-hm--source" href={a.source.url} target="_blank" rel="noopener noreferrer">{a.source.type === "pdf" ? <Icone nom="FileText" size={15} /> : <Icone nom="Globe" size={15} />}<b>{a.source.label || "Source"}</b><span className="cr-sr"> (nouvel onglet)</span></a>;
  }
  return <span className="cr-hm cr-hm--manque"><Icone nom="Link2" size={15} />Source manquante</span>;
}

function ZoneHero({ a }: { a: Article }) {
  const origin = (a.zone && a.zone.origin) || "";
  return (
    <>
      <Icone nom="MapPin" size={12} />{zoneLabel(a.zone)} <span className="reg">· {a.zone.region || ""}</span>
      {origin === "source" && <span className="reg" title="Département déduit de la source (organisme départemental), pas du texte — à vérifier"> · source ⚑</span>}
      {origin === "region" && <span className="reg" title="Aucun lieu cité dans le texte"> · portée régionale</span>}
    </>
  );
}

/* Les trois dates de l'article (M3-90), toujours affichées : une date inconnue
   se dit, plutôt que de faire disparaître sa ligne. */
function DatesHero({ a }: { a: Article }) {
  const d = datesArticle(a);
  return (
    <div className="cr-hero-meta cr-hero-dates">
      <span className="cr-hm" title="Récupération de l'article par la récolte"><Icone nom="Inbox" size={14} />Récupéré <b>{d.recuperation ? dateCourte(d.recuperation) : "date inconnue"}</b></span>
      <span className="cr-hm" title="Date de parution annoncée par la source"><Icone nom="Globe" size={14} />Publié par la source <b>{d.publicationSource ? dateCourte(d.publicationSource) : "non communiquée"}</b></span>
      <span className="cr-hm" title={d.regeneration ? `Régénéré le ${dateCourte(d.regeneration)}` : "Génération par la chaîne"}><Icone nom="Sparkles" size={14} />Généré <b>{d.generation ? dateCourte(d.generation) : "date inconnue"}</b>{d.regeneration && <> · régénéré <b>{dateCourte(d.regeneration)}</b></>}</span>
    </div>
  );
}

export function Scene() {
  const c = useConsole();
  const sel = c.sel;
  const d = useSyncExternalStore(abonner, dispositionCourante, dispositionServeur);
  const [fileOuverte, setFileOuverte] = useState(false);
  /* null : détail fermé (en tiroir). Un nouvel objet à chaque demande, pour se
     replacer même sur la même cible. */
  const [cible, setCible] = useState<CibleDetail | null>(null);
  const [detailOuvert, setDetailOuvert] = useState(false);
  const fermerFile = useCallback(() => setFileOuverte(false), []);
  /* En colonne, le panneau est déjà là : on s’y place seulement. */
  const ouvrirDetail = useCallback((ci?: CibleDetail) => { setCible(ci ? { ...ci } : null); if (d.detail === "tiroir") setDetailOuvert(true); }, [d.detail]);
  const nb = filteredIndex(c.index, c.portee).length;
  const slots = sel ? emplacements(sel, cible, c.moi) : {};

  return (
    <>
      <div className={cx("cr-grid", `cr-grid--file-${d.file}`, `cr-grid--detail-${d.detail}`)}>
        {d.file === "colonne" && <Rail />}
        <main className="cr-col-article">
          {d.file === "tiroir" && (
            <div className="cr-outils">
              <Bouton variante="secondaire" icone="Inbox" aria-haspopup="dialog" aria-expanded={fileOuverte} onClick={() => setFileOuverte(true)}>
                File du jour <span className="cr-outils-n">{nb}</span></Bouton>
            </div>
          )}
          {sel ? (
            <>
              <ArticleOuvert sel={sel} />
              <BarreDecision sel={sel} onDetail={ouvrirDetail} detailEnColonne={d.detail === "colonne"} detailOuvert={detailOuvert && d.detail === "tiroir"} />
            </>
          ) : (
            <div className="cr-empty"><div className="cr-empty-ic"><Icone nom="Check" size={30} sw={2.5} /></div><h3>La file est vide</h3>
              <p>Tous les brouillons du matin ont été traités. Lancez une génération depuis le back-office ou repassez plus tard.</p></div>
          )}
        </main>
        {sel && d.detail === "colonne" && (
          <aside className="cr-col-detail" aria-labelledby="cr-col-detail-t">
            <h2 id="cr-col-detail-t" className="cr-sr">Détail de l&apos;article</h2>
            <ContenuDetail sel={sel} cible={cible} {...slots} />
          </aside>
        )}
      </div>
      {d.file === "tiroir" && <TiroirFile ouvert={fileOuverte} onFermer={fermerFile} />}
      {sel && d.detail === "tiroir" && (
        <TiroirDetail ouvert={detailOuvert} onFermer={() => { setDetailOuvert(false); setCible(null); }} sel={sel} cible={cible} {...slots} />
      )}
    </>
  );
}

/** L'article lui-même : drapeaux, en-tête, illustration, corps. */
function ArticleOuvert({ sel }: { sel: Article }) {
  const c = useConsole();
  const ci = catInfo(sel.cat) as { token: string };
  const w = wordsOf(sel), rd = readingOf(sel);
  const seo = seoComplete(sel);
  const seoLocal = !!c.moi.feats.seoLocal;
  const blocs = asBlocks(sel.body) as Bloc[];
  const texte = (champ: string) => (v: string) => c.editer(editerTexte(sel, champ, v));
  const blur = () => { void c.flushPersist(); };
  const mock = writtenByMock(sel);

  return (
    /* --cc / --cc-tint : la couleur de la rubrique, une donnée — seules des var() passent ici. */
    <section className={`cr-stage cat-${ci.token}`} aria-label="Article ouvert">
      {sel.status === "purge" && (
        <div className="cr-flags"><span className="cr-flag"><Icone nom="Trash" size={13} />Article purgé{sel.decision?.at ? ` le ${new Date(sel.decision.at).toLocaleString("fr-FR")}` : ""}{sel.decision?.byName ? ` par ${sel.decision.byName}` : ""} — consultation seule, les modifications ne sont pas enregistrées.</span></div>
      )}
      {mock && <div className="cr-flags"><span className="cr-flag cr-flag--mock"><Icone nom="Sparkles" size={13} />Texte de remplissage, produit sans LLM (générateur de secours) — pas un article. Renvoyez-le à l&apos;IA ; il ne peut pas partir en parution.</span></div>}
      {sel.flags && sel.flags.length > 0 && (
        <div className="cr-flags">{sel.flags.map((f, i) => <span key={i} className="cr-flag"><Icone nom="XCircle" size={13} />{DRAPEAUX[f.type] || f.type}{f.detail ? ` — ${f.detail}` : ""}</span>)}</div>
      )}

      <div className="cr-hero">
        <div className="cr-hero-cat">
          <span className="cr-cat">{sel.cat}</span>
          <span className="cr-hero-zone"><ZoneHero a={sel} /></span>
          <span className="cr-cat cr-cat--neutre">{sel.mode === "press" ? "réécriture presse" : "source officielle"}</span>
          <span className="cr-edit-hint"><Icone nom="Pencil" size={12} />Tout est modifiable</span>
        </div>
        <Editable tag="h1" className="cr-hero-h" value={sel.title} placeholder="Titre de l'article…" onInput={texte("title")} onBlur={blur} entreeValide />
        <Editable tag="p" className="cr-chapo" value={sel.chapo} placeholder="Chapô…" onInput={texte("chapo")} onBlur={blur} entreeValide />
        <div className="cr-byline"><span className="k">Signature</span><Editable tag="span" className="cr-sign" value={sel.signature || "La Rédaction"} placeholder="Signature…" onInput={texte("signature")} onBlur={blur} entreeValide /></div>
        <div className="cr-hero-meta">
          <span className="cr-hm"><Icone nom="AlignLeft" size={15} /><b>{nf(w)}</b> signes</span>
          <span className="cr-hm"><Icone nom="Clock" size={15} /><b>{rd}</b> min de lecture</span>
          <span className="cr-hm"><Icone nom="Gauge" size={15} />Ranking <b>{sel.ranking}</b>/100</span>
          {seoLocal && <span className="cr-hm"><Icone nom="Sparkles" size={15} />SEO <b>{seo.ok ? "conforme" : "à revoir"}</b></span>}
          <span><SourceHero a={sel} /></span>
        </div>
        <DatesHero a={sel} />
      </div>

      <div className="cr-body">
        <div className="cr-read">
          <Illustration a={sel} />
          <div className="cr-prose">
            {blocs.map((b) => {
              const head = b.type !== "p";
              return (
                <div key={b.id} className={`cr-para${head ? " cr-para-h" : ""}`}>
                  <Editable tag={(head ? b.type : "p") as keyof HTMLElementTagNameMap} className={head ? `cr-hh cr-hh-${b.type}` : "cr-pp"} value={b.text}
                            placeholder={head ? "Intitulé de l'intertitre…" : "Rédigez ce paragraphe…"} onInput={texte(`block:${b.id}`)} onBlur={blur} />
                  <span className="cr-para-tools">
                    {TYPES.map((t) => <button key={t} className={`cr-btype${t === b.type ? " on" : ""}`} type="button" title={t === "p" ? "Paragraphe" : "Intertitre " + t.toUpperCase()} aria-label={t === "p" ? "Paragraphe" : "Intertitre " + t.toUpperCase()} aria-pressed={t === b.type} onClick={() => c.editerMaintenant(structure.blockType(sel, b.id, t))}>{t === "p" ? "¶" : t.toUpperCase()}</button>)}
                    <button className="cr-para-del" type="button" title="Supprimer ce bloc" aria-label="Supprimer ce bloc" onClick={() => c.editerMaintenant(structure.blockDel(sel, b.id))}><Icone nom="X" size={13} /></button>
                  </span>
                </div>
              );
            })}
            <div className="cr-add-row">
              <button className="cr-add" type="button" onClick={() => c.editerMaintenant(structure.blockAdd(sel, "p"))}><Icone nom="Plus" size={13} />Ajouter un paragraphe</button>
              <button className="cr-add" type="button" onClick={() => c.editerMaintenant(structure.blockAdd(sel, "h2"))}><Icone nom="Plus" size={13} />Ajouter un intertitre</button>
            </div>
            <div className="cr-excerpt">Corps de l&apos;article · <span>{nf(w)}</span> signes</div>
          </div>
        </div>
      </div>
    </section>
  );
}
