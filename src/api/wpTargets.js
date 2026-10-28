/* Cibles de publication WordPress (M3-53) : le service de production, et les
   handlers de l'onglet Publication du back-office, réservé à l'administrateur.
   La règle est dans src/lib/wpTargets.js, le transport dans src/publish/. */

import { send } from "../lib/http.js";
import { journal } from "../lib/journal.js";
import { can } from "../../shared/model.js";
import { readSettings } from "../lib/yamlStore.js";
import { secretsAvailable } from "../lib/secretBox.js";
import { createWpTargets } from "../lib/wpTargets.js";
import { checkWpTarget } from "../publish/wpCheck.js";
import { readPublishMode, readWpConfig } from "../publish/wpConfig.js";

export const wpTargets = createWpTargets();

const reserve = (role) => !can(role, "manage_users");
const refus = (res) => send(res, 403, { error: "réservé à l'administrateur" });
const qui = (user) => user?.name || user?.login || null;

/* Le journal ne reçoit jamais le mot de passe : l'adresse, le compte et le statut suffisent. */
const trace = (event, t) => journal("action", event, {
  target: t.name, detail: { site: t.url, compte: t.wpUser, statut: t.publishStatus, parDefaut: t.isDefault, actif: t.active },
});

export async function targetsList({ res, role }) {
  if (reserve(role)) return refus(res);
  const settings = await readSettings();
  send(res, 200, {
    targets: await wpTargets.list(),
    /* Interrupteur général : une variable d'environnement, jamais un réglage
       d'écran. Tant qu'il vaut « simulated », aucune cible ne reçoit rien. */
    mode: readPublishMode(settings, process.env),
    envConfigured: readWpConfig(settings, process.env).configured,
    secretsAvailable: secretsAvailable(),
    simulatedTarget: settings.wp_target || null,
  });
}

export async function targetCreate({ res, role, body, user }) {
  if (reserve(role)) return refus(res);
  const t = await wpTargets.create(body || {}, { by: qui(user) });
  trace("Cible WordPress créée", t);
  send(res, 200, { ok: true, target: t });
}

export async function targetUpdate({ res, role, params, body }) {
  if (reserve(role)) return refus(res);
  const t = await wpTargets.update(params[0], body || {});
  trace("Cible WordPress modifiée", t);
  send(res, 200, { ok: true, target: t });
}

export async function targetActivate({ res, role, params, body }) {
  if (reserve(role)) return refus(res);
  const t = await wpTargets.setActive(params[0], body?.active !== false);
  trace(t.active ? "Cible WordPress activée" : "Cible WordPress désactivée", t);
  send(res, 200, { ok: true, target: t });
}

export async function targetRemove({ res, role, params }) {
  if (reserve(role)) return refus(res);
  const r = await wpTargets.remove(params[0]);
  journal("action", "Cible WordPress supprimée", { target: r.name });
  send(res, 200, { ok: true, ...r });
}

export async function targetTest({ res, role, params }) {
  if (reserve(role)) return refus(res);
  const c = await wpTargets.credentials(params[0]);
  const r = await checkWpTarget({ url: c.url, user: c.user, appPassword: c.appPassword });
  journal("action", r.ok ? "Cible WordPress testée : connexion réussie" : "Cible WordPress testée : échec", {
    level: r.ok ? "info" : "warn", target: c.name, detail: { message: r.message },
  });
  send(res, 200, r);
}

/* Où part un article qu'on publie : { mode, target }.
   - mode « simulated » (défaut) : nulle part, le journal des publications seulement ;
   - mode « wordpress » : la cible demandée, sinon la cible par défaut (ou l'unique
     cible active) ; à défaut, la configuration d'environnement M3_WP_* si elle est
     complète ; sinon une erreur 409 qui dit quoi faire — jamais un envoi dans le vide. */
export async function targetForPublish(settings, targetId = null, { env = process.env, targets = wpTargets } = {}) {
  if (readPublishMode(settings, env) !== "wordpress") return { mode: "simulated", target: null };
  const target = await targets.resolveForPublish(targetId);
  if (target) return { mode: "wordpress", target };
  if (readWpConfig(settings, env).configured) return { mode: "wordpress", target: null };
  throw Object.assign(
    new Error("La publication WordPress est activée (M3_PUBLISH_MODE=wordpress), mais aucune cible active n'est enregistrée : en créer une dans l'onglet Publication."),
    { status: 409 }
  );
}
