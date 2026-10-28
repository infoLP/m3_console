"use client";

// Onglet Journal. Les filtres vivent
// dans l'URL (comme `?q=` chez M2) : changer un filtre navigue, la page serveur
// relit. « Charger la suite » ajoute la page suivante sans quitter l'écran.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { ROLES } from "@shared/model.js";
import {
  CAT_LABEL, depuisConsole, JOURNAL_TABS, NIVEAUX, ORIGINES, paramsDe, PERIODES, total,
  type Entree, type Filtres, type Journal,
} from "@/consulterJournal/consulterJournal.regles";
import { chargerSuite } from "@/consulterJournal/consulterJournal.action";

const ROLE = ROLES as Record<string, string>;
// Ton de la pastille selon le niveau : classes .bo-pill existantes (admin.css).
const PILL_NIVEAU: Record<string, string> = { info: "off", warn: "warn", error: "bad" };

/* Un réglage modifié est journalisé { avant, apres } depuis M3-109 : on le relit
   « avant → après », comme l'ancienne chaîne. Le reste s'affiche tel quel. */
const texteValeur = (v: unknown) => (v === "" || v == null ? "(vide)" : typeof v === "object" ? JSON.stringify(v) : String(v));
const avantApres = (v: unknown): string | null =>
  v && typeof v === "object" && "avant" in v && "apres" in v ? `${texteValeur((v as { avant: unknown }).avant)} → ${texteValeur((v as { apres: unknown }).apres)}` : null;

function Detail({ d }: { d: Entree["detail"] }) {
  if (!d || typeof d !== "object" || !Object.keys(d).length) return null;
  return (
    <details className="bo-jl-d"><summary className="bo-note">détail</summary>
      {Object.entries(d).map(([k, v]) => <div key={k}><span className="bo-note mono">{k}</span> {avantApres(v) ?? (typeof v === "object" ? JSON.stringify(v) : String(v))}</div>)}
    </details>
  );
}

function LigneJournal({ e }: { e: Entree }) {
  const when = new Date(e.at);
  return (
    <tr>
      <td className="bo-note bo-nowrap" title={when.toLocaleString("fr-FR")}>{when.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} {when.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
      <td><span className={`bo-pill ${PILL_NIVEAU[e.level] || PILL_NIVEAU.info}`}>{CAT_LABEL[e.category] || e.category}</span>
        {depuisConsole(e) ? <span className="bo-note" title="Action faite dans la console"> · console</span> : null}</td>
      <td><b>{e.event}</b>{e.target ? <span className="bo-note"> · {e.target}</span> : null}<Detail d={e.detail} /></td>
      <td>{e.actorName
        ? <>{e.actorName}{e.actorRole ? <span className="bo-note"> · {ROLE[e.actorRole] || e.actorRole}</span> : null}</>
        : <span className="bo-note" title="Aucune personne : action automatique, ou avant connexion">—</span>}</td>
    </tr>
  );
}

export function TableauJournal({ filtres, initial }: { filtres: Filtres; initial: Journal }) {
  const router = useRouter();
  const flash = useFlash();
  const [j, setJ] = useState<Journal>(initial);
  const [q, setQ] = useState(filtres.q);
  const [enCours, lancer] = useTransition();

  const aller = (patch: Partial<Filtres>) => router.push(`/admin/journal${paramsDe({ ...filtres, ...patch })}`);
  const suite = () => lancer(async () => {
    if (!j.nextCursor) return;
    const r = await chargerSuite(filtres, j.nextCursor);
    if (!r.ok) return flash(r.erreur, true);
    setJ({ ...r.data, items: [...j.items, ...r.data.items] });
  });

  return (
    <div className="bo-card">
      <h3>Journal <span className="bo-note">conservé {j.retentionDays || 90} jours · la trace complète reste dans les fichiers de logs/ du serveur</span></h3>
      <div className="bo-actions">
        {JOURNAL_TABS.map(([k, l]) => {
          const n = k ? j.counts[k] : total(j.counts);
          return <button key={k} className={`bo-btn${filtres.category === k ? " primary" : ""}`} type="button" onClick={() => aller({ category: k })}>{l} <span className="bo-note">{n}</span></button>;
        })}
      </div>
      <div className="bo-actions">
        <select className="bo-in" name="level" aria-label="Niveau" value={filtres.level} onChange={(e) => aller({ level: e.target.value })}>{NIVEAUX.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="bo-in" name="origine" aria-label="Origine des actions" value={filtres.origine} onChange={(e) => aller({ origine: e.target.value })}>{ORIGINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="bo-in" name="days" aria-label="Période" value={String(filtres.days)} onChange={(e) => aller({ days: Number(e.target.value) })}>{PERIODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {/* La recherche part à la validation ou en quittant le champ : recharger à chaque frappe ferait perdre le curseur. */}
        <input className="bo-in bo-in--recherche" name="q" placeholder="Rechercher : événement, personne, détail…" aria-label="Rechercher dans le journal" value={q}
               onChange={(e) => setQ(e.target.value)} onBlur={() => { if (q !== filtres.q) aller({ q }); }} onKeyDown={(e) => { if (e.key === "Enter") aller({ q }); }} />
        <button className="bo-btn" type="button" onClick={() => router.refresh()}><Icone nom="RotateCcw" size={13} />Actualiser</button>
      </div>
      {j.items.length
        ? <div className="bo-scroll"><table className="bo-table bo-jl"><thead><tr><th>Quand</th><th>Catégorie</th><th>Événement</th><th>Qui</th></tr></thead>
            <tbody>{j.items.map((e) => <LigneJournal key={e.id} e={e} />)}</tbody></table></div>
        : <p className="bo-note">Aucun événement pour ces filtres.</p>}
      {j.nextCursor && <div className="bo-actions bo-actions--suite"><button className="bo-btn" type="button" onClick={suite} disabled={enCours}>Charger la suite</button></div>}
    </div>
  );
}
