"use client";

// Onglet Suivi — graphes SVG faits main, sans dépendance. Porté de charts.js.

import { useState, type CSSProperties } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { geometrieBarres, PERIODES, rubriques, SERIES_LEGENDE, tuiles, type Stats } from "@/consulterSuivi/consulterSuivi.regles";
import * as client from "@/relireArticles/relireArticles.client";

function Barres({ series }: { series: Stats["series"] }) {
  const g = geometrieBarres(series);
  if (!g) return <div className="sv-vide">Pas encore de données.</div>;
  return (
    <svg viewBox={`0 0 ${g.w} ${g.h}`} className="sv-svg">
      {g.grille.map((l, i) => <g key={i}><line x1={g.pad} x2={g.w - g.pad} y1={l.y} y2={l.y} stroke="var(--line)" strokeDasharray="3 3" /><text x={g.pad - 6} y={l.y + 3} textAnchor="end" fontSize="9" fill="var(--ink-3)">{l.valeur}</text></g>)}
      {g.barres.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} rx="2"><title>{b.title}</title></rect>)}
      {g.etiquettes.map((e, i) => <text key={i} x={e.x} y={e.y} textAnchor="middle" fontSize="9" fill="var(--ink-3)">{e.texte}</text>)}
    </svg>
  );
}

export function Suivi({ initial }: { initial: Stats }) {
  const flash = useFlash();
  const [s, setS] = useState<Stats>(initial);
  const changerPeriode = async (r: string) => {
    try { setS(await client.stats(r)); } catch (err) { flash((err as Error).message, true); }
  };
  const cats = rubriques(s);
  return (
    <div className="sv-wrap">
      <div className="sv-row">{tuiles(s).map((t) => <div key={t.l} className="sv-tile"><div className="n">{t.n}</div><div className="l">{t.l}</div></div>)}</div>
      <div className="sv-card">
        <h4><Icone nom="BarChart" size={13} /> Production sur la période
          <span className="sv-periodes">{PERIODES.map((r) => <button key={r} className={`cr-tab${s.range === r ? " on" : ""}`} type="button" onClick={() => changerPeriode(r)}>{r}</button>)}</span>
        </h4>
        <Barres series={s.series} />
        <div className="sv-legend">{SERIES_LEGENDE.map((l, i) => <span key={l}><i className={`sv-sw sv-sw--${i}`}></i>{l}</span>)}</div>
      </div>
      <div className="sv-card">
        <h4>Répartition par rubrique</h4>
        {cats.length ? cats.map((r) => (
          <div key={r.k} className="sv-rub">
            <span className="sv-rub-k">{r.k}</span>
            <span className="sv-rub-t"><i style={{ "--pct": `${r.pct}%` } as CSSProperties}></i></span>
            <b>{r.v}</b>
          </div>
        )) : <div className="sv-vide">Aucun article.</div>}
      </div>
      {((s.byUser && s.byUser.length) || s.untrackedDecisions) ? (
        <div className="sv-card"><h4>Activité par relecteur</h4>
          {s.byUser.map((u) => <div key={u.reviewer} className="sv-user"><span>{u.reviewer}</span><span className="sv-user-n">{u.accepted} acceptés · {u.archived} archivés</span></div>)}
          {s.untrackedDecisions ? <div className="sv-note">{s.untrackedDecisions} décision{s.untrackedDecisions > 1 ? "s" : ""} antérieure{s.untrackedDecisions > 1 ? "s" : ""} au 16/09/2026, sans auteur enregistré — non réparti{s.untrackedDecisions > 1 ? "es" : "e"} ci-dessus.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
