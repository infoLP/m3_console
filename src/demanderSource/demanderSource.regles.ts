// Demande d'ajout de source (M3-92) : les champs d'une source du back-office,
// pour que l'administrateur la crée sans ressaisir ; seuls le nom et l'adresse
// sont exigés.

import { parseZoneText } from "@shared/zones.js";

export interface ChampsDemande {
  name: string; url: string; organisation: string; sourceKind: string; type: string;
  commune: string; scopeLevel: string; zone: string; category: string; frequency: string; note: string;
}

export const CHAMPS_VIDES: ChampsDemande = { name: "", url: "", organisation: "", sourceKind: "", type: "", commune: "", scopeLevel: "", zone: "", category: "", frequency: "", note: "" };

export interface Demande extends Omit<ChampsDemande, "zone"> { dept: string; region: string }

/* Rend la demande à envoyer, ou le refus — affiché dans la fenêtre, qui reste
   ouverte : rien de saisi ne se perd sur une adresse mal tapée. */
export function construireDemande(c: ChampsDemande): { demande: Demande } | { erreur: string } {
  const v = (s: string) => String(s ?? "").trim();
  const name = v(c.name), url = v(c.url);
  if (!name || !url) return { erreur: "Le nom et l'adresse de la source sont requis." };
  if (!/^https?:\/\//i.test(url)) return { erreur: "L'adresse doit commencer par http:// ou https://." };
  const zoneTexte = v(c.zone);
  const zone = zoneTexte ? (parseZoneText(zoneTexte) as { dept?: string; region?: string } | null) : { dept: "", region: "" };
  if (!zone) return { erreur: "Zone inconnue : choisissez-la dans la liste, ou laissez le champ vide." };
  return {
    demande: {
      name, url, organisation: v(c.organisation), sourceKind: v(c.sourceKind), type: v(c.type),
      commune: v(c.commune), scopeLevel: v(c.scopeLevel), dept: zone.dept || "", region: zone.region || "",
      category: v(c.category), frequency: v(c.frequency), note: v(c.note),
    },
  };
}
