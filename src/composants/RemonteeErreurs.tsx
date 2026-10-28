"use client";

// Remontée des erreurs du navigateur vers le journal serveur. Une exception qui laisse la page inerte n'a
// sinon de trace que dans la console F12 — c'est-à-dire nulle part une fois
// l'onglet fermé. Plafonnée et dédoublonnée : une image cassée en boucle ne
// doit pas ajouter une panne à la panne.

import { useEffect } from "react";

const PLAFOND = 20;

export function RemonteeErreurs() {
  useEffect(() => {
    let envoyees = 0;
    const vues = new Set<string>();
    const signaler = (type: string, details: Record<string, unknown>) => {
      const empreinte = `${type}|${details.message || ""}|${details.source || ""}:${details.ligne || ""}`;
      if (vues.has(empreinte) || envoyees >= PLAFOND) return;
      vues.add(empreinte);
      envoyees++;
      try {
        fetch("/api/client-error", {
          method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
          body: JSON.stringify({ type, page: location.pathname, agent: navigator.userAgent, ...details }),
        }).catch(() => {});
      } catch { /* rien de plus à tenter */ }
    };
    const surErreur = (e: ErrorEvent | Event) => {
      const cible = e.target as HTMLElement | null;
      if (cible && cible !== (window as unknown as EventTarget) && cible.tagName) {
        return signaler("ressource", { message: `${cible.tagName} non chargé`, source: (cible as HTMLImageElement).src || (cible as HTMLLinkElement).href || "" });
      }
      const ev = e as ErrorEvent;
      signaler("exception", { message: ev.message, source: ev.filename, ligne: ev.lineno, pile: ev.error?.stack });
    };
    const surRejet = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined;
      signaler("promesse", { message: typeof r === "string" ? r : r?.message || String(r), pile: typeof r === "object" ? r?.stack : undefined });
    };
    window.addEventListener("error", surErreur, true);
    window.addEventListener("unhandledrejection", surRejet);
    return () => { window.removeEventListener("error", surErreur, true); window.removeEventListener("unhandledrejection", surRejet); };
  }, []);
  return null;
}
