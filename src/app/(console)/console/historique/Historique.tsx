"use client";

// Onglet Historique : les articles sortis de la file. Porté de history.js.
// La première page vient du serveur ; catégories, recherche (différée) et
// « charger la suite » relisent /api/history depuis le navigateur.
// T14 : un UUID collé retrouve un article, ou la fiche d'un article effacé.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { catInfo, zoneLabel } from "@shared/model.js";
import { auteur, categoriesVisibles, chaineDecisions, complet, datesFiche, paramsHistorique, type FiltresHistorique, harvestedOf, jour, puceStatut, totalCompteurs, uuidValide, type Historique as H, type LigneHistorique } from "@/consulterHistorique/consulterHistorique.regles";
import * as client from "@/relireArticles/relireArticles.client";
import { useConsole } from "../store";

const Tiret = ({ title }: { title?: string }) => <span className="hi-none" title={title}>—</span>;

const UneDate = ({ iso }: { iso: string | null | undefined }) => (jour(iso) ? <span title={complet(iso)}>{jour(iso)}</span> : <Tiret />);

/* Article effacé (T14) : consultation seule. Pas d'action ni de lien vers la
   fiche d'article, qui n'existe plus ; le détail suit sur une seconde ligne. */
function LigneEffacee({ r, canSee }: { r: LigneHistorique; canSee: boolean }) {
  const cat = catInfo(r.cat || "") as { token: string };
  const puce = puceStatut(r.status);
  const h = harvestedOf(r);
  const qui = auteur(r, canSee);
  const f = r.fiche;
  const decisions = chaineDecisions(f);
  return (
    <>
      {/* Consultation seule : pas de fiche d'article à ouvrir, donc pas de main. */}
      <tr className="hi-row" style={{ cursor: "default" }}>
        <td className="hi-title">
          <div className="hi-t">{r.title || "(sans titre)"}</div>
          <div className="hi-sub"><span className="hi-chip" style={puce.style} title={puce.title}>{puce.label}</span>
            {r.cat && <span className={`cr-cat cat-${cat.token}`}>{r.cat}</span>}
            {r.zone && <span><Icone nom="MapPin" size={10} />{zoneLabel(r.zone)}</span>}</div>
        </td>
        <td className="hi-src">{f?.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">{r.sourceLabel || f.sourceUrl}</a> : r.sourceLabel || "—"}{r.sourceKind === "private" && <span className="hi-kind">privé</span>}</td>
        <td className="hi-date">{h ? <UneDate iso={h.iso} /> : <Tiret title="Date de récupération non enregistrée" />}</td>
        <td className="hi-date"><UneDate iso={r.createdAt} /></td>
        <td className="hi-date"><UneDate iso={r.decidedAt} /></td>
        <td className="hi-who">{qui.texte ? <span title={qui.title}>{qui.texte}</span> : <Tiret title={qui.title} />}</td>
      </tr>
      <tr>
        <td colSpan={6} className="hi-sub">
          <div className="flex flex-col gap-1.5 py-1.5">
            {r.uuid && <div>UUID : <span className="mono">{r.uuid}</span></div>}
            <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label="Dates de l'article">
              {datesFiche(r).map((d) => <li key={d.libelle}>{d.libelle} <span title={complet(d.iso)}>{jour(d.iso) || "—"}</span>{d.par ? ` · ${d.par}` : ""}</li>)}
            </ul>
            {decisions.length > 0 && (
              <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" aria-label="Chaîne des décisions">
                {decisions.map((d, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden="true">→</span>}
                    <span><b>{d.statut}</b>{d.iso ? <> · <span title={complet(d.iso)}>{jour(d.iso)}</span></> : null}{d.nom ? ` · ${d.nom}` : ""}{d.role ? ` (${d.role})` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

function Ligne({ r, canSee, ouvrir }: { r: LigneHistorique; canSee: boolean; ouvrir: (id: string) => void }) {
  const cat = catInfo(r.cat || "") as { token: string };
  const puce = puceStatut(r.status, r.purgedFrom);
  const h = harvestedOf(r);
  const dec = jour(r.decidedAt);
  const qui = auteur(r, canSee);
  return (
    <tr className="hi-row" tabIndex={0} onClick={() => ouvrir(r.id)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ouvrir(r.id); } }}>
      <td className="hi-title">
        <div className="hi-t">{r.title || "(sans titre)"}</div>
        <div className="hi-sub"><span className="hi-chip" style={puce.style} title={puce.title}>{puce.label}</span>
          {r.cat && <span className={`cr-cat cat-${cat.token}`}>{r.cat}</span>}
          <span><Icone nom="MapPin" size={10} />{zoneLabel(r.zone || {})}</span></div>
      </td>
      <td className="hi-src">{r.sourceLabel || "—"}{r.sourceKind === "private" && <span className="hi-kind">privé</span>}</td>
      <td className="hi-date">{!h || !jour(h.iso) ? <Tiret title="Date de récupération non enregistrée" /> : h.approx ? <span title="Lue dans l'identifiant de l'article : le jour de la récolte, sans l'heure">{jour(h.iso)}</span> : <span title={complet(h.iso)}>{jour(h.iso)}</span>}</td>
      <td className="hi-date">{jour(r.createdAt) ? <span title={complet(r.createdAt)}>{jour(r.createdAt)}</span> : <Tiret />}</td>
      <td className="hi-date">{!dec ? <Tiret title="Aucune date de décision enregistrée" /> : r.legacy ? <span className="hi-legacy" title="Date approchée : reprise de la dernière modification, avant la mise en place de la traçabilité le 16/09/2026">{dec} ≈</span> : <span title={complet(r.decidedAt)}>{dec}</span>}
        {r.scheduledAt && <div className="hi-sched" title="Parution planifiée"><Icone nom="Clock" size={10} />{jour(r.scheduledAt)}</div>}</td>
      <td className="hi-who">{qui.texte ? <span title={qui.title}>{qui.texte}</span> : <Tiret title={qui.title} />}</td>
    </tr>
  );
}

export function Historique({ initial, filtres }: { initial: H; filtres: FiltresHistorique }) {
  const router = useRouter();
  const c = useConsole();
  const flash = useFlash();
  const [h, setH] = useState<H>(initial);
  /* Le serveur remplace « purge » par « Tout » sans le droit : l'onglet
     n'existe pas alors, on ne le garde pas sélectionné. */
  const [catUrl, setCat] = useState(filtres.category);
  const cat = catUrl === "purge" && h.canSeePurged === false ? "" : catUrl;
  const [q, setQ] = useState(filtres.q);
  const [uuid, setUuid] = useState(filtres.uuid ?? "");
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const champ = useRef<HTMLInputElement>(null);

  const charger = async (opts: { cat: string; q: string; uuid?: string | null; cursor?: string | null; append?: boolean }) => {
    setLoading(true);
    try {
      const page = await client.historique({ category: opts.cat, q: opts.q, uuid: opts.uuid || null, cursor: opts.cursor || null });
      /* Par UUID, le serveur ne compte rien : les compteurs restent ceux de la liste. */
      setH((prev) => (opts.append ? { ...page, items: prev.items.concat(page.items) } : opts.uuid ? { ...page, counts: prev.counts } : page));
    } catch (err) { flash((err as Error).message, true); }
    finally { setLoading(false); }
  };
  /* L'URL suit les filtres sans empiler l'historique du navigateur. */
  const synchroniser = (f: FiltresHistorique) => router.replace(`/console/historique${paramsHistorique(f)}`, { scroll: false });
  /* Recherche différée : chaque frappe partirait sinon en requête. */
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const surRecherche = (v: string) => {
    setQ(v);
    setUuid("");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { synchroniser({ category: cat, q: v }); void charger({ cat, q: v }); }, 350);
  };
  /* Un UUID complet part tout de suite (il est collé, pas tapé) ; un champ vidé
     rend la liste ; un UUID incomplet n'envoie rien. */
  const surUuid = (v: string) => {
    setUuid(v);
    window.clearTimeout(timer.current);
    const u = uuidValide(v);
    if (u) { synchroniser({ category: cat, q, uuid: u }); void charger({ cat, q, uuid: u }); }
    else if (!v.trim()) { synchroniser({ category: cat, q }); void charger({ cat, q }); }
  };
  const parUuid = uuidValide(uuid);
  const counts = h.counts || { publie: 0, archive: 0 };
  const shown = h.items.length;
  const purges = h.canSeePurged !== false;

  return (
    <div className="sv-wrap">
      <div className="sv-row">
        <div className="sv-tile"><div className="n">{counts.publie}</div><div className="l">publiés</div></div>
        <div className="sv-tile"><div className="n">{counts.valide}</div><div className="l">en attente de parution</div></div>
        <div className="sv-tile"><div className="n">{counts.archive}</div><div className="l">archivés (classés sans diffusion)</div></div>
        {purges && <div className="sv-tile"><div className="n">{counts.purge || 0}</div><div className="l">purgés</div></div>}
        <div className="sv-tile"><div className="n">{h.total}</div><div className="l">dans la sélection courante</div></div>
      </div>
      <div className="sv-card">
        <h4 className="hi-h"><span><Icone nom="Clock" size={13} /> Historique des décisions</span>
          <span className="hi-tools">
            {categoriesVisibles(h.canSeePurged).map((k) => { const n = k.key === "" ? totalCompteurs(counts) : counts[k.key] || 0; return <button key={k.key} className={`cr-tab${cat === k.key ? " on" : ""}`} type="button" onClick={() => { setCat(k.key); setUuid(""); window.clearTimeout(timer.current); synchroniser({ category: k.key, q }); void charger({ cat: k.key, q }); }}>{k.label}<span className="hi-n">{n}</span></button>; })}
            <input ref={champ} className="hi-search" aria-label="Rechercher un titre" placeholder="Rechercher un titre…" value={q} onChange={(e) => surRecherche(e.target.value)} />
            <input id="hi-uuid" name="uuid" className="hi-search" aria-label="Rechercher par UUID" placeholder="Rechercher par UUID…" spellCheck={false} autoComplete="off" value={uuid} onChange={(e) => surUuid(e.target.value)} />
          </span>
        </h4>
        {h.items.length ? (
          <div className="hi-scroll"><table className="hi-table">
            <thead><tr><th>Article</th><th>Source</th><th>Récupéré le</th><th>Généré le</th>{purges ? <th title="Pour un article purgé : date et auteur de la purge">Décidé / purgé le</th> : <th>Décidé le</th>}<th>Par</th></tr></thead>
            <tbody>{h.items.map((r) => r.status === "efface" ? <LigneEffacee key={r.id} r={r} canSee={h.canSeeAuthors} /> : <Ligne key={r.id} r={r} canSee={h.canSeeAuthors} ouvrir={(id) => { void c.openFromHistory(id); }} />)}</tbody>
          </table></div>
        ) : <div className="hi-empty">{parUuid ? `Aucun article ne porte l'UUID « ${parUuid} ».` : q ? `Aucun article ne correspond à « ${q} ».` : "Aucun article n'est encore sorti de la file de relecture."}</div>}
        {h.nextCursor && <div className="hi-more"><button className="cr-btn ghost" type="button" disabled={loading} onClick={() => charger({ cat, q, uuid: parUuid, cursor: h.nextCursor, append: true })}><Icone nom="RotateCcw" size={15} />{loading ? "Chargement…" : "Charger la suite"}</button></div>}
        <div className="hi-foot">{shown} ligne{shown > 1 ? "s" : ""} affichée{shown > 1 ? "s" : ""} sur {h.total}. {h.canSeeAuthors ? "" : "Le nom du décideur est réservé aux profils Administrateur et Super Utilisateur."}</div>
      </div>
    </div>
  );
}
