"use client";

// Une vue de la console qui n'a pas pu s'afficher (M3-108). Rendue sous la
// coque de la console, donc déjà dans .cr ; une panne de la coque elle-même
// remonte à src/app/error.tsx.

import { SondeErreur } from "@/diagnostiquerService/SondeErreur";

export default function ErreurConsole({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SondeErreur error={error} retry={retry} retour={{ href: "/console", libelle: "Retour à la console" }} />;
}
