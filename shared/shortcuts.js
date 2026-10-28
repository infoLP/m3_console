/* Raccourcis clavier de la console — définition unique, partagée.

   Le serveur en a besoin pour valider les réglages du back-office, le client pour
   les appliquer et pour afficher l'aide-mémoire. Une seule liste : deux copies
   finiraient par diverger, et la divergence se verrait sous la forme d'une touche
   qui ne fait rien.

   DEUX NIVEAUX DE RÉGLAGE, et leur arbitrage tient en une phrase :
   l'administrateur BORNE, l'utilisateur AJUSTE DANS CES BORNES. Le back-office
   peut couper le clavier pour tout le monde, interdire les décisions au clavier,
   et décider quelles actions exigent une double frappe. Chacun choisit ensuite ses
   touches et désactive celles dont il ne veut pas — jamais l'inverse. Un
   utilisateur ne peut pas se rouvrir ce que l'administrateur a fermé. */

export const ACTIONS = [
  { id: "next",    label: "Article suivant dans la file", defaut: "j", alt: "ArrowDown", decision: false, risque: false },
  { id: "prev",    label: "Article précédent",            defaut: "k", alt: "ArrowUp",   decision: false, risque: false },
  { id: "reai",    label: "Renvoyer à l'IA",              defaut: "r", decision: true,  risque: false },
  { id: "requeue", label: "Remettre dans la file",        defaut: "f", decision: true,  risque: false },
  { id: "pub",     label: "Envoyer en parution",          defaut: "p", decision: true,  risque: true },
  { id: "arch",    label: "Classer sans diffusion",       defaut: "c", decision: true,  risque: true },
];

/* Touches qu'on ne peut pas s'attribuer : elles ont déjà un rôle que remplacer
   casserait plus que ça n'arrangerait. */
export const RESERVEES = new Set(["?", "escape", "enter", "tab", " "]);

/* Normalisation : une touche est comparée en minuscules, sauf les touches
   nommées (ArrowDown…) qui gardent leur casse. `e.key` rend « J » quand Maj est
   enfoncée — sans ça, un raccourci cesserait de marcher en majuscules. */
export const normKey = (k) => (typeof k === "string" && k.length === 1 ? k.toLowerCase() : k);

export const CONFIRM_MODES = ["risquees", "toutes", "aucune"];

/* Résout ce qui s'applique RÉELLEMENT, à partir des réglages serveur et des
   préférences de poste. Rend une Map touche → action, plus de quoi afficher
   l'aide-mémoire. Volontairement pure : même fonction côté écran de réglage et
   côté gestionnaire de touches, donc ce qu'on montre est ce qui s'applique. */
export function resolveShortcuts(settings = {}, prefs = {}) {
  const admisGlobal = settings.keys_enabled !== "non";
  const admisDecisions = settings.keys_decisions !== "non";
  const confirm = CONFIRM_MODES.includes(settings.keys_confirm) ? settings.keys_confirm : "risquees";

  const perso = prefs.keys || {};
  const coupees = new Set(prefs.keysOff || []);
  const actifPerso = prefs.keysEnabled !== false;

  const out = [];
  for (const a of ACTIONS) {
    const bornePar = !admisGlobal ? "clavier désactivé pour tous"
      : a.decision && !admisDecisions ? "décisions au clavier désactivées"
      : null;
    const coupe = coupees.has(a.id);
    const touche = normKey(perso[a.id] || a.defaut);
    out.push({
      ...a,
      touche,
      /* Une action n'est active que si rien ne la borne, que l'utilisateur ne
         l'a pas coupée, et que son interrupteur général est levé. */
      actif: !bornePar && !coupe && actifPerso,
      bornePar,
      coupe,
      arme: confirm === "toutes" || (confirm === "risquees" && a.risque),
    });
  }

  /* Conflit : deux actions actives sur la même touche. On garde la première et
     on signale l'autre plutôt que d'en laisser une silencieusement morte. */
  const vues = new Map();
  for (const a of out) {
    if (!a.actif) continue;
    if (vues.has(a.touche)) { a.actif = false; a.conflit = vues.get(a.touche); continue; }
    vues.set(a.touche, a.id);
  }

  return { actions: out, parTouche: vues, actifGlobal: admisGlobal && actifPerso };
}

/* Validation d'une touche saisie par l'utilisateur. Rend null si elle convient,
   sinon la raison — affichée telle quelle dans l'écran de réglage. */
export function validerTouche(key, actionId, actions) {
  const k = normKey(key);
  if (!k) return "touche vide";
  if (RESERVEES.has(typeof k === "string" ? k.toLowerCase() : k)) return "touche réservée";
  if (typeof k === "string" && k.length > 1 && !/^Arrow(Up|Down|Left|Right)$/.test(k)) return "touche non prise en charge";
  const pris = actions.find((a) => a.id !== actionId && a.actif && a.touche === k);
  return pris ? `déjà utilisée par « ${pris.label} »` : null;
}
