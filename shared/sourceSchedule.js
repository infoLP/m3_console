/* Planification par source (M3-58) — fonctions pures, partagées backend + navigateur

   Trois questions, posées à chaque récolte pour chaque source :
   - est-elle à l'écart ?   trop d'échecs d'affilée, on la laisse reposer ;
   - est-elle due ?         son intervalle minimal est-il écoulé (récolte planifiée) ;
   - depuis quand lire ?    la fenêtre part de son dernier succès, pas seulement
                            de window_hours — sinon une source interrogée tous les
                            sept jours perdrait tout ce qui a plus de 72 h.

   L'état de chaque source est un petit objet { lastOkAt, lastAttemptAt, failures,
   quarantinedUntil }, rangé dans kv_documents (harvest/sources-state.json). */

const DAY = 86400000;

/* Mise à l'écart : après QUARANTINE_AFTER échecs d'affilée, la source est sautée
   pendant QUARANTINE_MS. Elle est retentée ensuite ; un nouvel échec la remet à
   l'écart aussitôt, un succès remet le compteur à zéro. */
export const QUARANTINE_AFTER = 3;
export const QUARANTINE_MS = DAY;

/* Le texte de `frequency` décrit le RYTHME DE PUBLICATION estimé de la source.
   On en déduit un intervalle d'interrogation nettement plus court que ce rythme :
   une source mensuelle interrogée tous les 30 jours livrerait ses contenus avec
   jusqu'à un mois de retard. Quatre interrogations environ par période de
   publication, et le plus fréquent l'emporte quand le texte en cite deux
   (« hebdomadaire à mensuelle » → hebdomadaire). Texte inconnu → 0 : à chaque
   récolte, comme avant. */
const FREQUENCY_DAYS = [
  [/quotidien|journali|plusieurs fois.{0,3}jour/, 0],
  [/plusieurs fois.{0,3}semaine/, 1],
  [/hebdo|semaine/, 2],
  [/mensuel|mois/, 7],
  [/trimestr/, 14],
  [/semestr|annuel|an\b/, 30],
];

export function frequencyDays(text) {
  const t = String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!t.trim()) return 0;
  for (const [re, days] of FREQUENCY_DAYS) if (re.test(t)) return days;
  return 0;
}

/* Intervalle effectif en jours, et d'où il vient — le back-office l'affiche. */
export function intervalOf(source) {
  const explicit = source && source.intervalDays;
  if (explicit != null && explicit !== "" && Number.isFinite(Number(explicit))) {
    return { days: Math.max(0, Number(explicit)), origin: "saisi" };
  }
  const days = frequencyDays(source && source.frequency);
  return { days, origin: days ? "fréquence" : "défaut" };
}

export function isQuarantined(state, now = Date.now()) {
  return !!(state && state.quarantinedUntil && Date.parse(state.quarantinedUntil) > now);
}

/* Due si jamais réussie, ou si l'intervalle est écoulé depuis le dernier succès.
   Un échec ne repousse pas la prochaine tentative : c'est le rôle de la mise à
   l'écart, pas de l'intervalle. */
export function isDue(source, state, now = Date.now()) {
  const { days } = intervalOf(source);
  if (!days || !state || !state.lastOkAt) return true;
  return now - Date.parse(state.lastOkAt) >= days * DAY;
}

/* Borne basse des contenus à retenir : la plus ancienne de (fenêtre globale,
   dernier succès de la source). Ce qui a déjà été vu est de toute façon écarté
   par harvest/seen.json ; la borne évite seulement d'aller chercher au-delà. */
export function cutoffFor(state, windowHours, now = Date.now()) {
  const windowCut = windowHours > 0 ? now - windowHours * 3600000 : 0;
  if (!windowCut) return 0;
  const lastOk = state && state.lastOkAt ? Date.parse(state.lastOkAt) : NaN;
  return Number.isNaN(lastOk) ? windowCut : Math.min(windowCut, lastOk);
}

/* Nouvel état après une tentative. `quarantined` vaut true au moment précis où
   la source PASSE à l'écart : c'est là, et seulement là, qu'on notifie. */
export function afterAttempt(state, ok, now = Date.now()) {
  const s = { ...(state || {}) };
  s.lastAttemptAt = new Date(now).toISOString();
  if (ok) {
    s.lastOkAt = s.lastAttemptAt;
    s.failures = 0;
    delete s.quarantinedUntil;
    return { state: s, quarantined: false };
  }
  s.failures = (s.failures || 0) + 1;
  if (s.failures >= QUARANTINE_AFTER) {
    s.quarantinedUntil = new Date(now + QUARANTINE_MS).toISOString();
    return { state: s, quarantined: true };
  }
  return { state: s, quarantined: false };
}
