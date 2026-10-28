/* Liste blanche des modèles LLM (M3-63).

   Le catalogue `GET /models` d'un fournisseur compte des centaines d'entrées
   (443 chez OpenRouter), aux tarifs séparés par plusieurs ordres de grandeur, et
   toutes étaient sélectionnables au back-office. Un caractère de trop dans un
   identifiant suffisait à facturer un modèle cent fois plus cher — ou à viser un
   modèle qui n'existe pas, et à tout replier sur le mock.

   POURQUOI DANS LE CODE, ET PAS DANS UN RÉGLAGE DU BACK-OFFICE. Le moteur et le
   modèle se changent au back-office sans redéploiement, et c'est voulu. Mais si
   la liste blanche s'y éditait aussi, le même administrateur, sur le même écran,
   pourrait y ajouter l'identifiant fautif d'un clic : le garde-fou ne garderait
   rien. Ajouter un modèle demande donc un commit, c'est-à-dire une relecture. On
   choisit librement PARMI les modèles relus ; on n'en ajoute pas sans relecture.

   Comparaison EXACTE : ni casse ignorée, ni préfixe, ni motif. Un joker du type
   `mistralai/*` rouvrirait précisément ce que la liste ferme — toute la gamme
   d'un éditeur, y compris ses modèles les plus chers.

   Une liste plate et non une liste par moteur : les identifiants sont déjà
   distincts d'un fournisseur à l'autre (`mistralai/…` chez OpenRouter,
   `claude-…` chez Anthropic), et les moteurs se créent au back-office sous un
   identifiant libre, sur lequel on ne peut pas indexer une liste versionnée.

   Pour ajouter un modèle : l'identifiant EXACT, copié du catalogue du
   fournisseur, avec son prix en commentaire — c'est l'information qui manquait
   au back-office pour choisir. */

export const ALLOWED_MODELS = Object.freeze([
  /* Modèle de référence depuis le passage à OpenRouter (migration 005) : les
     prompts de src/llm/prompts/ ont été écrits et réglés pour lui. */
  "mistralai/mistral-small-2603",
]);

const ALLOWED = new Set(ALLOWED_MODELS);

export function isModelAllowed(model) {
  return typeof model === "string" && ALLOWED.has(model);
}

/* EXEMPTION D'OPENROUTER (M3-68). Les guardrails du compte OpenRouter bornent
   déjà, côté fournisseur, les modèles que notre clé peut appeler : y doubler la
   liste blanche obligeait à un commit pour chaque modèle que les guardrails
   autorisaient déjà. La liste ne s'applique donc plus aux appels qui partent
   vers OpenRouter — sauf `M3_LLM_ALLOWLIST_OPENROUTER` non vide, qui la réactive. Les
   autres moteurs (Anthropic, OpenAI, Google en direct) n'ont pas d'équivalent :
   la liste reste leur seul filtre.

   OpenRouter se reconnaît à l'URL DE BASE, et non au nom ou à l'identifiant du
   moteur, qui se choisissent librement au back-office : c'est l'URL qui décide
   où part l'appel, donc quels guardrails le bornent. Hôte comparé à l'exact et
   HTTPS exigé — `openrouter.ai.exemple.com`, `http://openrouter.ai` ou une URL
   illisible restent sous liste blanche. Par défaut, on filtre.

   L'exemption suppose que la clé enregistrée pour ce moteur est bien celle du
   compte qui porte les guardrails : une clé d'un autre compte OpenRouter ne
   serait bornée par rien. */
export const ALLOWLIST_EXEMPT_HOST = "openrouter.ai";

/* Toute valeur non vide réactive la liste, et pas seulement « 1 » : un réglage
   de sécurité doit échouer du côté prudent. Avec « 1 » seul, un `true`, un `yes`
   ou un `1 ` laissé par un éditeur maintenait l'exemption sans rien dire, à
   l'exploitant qui croyait l'avoir levée. */
export function allowlistApplies(provider) {
  if (String(process.env.M3_LLM_ALLOWLIST_OPENROUTER ?? "").trim() !== "") return true;
  let url;
  try { url = new URL(String(provider?.baseUrl ?? "")); } catch { return true; }
  return !(url.protocol === "https:" && url.hostname === ALLOWLIST_EXEMPT_HOST);
}

/* Le modèle est-il appelable SUR CE MOTEUR ? Exempté, n'importe quel identifiant
   non vide passe : c'est le fournisseur qui fait foi, et un modèle qu'il refuse
   remonte comme un échec d'appel ordinaire (repli mock compté, notification). */
export function isModelAllowedFor(provider, model) {
  if (!allowlistApplies(provider)) return typeof model === "string" && model.trim() !== "";
  return isModelAllowed(model);
}

/* Règle d'ENREGISTREMENT d'un modèle au back-office, pure pour être testée.
   `patch` : les champs envoyés ; `stored` : le moteur tel qu'en base.

   - L'exemption se juge sur l'URL que portera le moteur APRÈS l'enregistrement :
     celle du patch si elle change, sinon celle en base. Juger sur l'ancienne
     laisserait enregistrer, en un seul envoi, un modèle hors liste avec une URL
     qui n'est plus celle d'OpenRouter.
   - Un modèle inchangé reste enregistrable (règle de M3-63) : le formulaire
     renvoie tous ses champs, et refuser la valeur héritée empêcherait de retirer
     une clé ou de renommer le moteur. Il n'en passe pas pour autant : chaque
     appel est contrôlé dans src/llm/index.js. */
export function isModelSavable(patch, stored) {
  const model = patch.defaultModel === null ? null : String(patch.defaultModel ?? "").trim();
  if (!model) return true;
  const baseUrl = patch.baseUrl !== undefined ? String(patch.baseUrl ?? "").trim() : stored?.baseUrl;
  return isModelAllowedFor({ baseUrl }, model) || stored?.defaultModel === model;
}

/* Résout le modèle d'un appel ET le vérifie, en une seule opération.

   La résolution est celle des adaptateurs — le modèle demandé par l'appelant,
   sinon le modèle par défaut du moteur. La faire ici, et passer le résultat
   explicitement à l'adaptateur, garantit que le modèle CONTRÔLÉ est celui qui
   part dans la requête. Contrôler `defaultModel` pendant qu'un `opts.model`
   part sur le réseau serait un contournement — et c'est exactement le chemin
   qu'ouvrira M3-55, qui choisira le moteur et le modèle par run. */
export function resolveAllowedModel(provider, model) {
  const mdl = model || provider?.defaultModel;
  if (!mdl) throw Object.assign(new Error(`Aucun modèle choisi pour « ${provider?.label || "?"} ».`), { status: 400 });
  if (!isModelAllowedFor(provider, mdl)) throw notAllowed(mdl);
  return mdl;
}

/* `consequence` dit ce que le refus empêche : un appel (par défaut) ou, au
   back-office, l'enregistrement du moteur. */
export function notAllowed(model, consequence = "appel refusé avant tout envoi") {
  return Object.assign(
    new Error(`modèle « ${model} » hors liste blanche (src/llm/allowlist.js) — ${consequence}`),
    { status: 400, code: "MODEL_NOT_ALLOWED" }
  );
}
