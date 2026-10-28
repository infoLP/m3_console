// Règles pures de la connexion : ce que legacy/public/login.html décidait dans
// le navigateur. Testées sans Next ni base (seConnecter.test.ts).

export interface Modes {
  local: boolean;
  entra: boolean;
}

/* Qui je suis, avec quels droits : la réponse de GET /api/me. Déclaré ici,
   dans les règles pures, pour que les composants puissent en importer le type
   sans toucher aux lectures (.requetes.ts, réservées au serveur). */
export interface Moi {
  role: string;
  roleLabel: string;
  permissions: Record<string, boolean>;
  roles: { key: string; label: string }[];
  user: { id: string; name: string; login: string; role: string } | null;
  canSwitchRole: boolean;
  scoring: Record<string, number> | null;
  canSeeHome: boolean;
  feats: Record<string, boolean>;
  defaultDept: string | null;
  zonesCovered: string;
  keys: Record<string, string>;
  llmProvider: string;
  llmProviderLabel: string;
  llmModel: string | null;
  llmLastRun: { at: string; provider: string | null; fallbacks: number; error: string | null; cap: unknown } | null;
}

/* D'où l'on vient, pour y retourner après connexion. Uniquement un chemin
   interne : jamais une URL fournie de l'extérieur, qui servirait de tremplin. */
export function cheminInterne(brut: unknown): string {
  const s = String(brut ?? "/").trim() || "/";
  return s === "/" || /^\/[^/\\]/.test(s) ? s : "/";
}

/* Le serveur ne renvoie qu'un code : le texte vit ici, là où il s'affiche.
   Chaque message dit QUOI FAIRE, le diagnostic restant dans logs/. */
const ERREURS_SSO: Record<string, string> = {
  sso_indisponible: "La connexion Windows est momentanément indisponible. Utilisez vos identifiants M3 ci-dessous.",
  sso_refuse: "Microsoft a refusé la connexion. Votre compte n’a peut-être pas accès à M3 : demandez à l’administrateur.",
  sso_expire: "La connexion a pris trop de temps. Recommencez.",
  sso_echec: "La connexion Windows a échoué. Réessayez, ou utilisez vos identifiants M3.",
  sso_inconnu: "Votre compte Windows n’est associé à aucun compte M3. Demandez-en un à l’administrateur.",
  sso_conflit: "Ce compte M3 est déjà associé à une autre identité Windows. Prévenez l’administrateur.",
};

export function messageErreurSso(code: unknown): string | null {
  if (!code) return null;
  return ERREURS_SSO[String(code)] || "La connexion a échoué.";
}

/* Ce que l'écran montre selon les moyens d'entrer : le formulaire, le bouton
   SSO, ou les deux (le mot de passe passe alors en bouton secondaire). Si les
   modes sont inconnus, le formulaire seul : mieux vaut une porte qui marche. */
export function affichage(modes: Modes | null) {
  const m = modes ?? { local: true, entra: false };
  return {
    formulaire: m.local,
    sso: m.entra,
    ou: m.local && m.entra,
    motDePasseSecondaire: m.local && m.entra,
    note: m.local
      ? "Si vous n’avez pas d’identifiant, demandez-en un à l’administrateur."
      : "La connexion par mot de passe est désactivée : utilisez votre compte Windows.",
  };
}

/* Les deux champs sont requis ; le serveur le revérifie (auth.login). */
export function champsConnexion(donnees: { login?: unknown; password?: unknown }): { login: string; password: string } | { erreur: string } {
  const login = String(donnees.login ?? "").trim();
  const password = String(donnees.password ?? "");
  if (!login || !password) return { erreur: "identifiant et mot de passe requis" };
  return { login, password };
}
