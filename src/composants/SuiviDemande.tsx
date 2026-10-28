"use client";

// SuiviDemande (T17) : suit une demande déposée au moteur (table `jobs`) après
// un 202 — régénération, publication, récolte. Relit la demande jusqu'à sa fin
// (1 s, puis 2 s, puis 5 s), affiche son état, et rend la demande close à
// `onFinie`. La lecture est passée en prop (`lire`, en général l'action
// lireDemande de src/suivreDemande) : le composant ne connaît pas le serveur.

import { useEffect, useRef, useState } from "react";
import type { Resultat } from "@/resultat";
import { etatDemande, estFinie, delaiSondage, LIBELLE_ETAT, TON_ETAT, type Demande } from "@/suivreDemande/suivreDemande.regles";
import { Etiquette } from "./Etiquette";
import { Message } from "./Message";

export type SuiviDemandeProps = {
  id: number;
  lire: (id: number) => Promise<Resultat<Demande>>;
  libelle?: string;
  onFinie?: (demande: Demande) => void;
  className?: string;
};

export function SuiviDemande({ id, lire, libelle, onFinie, className }: SuiviDemandeProps) {
  const [demande, setDemande] = useState<Demande | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const fini = useRef(onFinie);
  useEffect(() => { fini.current = onFinie; }, [onFinie]);

  useEffect(() => {
    let actif = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let tentative = 0;
    const relire = async () => {
      const r = await lire(id);
      if (!actif) return;
      if (!r.ok) {
        setErreur(r.erreur);
        if (r.status === 404) return;   // demande purgée ou id faux : inutile d'insister
      } else {
        setErreur(null);
        setDemande(r.data);
        if (estFinie(r.data)) { fini.current?.(r.data); return; }
      }
      minuteur = setTimeout(relire, delaiSondage(tentative++));
    };
    relire();
    return () => { actif = false; clearTimeout(minuteur); };
  }, [id, lire]);

  const etat = demande ? etatDemande(demande) : "attente";
  return (
    <div className={className} aria-live="polite">
      <Etiquette ton={TON_ETAT[etat]}>{libelle ? `${libelle} : ` : ""}{LIBELLE_ETAT[etat]}</Etiquette>
      {demande?.error && <Message ton="erreur">{demande.error}</Message>}
      {erreur && <Message ton="avertissement">Suivi interrompu : {erreur}</Message>}
    </div>
  );
}
