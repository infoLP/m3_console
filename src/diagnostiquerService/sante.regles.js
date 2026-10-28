/* Santé du service (M3-108, axe T2) — règles pures, sans aucun import.

   Partagées par le gestionnaire serveur (sante.js) et par la sonde des pages
   d'erreur (SondeErreur.tsx) : ce fichier part donc aussi dans le navigateur,
   d'où l'absence de toute dépendance Node. Tout ce qui se décide ici se teste
   sans base (diagnostiquerService.test.ts). */

/* Les tables sans lesquelles l'application ne tient pas debout. Une table
   absente alors que les migrations sont toutes passées signale une base
   restaurée à moitié : c'est précisément ce qu'on veut voir. */
export const TABLES_ATTENDUES = ["articles", "kv_documents", "settings", "users", "sessions", "journal", "jobs"];

export const INTERVALLE_SONDE_MS = 5_000;

/* Le worker sonde la file toutes les cinq secondes : une demande qui attend
   depuis cinq minutes veut dire qu'il ne tourne plus. Une demande traitée dans
   les dernières 24 h suffit à le dire actif — les demandes sont rares (un clic
   du back-office), une fenêtre plus courte le dirait « inconnu » presque
   toujours. */
export const ATTENTE_WORKER_MS = 5 * 60_000;
export const RECENCE_WORKER_MS = 24 * 3_600_000;

export const ROLE_ADMINISTRATEUR = "administrateur";

/* Sans 0/O ni 1/I/L : la référence se dicte au téléphone et se recopie à la
   main depuis une capture d'écran. */
const ALPHABET_REF = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const deux = (n) => String(n).padStart(2, "0");

/* « S-20261015-143205-K7QM » : l'horodatage (UTC, comme le journal) situe la
   ligne de log à la seconde, le suffixe départage deux appels de la même
   seconde. Ce n'est pas un secret : Math.random suffit. */
export function fabriquerRef(date = new Date(), alea = Math.random) {
  const jour = `${date.getUTCFullYear()}${deux(date.getUTCMonth() + 1)}${deux(date.getUTCDate())}`;
  const heure = `${deux(date.getUTCHours())}${deux(date.getUTCMinutes())}${deux(date.getUTCSeconds())}`;
  let suffixe = "";
  for (let i = 0; i < 4; i++) suffixe += ALPHABET_REF[Math.floor(alea() * ALPHABET_REF.length) % ALPHABET_REF.length];
  return `S-${jour}-${heure}-${suffixe}`;
}

export const FORME_REF = /^S-\d{8}-\d{6}-[A-HJKMNP-Z2-9]{4}$/;

/* Dégradé dès que la base ne répond pas, qu'une migration manque ou qu'une
   table attendue est absente. Une mesure qu'on n'a pas pu faire (null) compte
   comme un manque : on ne déclare pas sain ce qu'on n'a pas vérifié. */
export function calculerEtat({ base, migrations, tables } = {}) {
  if (!base?.ok) return "degrade";
  if (!migrations || migrations.manquantes.length > 0) return "degrade";
  if (!Array.isArray(tables) || tables.some((t) => !t.ok)) return "degrade";
  return "ok";
}

/* Qui demande : sans session, rien que l'état ; connecté, les mesures ; seul
   l'administrateur voit la configuration. Le rôle est celui que le pont
   transmet (« Voir comme » compris) : un administrateur qui se regarde en
   relecteur voit ce que voit un relecteur. */
export function niveauDe(user, role) {
  if (!user) return "public";
  return role === ROLE_ADMINISTRATEUR ? "administrateur" : "connecte";
}

/* Le filtrage se fait par liste blanche : un champ ajouté au rapport complet
   ne part vers personne tant qu'on ne l'a pas rangé ici. */
export function filtrerParNiveau(rapport, niveau) {
  /** @type {{ ok: boolean, etat: string, ref: string, at: string, base?: any, migrations?: any, tables?: any, config?: any }} */
  const out = { ok: rapport.ok, etat: rapport.etat, ref: rapport.ref, at: rapport.at };
  if (niveau === "public") return out;
  out.base = rapport.base ?? { ok: false, latenceMs: null };
  out.migrations = rapport.migrations ?? null;
  out.tables = rapport.tables ?? null;
  if (niveau === "administrateur") out.config = rapport.config ?? null;
  return out;
}

/* Le worker n'est pas visible depuis le web : son battement est un fichier
   dans SON conteneur. On le déduit de la file `jobs`. */
export function etatWorker({ plusAncienneAttente, dernierTraitement } = {}, maintenant = Date.now()) {
  const t = (v) => (v == null ? null : new Date(v).getTime());
  const attente = t(plusAncienneAttente);
  if (attente != null && maintenant - attente > ATTENTE_WORKER_MS) return "en attente";
  const traite = t(dernierTraitement);
  if (traite != null && maintenant - traite <= RECENCE_WORKER_MS) return "actif";
  return "inconnu";
}

/* ------------------------------------------------- sonde des pages d'erreur */

/* État de la sonde : `vu` est ce que la dernière réponse disait (« aucune »
   avant la première), `dejaRelancee` dit si cette erreur a déjà eu sa relance
   « premier ok » (mémorisée hors du composant, qui est remonté à chaque
   nouvelle erreur). `sain` est le champ `ok` de /api/health, false si la sonde
   n'a pas abouti. */
export const SONDE_INITIALE = { vu: "aucune", dejaRelancee: false };

export function apresSonde(etat, sain) {
  if (!sain) return { etat: { ...etat, vu: "degrade" }, relancer: false };
  /* Retour à la normale après une panne vue : c'est très probablement elle qui
     a fait tomber la page, on relit. Une fois par retour, puisque `vu` passe à
     « ok ». */
  if (etat.vu === "degrade") return { etat: { vu: "ok", dejaRelancee: true }, relancer: true };
  /* Service sain dès la première sonde : l'erreur vient d'ailleurs. Une seule
     tentative, sinon une erreur qui se reproduit relancerait toutes les 5 s. */
  if (etat.vu === "aucune") return { etat: { vu: "ok", dejaRelancee: true }, relancer: !etat.dejaRelancee };
  return { etat, relancer: false };
}

/* Le texte affiché sous la carte. `reponse` est la dernière réponse de
   /api/health, null avant la première, false si la sonde n'a pas abouti. */
export function messageSonde(reponse, relance) {
  if (relance) return { ton: "info", texte: "Service rétabli, rechargement…" };
  if (reponse === null || reponse === undefined) return { ton: "info", texte: "Vérification de l'état du service…" };
  if (reponse === false || !reponse.ok) return { ton: "avertissement", texte: `Service dégradé, nouvelle vérification dans ${INTERVALLE_SONDE_MS / 1000} s` };
  if (reponse.etat === "degrade") return { ton: "avertissement", texte: "Service partiellement dégradé : la base répond, mais l'installation est incomplète." };
  return { ton: "info", texte: "Le service répond normalement : l'erreur vient de cette page. Réessayez, ou transmettez la référence." };
}

const ouiNon = (v) => (v ? "oui" : "non");

/* Le détail technique, ligne par ligne, pour la zone réservée aux connectés.
   Rien si la réponse n'en porte pas (sans session, elle n'a pas `base`). */
export function lignesDetail(reponse) {
  if (!reponse || !reponse.base) return [];
  const l = [];
  const b = reponse.base;
  l.push(b.ok ? `Base : joignable (${b.latenceMs ?? "?"} ms)` : "Base : injoignable");
  const m = reponse.migrations;
  if (m) {
    l.push(`Migrations : ${m.appliquees}/${m.attendues} appliquées` + (m.manquantes.length ? ` — manquantes : ${m.manquantes.join(", ")}` : ""));
  } else if (b.ok) l.push("Migrations : non vérifiées");
  const t = reponse.tables;
  if (Array.isArray(t)) {
    const absentes = t.filter((x) => !x.ok).map((x) => x.nom);
    l.push(absentes.length ? `Tables absentes : ${absentes.join(", ")}` : `Tables : les ${t.length} attendues sont présentes`);
  } else if (b.ok) l.push("Tables : non vérifiées");
  const c = reponse.config;
  if (c) {
    l.push(`Base configurée : ${ouiNon(c.baseConfiguree)}`);
    l.push(`Planificateur coupé : ${ouiNon(c.planificateurCoupe)}`);
    l.push(`Connexion par mot de passe : ${c.connexionMotDePasse}`);
    l.push(`Worker : ${c.worker}`);
  }
  return l;
}
