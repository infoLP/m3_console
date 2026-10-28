"use client";

// PageErreur (M3-106, squelette de l'axe T2 « une page d'erreur qui se
// diagnostique ») : ce qui s'est passé, la référence de l'erreur (digest de
// Next) affichée et copiable pour la remonter, les deux sorties (réessayer,
// revenir), et une zone de détail technique réservée aux connectés.
// `autonome` pose la classe .cr (jetons de base.css) pour une page rendue hors
// de toute coque — global-error.tsx, par exemple.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Bouton } from "./Bouton";
import { cx } from "./cx";
import { Titre } from "./Titre";

export type PageErreurProps = {
  titre?: ReactNode;
  explication?: ReactNode;
  digest?: string;
  onReessayer?: () => void;
  retour?: { href: string; libelle: ReactNode } | null;
  detail?: ReactNode;
  connecte?: boolean;
  autonome?: boolean;
  className?: string;
};

const EXPLICATION = "Une erreur s'est produite de notre côté. Réessayer suffit souvent ; sinon, transmettez la référence ci-dessous.";

export function PageErreur({ titre = "Cette page n'a pas pu s'afficher", explication = EXPLICATION, digest, onReessayer,
  retour = { href: "/", libelle: "Retour à l'accueil" }, detail, connecte = false, autonome = false, className }: PageErreurProps) {
  const [copie, setCopie] = useState<"" | "ok" | "echec">("");
  const copier = async () => {
    try { await navigator.clipboard.writeText(digest ?? ""); setCopie("ok"); } catch { setCopie("echec"); }
  };
  return (
    <main className={cx(autonome && "cr", "ui-page-erreur", className)}>
      <div className="ui-page-erreur-carte">
        <Titre niveau={1} kicker="Erreur">{titre}</Titre>
        <p className="ui-page-erreur-explication">{explication}</p>
        {digest && (
          <div className="ui-page-erreur-ref">
            <span className="ui-page-erreur-ref-libelle">Référence de l&apos;erreur</span>
            <code className="ui-page-erreur-digest">{digest}</code>
            <Bouton variante="discret" taille="petite" icone={copie === "ok" ? "Check" : undefined} onClick={copier}>
              {copie === "ok" ? "Copiée" : "Copier"}
            </Bouton>
            <span role="status" className="ui-sr">{copie === "ok" ? "Référence copiée" : copie === "echec" ? "Copie impossible : sélectionnez la référence à la main" : ""}</span>
          </div>
        )}
        {(onReessayer || retour) && (
          <div className="ui-page-erreur-actions">
            {onReessayer && <Bouton variante="primaire" icone="RotateCcw" onClick={onReessayer}>Réessayer</Bouton>}
            {retour && <Link className="ui-bouton ui-bouton--secondaire ui-bouton--normale" href={retour.href}>{retour.libelle}</Link>}
          </div>
        )}
        {connecte && detail && (
          <details className="ui-page-erreur-detail">
            <summary>Détail technique</summary>
            <div className="ui-page-erreur-detail-corps">{detail}</div>
          </details>
        )}
      </div>
    </main>
  );
}
