// Règles pures des cibles de publication WordPress (M3-53) : ce que l'onglet
// Publication décide avant d'appeler le serveur. Le serveur revérifie tout
// (src/lib/wpTargets.js, validateTarget) : ceci n'évite qu'un aller-retour et dit pourquoi.

export type StatutArrivee = "draft" | "publish";
export type Greffon = "none" | "yoast" | "rankmath";

export interface CiblePublique {
  id: number;
  name: string;
  url: string;
  wpUser: string;
  secretHint: string;
  seoPlugin: Greffon;
  createCategories: boolean;
  publishStatus: StatutArrivee;
  isDefault: boolean;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EtatPublication {
  targets: CiblePublique[];
  /* Interrupteur général, posé par l'environnement (M3_PUBLISH_MODE) : « simulated »
     tant que personne ne l'a changé. */
  mode: "simulated" | "wordpress";
  envConfigured: boolean;
  secretsAvailable: boolean;
  simulatedTarget: string | null;
}

export interface Saisie {
  name: string;
  url: string;
  wpUser: string;
  password: string;
  seoPlugin: Greffon;
  publishStatus: StatutArrivee;
  createCategories: boolean;
  isDefault: boolean;
}

export interface ResultatTest {
  ok: boolean;
  name: string | null;
  roles: string[];
  canPost: boolean;
  message: string;
}

export const GREFFONS: ReadonlyArray<readonly [Greffon, string]> = [
  ["none", "Aucun greffon SEO"],
  ["yoast", "Yoast SEO"],
  ["rankmath", "Rank Math"],
];

export const STATUTS: ReadonlyArray<readonly [StatutArrivee, string]> = [
  ["draft", "Brouillon (un humain met en ligne dans WordPress)"],
  ["publish", "Mise en ligne directe"],
];

export const SAISIE_VIDE: Saisie = {
  name: "", url: "", wpUser: "", password: "", seoPlugin: "none", publishStatus: "draft", createCategories: false, isDefault: false,
};

export const PASSWORD_MIN = 8;

export function saisieDe(c: CiblePublique): Saisie {
  return {
    name: c.name, url: c.url, wpUser: c.wpUser, password: "", seoPlugin: c.seoPlugin,
    publishStatus: c.publishStatus, createCategories: c.createCategories, isDefault: c.isDefault,
  };
}

/* Même règle que le serveur : http(s), sans identifiant ni paramètre. */
export function adresseValide(brut: string): boolean {
  try {
    const u = new URL(brut.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/* Raison de refuser la saisie, ou null. `creation` : le mot de passe est obligatoire ;
   à la modification, vide = on garde l'ancien. */
export function refusSaisie(s: Saisie, { creation }: { creation: boolean }): string | null {
  const nom = s.name.trim();
  if (nom.length < 2) return "Nom trop court (2 caractères au moins).";
  if (nom.length > 80) return "Nom trop long (80 caractères au plus).";
  if (!adresseValide(s.url)) return "Adresse invalide : http:// ou https://, sans identifiant ni paramètre.";
  if (!s.wpUser.trim()) return "Compte WordPress requis.";
  const mdp = s.password.trim();
  if (creation && !mdp) return "Mot de passe d'application requis.";
  if (mdp && mdp.length < PASSWORD_MIN) return `Mot de passe d'application trop court (${PASSWORD_MIN} caractères au moins).`;
  return null;
}

export function libelleArrivee(s: StatutArrivee): string {
  return s === "publish" ? "mise en ligne directe" : "brouillon";
}

export function libelleGreffon(g: Greffon): string {
  return GREFFONS.find(([id]) => id === g)?.[1] ?? g;
}

/* Ce que l'administrateur doit savoir avant de croire que « ça part ». Chaque
   ligne est une situation où l'on pourrait se tromper sans qu'aucune erreur ne le dise. */
export function avertissements(e: EtatPublication): string[] {
  const out: string[] = [];
  const actives = e.targets.filter((t) => t.active);
  if (e.mode === "simulated") {
    out.push("La publication est simulée : aucun article ne part vers WordPress, quelles que soient les cibles ci-dessous. Pour l'activer, l'exploitant règle M3_PUBLISH_MODE=wordpress puis relance la pile.");
  } else if (!actives.length && !e.envConfigured) {
    out.push("La publication WordPress est activée (M3_PUBLISH_MODE=wordpress) mais aucune cible active n'existe : toute parution sera refusée.");
  } else if (actives.length > 1 && !actives.some((t) => t.isDefault)) {
    out.push("Plusieurs cibles actives et aucune par défaut : toute parution sera refusée tant qu'une cible n'est pas désignée par défaut.");
  }
  if (!e.secretsAvailable) {
    out.push("M3_SECRET_KEY n'est pas définie : un mot de passe d'application ne peut être ni enregistré ni relu.");
  }
  if (e.mode === "wordpress" && actives.some((t) => t.isDefault && t.publishStatus === "publish")) {
    out.push("La cible par défaut met les articles en ligne directement, sans relecture dans WordPress.");
  }
  return out;
}
