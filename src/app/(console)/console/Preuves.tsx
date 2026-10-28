"use client";
// Preuves (M3-107, M3-113) : le « pourquoi » d'un article, miroir des règles
// M3. Une preuve par règle, en « attendu → obtenu », dans un état parmi quatre
// (conforme, non conforme, à vérifier, non mesuré). La règle vit dans
// relireArticles.regles.ts (preuvesDe, etatPreuve, lecturePreuves) ; ce
// composant ne fait que l'afficher, dans l'ordre de lecture :
//   1. verdict de tête ; 2. non conformes ; 3. à vérifier ;
//   4. les familles, conformes repliés ; 5. la ligne grise des non mesurés.
// Chaque preuve porte l'id `preuve-<cle>` : un lien « pourquoi » (#preuve-seo…)
// y saute, et la prop `focus` la met en avant, ouvre ce qui la replie et la
// fait défiler à l'écran.

import { useEffect, useMemo } from "react";
import { Carte, Etiquette, Message, Vide, type TonEtiquette } from "@/composants/primitives";
import {
  lecturePreuves, preuvesDe, verdictPreuves,
  type Article, type EtatPreuve, type LignePreuve, type Preuve,
} from "@/relireArticles/relireArticles.regles";

export type PreuvesProps = {
  article: Article;
  /* Les Paramètres (moi.scoring) : seuil du ranking, attendu d'un article ancien. */
  settings?: Record<string, unknown> | null;
  /* FEAT « Parution sans illustration » (M3-93) ouverte au rôle. */
  sansIllustration?: boolean;
  /* Clé de l'entrée à mettre en avant (« seo », « citations »…). */
  focus?: string;
};

export const idPreuve = (cle: string) => `preuve-${cle}`;

export const ETATS: Record<EtatPreuve, { ton: TonEtiquette; texte: string }> = {
  conforme: { ton: "go", texte: "Conforme" },
  non_conforme: { ton: "stop", texte: "Non conforme" },
  a_verifier: { ton: "amber", texte: "À vérifier" },
  non_mesure: { ton: "neutre", texte: "Non mesuré" },
};

function AttenduObtenu({ attendu, obtenu, parametresActuels }: { attendu: string; obtenu: string; parametresActuels?: boolean }) {
  return (
    <p className="m-0 text-sm text-ink">
      <span className="text-ink-2">attendu : </span>{attendu}
      {parametresActuels && <span className="text-ink-3"> (Paramètres actuels)</span>}
      <span className="text-ink-2" aria-hidden="true"> → </span><span className="sr-only">, obtenu : </span>{obtenu}
    </p>
  );
}

function ALaGeneration({ ecarts }: { ecarts?: string[] }) {
  if (!ecarts || !ecarts.length) return null;
  return <p className="m-0 text-xs text-ink-2">À la génération : {ecarts.join(" ; ")}.</p>;
}

function Ligne({ l }: { l: LignePreuve }) {
  const v = ETATS[l.etat];
  return (
    <li id={idPreuve(l.cle)} className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        {l.libelle}<span className="text-xs font-normal text-ink-3">{l.regle}</span><Etiquette ton={v.ton}>{v.texte}</Etiquette>
      </span>
      <AttenduObtenu attendu={l.attendu} obtenu={l.obtenu} parametresActuels={l.parametresActuels} />
      <ALaGeneration ecarts={l.aLaGeneration} />
    </li>
  );
}

function Entree({ p, enAvant }: { p: Preuve; enAvant: boolean }) {
  const v = ETATS[p.etat];
  return (
    <li id={idPreuve(p.cle)} tabIndex={-1} aria-current={enAvant ? "true" : undefined} className={enAvant ? "rounded-m3 outline-2 outline-brand outline-offset-2" : undefined}>
      <Carte as="article" titre={p.libelle} niveauTitre={4} variante={enAvant ? "encadree" : "aplat"}
        actions={<><span className="text-xs text-ink-3">{p.regle}</span><Etiquette ton={v.ton}>{v.texte}</Etiquette></>}>
        <div className="flex flex-col gap-2">
          {p.lignes
            ? <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={`Règles de « ${p.libelle} »`}>{p.lignes.map((l) => <Ligne key={l.cle} l={l} />)}</ul>
            : <AttenduObtenu attendu={p.attendu} obtenu={p.obtenu} parametresActuels={p.parametresActuels} />}
          {p.lien && <a href={p.lien} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-brand-ink">{p.lien}<span className="sr-only"> (nouvel onglet)</span></a>}
          {p.detail && <p className="m-0 whitespace-pre-wrap text-sm text-ink-2">{p.detail}</p>}
          {p.passages && p.passages.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Passages en cause">
              {p.passages.map((x, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <span className="text-xs text-ink-2">
                    {x.etiquette ? `${x.etiquette} · ` : ""}{x.ou === "source" ? "dans la source" : "dans l'article"}
                  </span>
                  <blockquote className="m-0 border-l-2 border-line-2 pl-3 font-serif text-sm text-ink">{x.texte}</blockquote>
                </li>
              ))}
            </ul>
          )}
          <ALaGeneration ecarts={p.aLaGeneration} />
          {p.pied && <p className="m-0 text-xs text-ink-3">{p.pied}</p>}
        </div>
      </Carte>
    </li>
  );
}

const Liste = ({ ps, focus }: { ps: Preuve[]; focus?: string }) => (
  <ul className="m-0 flex list-none flex-col gap-3 p-0">
    {ps.map((p) => <Entree key={p.cle} p={p} enAvant={p.cle === focus || !!p.lignes?.some((l) => l.cle === focus)} />)}
  </ul>
);
const contient = (ps: Preuve[], focus?: string) => !!focus && ps.some((p) => p.cle === focus || !!p.lignes?.some((l) => l.cle === focus));

export function Preuves({ article, settings = null, sansIllustration = false, focus }: PreuvesProps) {
  const preuves = useMemo(() => preuvesDe(article, settings, { sansIllustration }), [article, settings, sansIllustration]);
  const lecture = useMemo(() => lecturePreuves(preuves), [preuves]);
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(idPreuve(focus));
    if (el) { el.scrollIntoView({ block: "nearest" }); el.focus({ preventScroll: true }); }
  }, [focus, preuves]);

  if (!preuves.length) return <Vide compact titre="Aucune règle à prouver" message="Cet article ne porte aucune règle contrôlée." />;
  const { verdict, nonConformes, aVerifier, familles, nonMesures } = lecture;
  const tete = verdictPreuves(verdict);
  return (
    <section aria-label="Preuves" className="flex flex-col gap-3">
      {verdict.bloquants > 0
        ? <Message ton="avertissement" titre={tete}>Les règles non conformes bloquent la parution.</Message>
        : verdict.aVerifier > 0
          ? <Message ton="info" titre={tete}>Les écarts à vérifier ne bloquent pas la parution.</Message>
          : <Message ton="succes" titre={tete}>Toutes les règles mesurées sont tenues.</Message>}

      {nonConformes.length > 0 && (
        <section aria-label="Non conformes" className="flex flex-col gap-2">
          <h4 className="m-0 text-xs font-semibold uppercase text-ink-2">Non conformes ({nonConformes.length})</h4>
          <Liste ps={nonConformes} focus={focus} />
        </section>
      )}
      {aVerifier.length > 0 && (
        <section aria-label="À vérifier" className="flex flex-col gap-2">
          <h4 className="m-0 text-xs font-semibold uppercase text-ink-2">À vérifier ({aVerifier.length})</h4>
          <Liste ps={aVerifier} focus={focus} />
        </section>
      )}

      {familles.map((f) => (
        <details key={f.famille} open={contient(f.preuves, focus)} className="flex flex-col gap-2">
          <summary className="cursor-pointer text-sm font-semibold text-ink">
            {f.libelle} · {f.preuves.length} conforme{f.preuves.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2"><Liste ps={f.preuves} focus={focus} /></div>
        </details>
      ))}

      {nonMesures.length > 0 && (
        <details open={contient(nonMesures.flatMap((g) => g.preuves), focus)} className="text-ink-3">
          <summary className="cursor-pointer text-xs">
            Non mesuré ({verdict.nonMesures}) : {nonMesures.flatMap((g) => g.preuves).map((p) => p.libelle.toLowerCase()).join(" · ")}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-xs">
            {nonMesures.map((g) => (
              <li key={g.motif}>
                <span className="font-semibold">{g.motif.charAt(0).toUpperCase() + g.motif.slice(1)} : </span>
                {g.preuves.map((p, i) => (
                  <span key={p.cle} id={idPreuve(p.cle)} tabIndex={-1} aria-current={p.cle === focus ? "true" : undefined}
                    className={p.cle === focus ? "rounded-m3 outline-2 outline-brand outline-offset-2" : undefined}>
                    {i > 0 ? ", " : ""}{p.libelle} ({p.regle})
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
