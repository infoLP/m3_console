// Règles pures de la liste noire d'adresses IP (M3-44) : ce que l'onglet
// Sécurité décide avant d'appeler le serveur. Le serveur revérifie tout
// (src/lib/ipBan.js) : ceci n'évite qu'un aller-retour et dit pourquoi.

export interface Bannissement {
  ip: string;
  bannedAt: string;
  reason: "auto" | "manuel" | string;
  failures: number;
  logins: string[];
  bannedBy: string | null;
  note: string | null;
}

export interface ListeNoire {
  bans: Bannissement[];
  /* L'adresse de la personne qui regarde, telle que le serveur la voit (null :
     inconnue). Affichée pour qu'un administrateur sache ce qu'il ne doit pas
     bannir — et qu'il ne pourra pas bannir. */
  selfIp: string | null;
  threshold: number;
  windowHours: number;
  trustedProxies: string[];
  exempt: string[];
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+(:\d{1,3}(\.\d{1,3}){3})?$/i;

/* Une adresse seule (pas de plage) : v4 stricte, ou v6 plausible. */
export function adresseValide(brut: string): boolean {
  const s = brut.trim();
  if (IPV4.test(s)) return true;
  return s.includes(":") && IPV6.test(s) && (s.match(/::/g) || []).length <= 1;
}

/* Raison de refuser un bannissement à la main, ou null. */
export function refusBannissement(brut: string, liste: Pick<ListeNoire, "bans" | "selfIp">): string | null {
  const s = brut.trim();
  if (!s) return "Saisissez une adresse IP.";
  if (!adresseValide(s)) return "Adresse IP invalide (une adresse seule, pas une plage).";
  if (liste.selfIp && s.toLowerCase() === liste.selfIp.toLowerCase()) return "C’est votre propre adresse : vous vous fermeriez la porte.";
  if (liste.bans.some((b) => b.ip === s.toLowerCase())) return "Cette adresse est déjà dans la liste noire.";
  return null;
}

export function libelleMotif(b: Bannissement): string {
  if (b.reason === "auto") return `automatique — ${b.failures} refus`;
  return `à la main${b.bannedBy ? ` — ${b.bannedBy}` : ""}`;
}
