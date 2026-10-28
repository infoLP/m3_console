/* Moteur de secours (M3-88) : si le moteur principal échoue — erreur réseau,
   5xx, quota, relances de M3-65 épuisées, modèle refusé —, l'appel est rejoué
   sur le moteur de secours du registre (onglet LLM) avant tout repli mock.

   Le CHOIX des moteurs n'est pas fait ici : principal = moteur actif de
   l'onglet LLM, secours = réglage `llm_fallback_provider`. Ce module ne fait
   que l'enchaînement, sans base ni réseau, pour être testé tel quel. */

/* Un moteur est-il utilisable ? Même critère que pour le moteur actif : une
   clé et un modèle. Le motif sert au journal quand le secours est écarté. */
export function engineIssue(p) {
  if (!p) return "moteur introuvable dans le registre";
  if (p.enabled === false) return "moteur désactivé";
  if (!p.apiKey) return "aucune clé d'API";
  if (!String(p.defaultModel || "").trim()) return "aucun modèle choisi";
  return null;
}

/* Valeur du réglage → identifiant de moteur, ou null pour « aucun ». */
export function fallbackIdOf(setting) {
  const id = String(setting ?? "").trim();
  return id && id !== "aucun" ? id : null;
}

/* Essaie chaque moteur dans l'ordre, rend le premier succès.
   - `call(engine)` : l'appel métier sur ce moteur ;
   - `beforeNext(next)` : appelé avant de passer au moteur suivant ; s'il lève,
     l'enchaînement s'arrête sur cette erreur (plafond de dépense atteint) ;
   - `onFail(engine, err, next)` : chaque échec, pour le journal et les stats.
   → { value, engine, index } ; lève la dernière erreur si tous échouent. */
export async function tryEngines(engines, call, { beforeNext = null, onFail = null } = {}) {
  const list = (engines || []).filter(Boolean);
  if (!list.length) throw new Error("aucun moteur utilisable");
  let lastErr = null;
  for (let i = 0; i < list.length; i++) {
    if (i > 0 && beforeNext) await beforeNext(list[i]);
    try {
      return { value: await call(list[i]), engine: list[i], index: i };
    } catch (err) {
      lastErr = err;
      if (onFail) onFail(list[i], err, list[i + 1] || null);
    }
  }
  throw lastErr;
}

/* Moteur + modèle (M3-88, M3-89) : le réglage de modèle (`llm_fallback_model`,
   `llm_review_model`), s'il est posé, remplace le modèle par défaut du moteur —
   même clé, autre modèle. Vide : le modèle par défaut du moteur, comme avant. */
export function withModel(p, model) {
  const m = String(model ?? "").trim();
  return p && m ? { ...p, defaultModel: m } : p;
}

/* Même moteur ET même modèle que l'actif : le secours rejouerait l'appel qui
   vient d'échouer, ce n'est pas un filet. Même moteur, autre modèle : c'en est un. */
export function sameEngine(a, b) {
  return !!a && !!b && a.id === b.id && String(a.defaultModel || "").trim() === String(b.defaultModel || "").trim();
}

/* Routeurs et alias (openrouter/auto, ~openai/gpt-luna-latest, …-router) : le
   modèle réellement appelé est choisi par la passerelle à chaque appel — coût,
   longueurs et réaction au prompt imprévisibles, et un prompt par modèle
   (M3-56) ne peut pas s'y appliquer. Affichés à part dans l'onglet LLM, exclus
   des moteurs de relance (M3-55). Règle volontairement simple : préfixe « ~ »,
   slug « openrouter/auto* », ou « router » dans le nom du modèle. */
export function estRouteur(model) {
  const m = String(model || "").trim().toLowerCase();
  /* « router » se cherche dans le NOM du modèle, après l'éditeur : sinon tout
     « openrouter/… » (modèles maison d'OpenRouter, qui ne routent pas) y passerait. */
  const nom = m.includes("/") ? m.slice(m.indexOf("/") + 1) : m;
  return !!m && (m.startsWith("~") || m.startsWith("openrouter/auto") || nom.includes("router"));
}
