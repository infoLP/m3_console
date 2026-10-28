"use client";

// Dernier filet (M3-108) : une erreur dans le layout racine lui-même. Next
// remplace alors tout le document — d'où <html> et <body> posés ici — et n'y
// charge pas les styles globaux : on les importe explicitement. Rien ici ne
// dépend du layout racine, qui est justement ce qui a cassé.

import "../../styles/base.css";
import "./globals.css";
import { SondeErreur } from "@/diagnostiquerService/SondeErreur";

export default function ErreurGlobale({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="fr">
      <body>
        <SondeErreur error={error} retry={retry} retour={{ href: "/", libelle: "Retour à l'accueil" }} autonome />
      </body>
    </html>
  );
}
