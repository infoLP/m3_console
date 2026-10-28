"use client";

// Page d'erreur qui se diagnostique (M3-108, axe T2) : commune aux quatre
// error.tsx. Elle sonde /api/health toutes les 5 s pour dire si le service est
// en cause, relit la page d'elle-même quand il revient, et donne une référence
// à transmettre — le digest de Next s'il existe, sinon celle de la sonde, qui
// mène à la ligne « service dégradé » du journal serveur.
// Les décisions (quand relancer, quel texte) sont dans sante.regles.js.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PageErreur } from "@/composants/primitives";
import { apresSonde, INTERVALLE_SONDE_MS, lignesDetail, messageSonde, SONDE_INITIALE } from "./sante.regles.js";

type ReponseSante = {
  ok: boolean;
  etat: "ok" | "degrade";
  ref: string;
  at: string;
  base?: { ok: boolean; latenceMs: number | null };
  migrations?: { appliquees: number; attendues: number; manquantes: string[] } | null;
  tables?: { nom: string; ok: boolean }[] | null;
  config?: { baseConfiguree: boolean; planificateurCoupe: boolean; connexionMotDePasse: string; worker: string } | null;
};

export type SondeErreurProps = {
  error: Error & { digest?: string };
  retry: () => void;
  retour: { href: string; libelle: ReactNode };
  autonome?: boolean;
};

/* Erreurs déjà relancées sur un « premier ok » : le composant est remonté à
   chaque nouvelle erreur, la mémoire doit donc vivre hors de lui, sans quoi une
   erreur qui se reproduit relancerait toutes les 5 s. */
const relancees = new Set<string>();
const EXPLICATION = "Une erreur s'est produite de notre côté. Réessayer suffit souvent ; sinon, transmettez la référence ci-dessous.";
const cleErreur = (e: Error & { digest?: string }) => e.digest || `${e.name}:${e.message}`;

export function SondeErreur({ error, retry, retour, autonome = false }: SondeErreurProps) {
  const [reponse, setReponse] = useState<ReponseSante | false | null>(null);
  const [refDegradee, setRefDegradee] = useState<string | null>(null);
  const [relance, setRelance] = useState(false);
  const remontee = useRef(false);

  /* Remontée au journal serveur, une fois, comme RemonteeErreurs. */
  useEffect(() => {
    if (remontee.current) return;
    remontee.current = true;
    fetch("/api/client-error", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, digest: error.digest, page: location.pathname }),
    }).catch(() => {});
  }, [error]);

  useEffect(() => {
    const cle = cleErreur(error);
    let etat = { ...SONDE_INITIALE, dejaRelancee: relancees.has(cle) };
    let actif = true;
    let enCours = false;
    const sonder = async () => {
      if (enCours) return;
      enCours = true;
      let r: ReponseSante | false = false;
      try {
        /* Un 503 porte aussi un corps JSON : seul un échec réseau ou un corps
           illisible donne `false`. */
        r = (await (await fetch("/api/health", { cache: "no-store" })).json()) as ReponseSante;
      } catch { r = false; }
      enCours = false;
      if (!actif) return;
      setReponse(r);
      if (r && r.etat === "degrade") setRefDegradee(r.ref);
      const suite = apresSonde(etat, r ? r.ok === true : false);
      etat = suite.etat;
      if (suite.relancer) {
        relancees.add(cle);
        setRelance(true);
        retry();
      } else setRelance(false);
    };
    void sonder();
    const id = setInterval(sonder, INTERVALLE_SONDE_MS);
    return () => { actif = false; clearInterval(id); };
  }, [error, retry]);

  /* La référence d'une sonde dégradée est la seule qui mène à une ligne de
     journal : on la garde tant qu'il n'y a pas de digest. */
  const digest = error.digest || refDegradee || (reponse ? reponse.ref : undefined);
  const message = messageSonde(reponse, relance);
  const lignes = lignesDetail(reponse || null);
  const connecte = !!(reponse && reponse.base);

  /* L'état de la sonde va dans l'explication, donc DANS la carte : PageErreur
     n'a pas d'autre emplacement, et un Message (div) n'a pas sa place dans le
     <p> de l'explication. La région live est rendue dès le premier affichage,
     pour que ses changements soient annoncés. */
  return (
    <PageErreur
      explication={<>
        {EXPLICATION}{" "}
        <strong role="status" aria-live="polite">{message.texte}</strong>
      </>}
      digest={digest}
      onReessayer={retry}
      retour={retour}
      autonome={autonome}
      connecte={connecte}
      detail={lignes.length > 0 && (
        <ul>
          {lignes.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    />
  );
}
