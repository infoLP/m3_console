"use client";

// Sous-navigation de l'onglet Sources (M3-120) : Sources | Concurrents, selon
// les droits du compte (sousOngletsSources). Un seul sous-onglet : rien à choisir,
// rien n'est affiché.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icone } from "@/composants/Icone";
import { sousOngletsSources } from "@/gererConcurrents/gererConcurrents.regles";

export function SousNavSources({ role }: { role: string }) {
  const pathname = usePathname();
  const onglets = sousOngletsSources(role);
  if (onglets.length < 2) return null;
  return (
    <nav className="bo-puces" aria-label="Sous-onglets de Sources">
      {onglets.map(([href, libelle, icone]) => {
        const actif = pathname === href;
        return (
          <Link key={href} href={href} className="bo-puce" aria-current={actif ? "page" : undefined} aria-pressed={actif}>
            <Icone nom={icone} size={13} /> {libelle}
          </Link>
        );
      })}
    </nav>
  );
}
