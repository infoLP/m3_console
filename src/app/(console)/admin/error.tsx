"use client";

// Une page du back-office qui n'a pas pu lire ses données (base injoignable,
// session tombée entre deux pages) — M3-108. Rendue sous la coque, donc déjà
// dans .cr ; une panne de la coque elle-même remonte à src/app/error.tsx.

import { SondeErreur } from "@/diagnostiquerService/SondeErreur";

export default function ErreurAdmin({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SondeErreur error={error} retry={retry} retour={{ href: "/admin", libelle: "Retour au back-office" }} />;
}
