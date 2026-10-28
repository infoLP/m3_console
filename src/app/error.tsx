"use client";

// Erreur rattrapée à la racine (M3-108). Un error.tsx n'enveloppe pas le layout
// de son propre segment : c'est donc ici, et non dans console/ ou admin/, que
// tombe une panne de leur layout (lecture de session, base injoignable). Rendue
// hors de toute coque, d'où `autonome`, qui pose le bloc .cr des jetons.

import { SondeErreur } from "@/diagnostiquerService/SondeErreur";

export default function Erreur({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SondeErreur error={error} retry={retry} retour={{ href: "/", libelle: "Retour à l'accueil" }} autonome />;
}
