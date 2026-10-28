"use client";

// Petite modale générique (classes m3-modal de base.css). Échap et le clic
// hors de la carte la ferment ; le clavier global de la console se tait tant
// qu'elle est ouverte (CoqueConsole, `if (c.modale) return`).
// Accessibilité (M3-99) : dialogue modal nommé par son titre ; le focus entre
// à l'ouverture, ne sort pas au clavier (piegeFocus.ts) et revient à l'élément
// d'origine à la fermeture.

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icone } from "@/composants/Icone";
import { cibleTab, FOCUSABLES } from "./piegeFocus";

export function Modale({ titre, onClose, children }: { titre: string; onClose: () => void; children: ReactNode }) {
  const idTitre = useId();
  const carte = useRef<HTMLDivElement>(null);
  const fermer = useRef(onClose);
  useEffect(() => { fermer.current = onClose; });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") fermer.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* À l'ouverture : on retient qui avait le focus, et on le pose sur le premier
     champ ou bouton du contenu (à défaut, le bouton Fermer). À la fermeture,
     il revient d'où il venait. */
  useEffect(() => {
    const origine = document.activeElement as HTMLElement | null;
    const el = carte.current;
    if (el) {
      const corps = el.querySelector<HTMLElement>(`.m3-modal-body :is(${FOCUSABLES})`);
      (corps || el.querySelector<HTMLElement>(FOCUSABLES) || el).focus();
    }
    return () => { if (origine && origine.isConnected) origine.focus(); };
  }, []);

  const pieger = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !carte.current) return;
    const liste = Array.from(carte.current.querySelectorAll<HTMLElement>(FOCUSABLES));
    const i = cibleTab(liste.length, liste.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (i === null) return;
    e.preventDefault();
    liste[i].focus();
  };

  return (
    <div className="m3-modal cr" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="m3-modal-card" ref={carte} role="dialog" aria-modal="true" aria-labelledby={idTitre} tabIndex={-1} onKeyDown={pieger}>
        <div className="m3-modal-h"><h3 id={idTitre}>{titre}</h3><button className="cr-btn ghost m3-modal-x" type="button" onClick={onClose} aria-label="Fermer"><Icone nom="X" size={15} /></button></div>
        <div className="m3-modal-body">{children}</div>
      </div>
    </div>
  );
}
