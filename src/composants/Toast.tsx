"use client";

// Le toast de la console et du back-office (classe cr-toast de base.css) :
// flash(message, erreur ?, icône ?) l'affiche 2,6 s. L'icône par défaut dit le
// verdict ; la console en passe d'autres (Send, Archive, RotateCcw, Gauge) pour
// dire le geste.
//
// Accessibilité : un lecteur d'écran n'annonce que ce qui CHANGE dans une région
// live déjà présente. Les deux régions sont donc rendues en permanence, vides au
// repos, et le toast naît dedans : `status` (poli) pour une confirmation,
// `alert` (assertif) pour une erreur — flash() sait la distinguer par `erreur`.
// Vides, elles ne dessinent rien : le toast lui-même est en position fixe.

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icone } from "./Icone";

export type Flash = (message: string, erreur?: boolean, icone?: string) => void;
const Ctx = createContext<Flash>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; err: boolean; ic: string; n: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const compteur = useRef(0);
  const flash = useCallback<Flash>((msg, err = false, icone) => {
    /* n : un même message répété remonte un nouveau nœud, donc une nouvelle annonce. */
    setToast({ msg, err, ic: icone || (err ? "XCircle" : "Check"), n: ++compteur.current });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const rendu = toast && (
    <div key={toast.n} className={`cr-toast${toast.err ? " err" : ""}`}>
      <span className="ic" aria-hidden="true"><Icone nom={toast.ic} size={16} /></span>{toast.msg}
    </div>
  );
  return (
    <Ctx.Provider value={flash}>
      {children}
      <div role="status" aria-live="polite">{toast && !toast.err && rendu}</div>
      <div role="alert" aria-live="assertive">{toast && toast.err && rendu}</div>
    </Ctx.Provider>
  );
}

export const useFlash = () => useContext(Ctx);
