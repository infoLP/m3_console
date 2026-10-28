/* Cibles de publication WordPress (M3-53) : le service de production, et les
   handlers de l'onglet Publication du back-office, réservé à l'administrateur.
   La règle est dans src/lib/wpTargets.js, le transport dans src/publish/. */

import { send } from "../lib/http.js";
import { journal } from "../lib/journal.js";
import { can } from "../../shared/model.js";
import { readSettings } from "../lib/yamlStore.js";
import { secretsAvailable } from "../lib/secretBox.js";
import { createWpTargets } from "../lib/wpTargets.js";
import { readPublishMode, readWpConfig } from "../publish/wpConfig.js";
import { enqueue, attendreJob, lireEtatMoteur } from "../lib/demandes.js";

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
  const [settings, etat] = await Promise.all([readSettings(), lireEtatMoteur().catch(() => ({ vivant: false }))]);
  const vivant = !!etat.vivant;
  send(res, 200, {
    targets: await wpTargets.list(),
    /* Interrupteur général : une variable d'environnement DU MOTEUR, jamais un
       réglage d'écran, lue dans moteur/etat (R8, T22c). Moteur arrêté : mode
       inconnu (null) plutôt qu'un mode périmé. */
    moteurVivant: vivant,
    mode: vivant ? (etat.publication?.mode ?? null) : null,
    envConfigured: vivant ? !!etat.publication?.envConfigured : false,
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

/* « Tester la connexion » : demande test_wp_target au moteur (T22), qui déchiffre
   le mot de passe, interroge le site et journalise ; la console attend ≤ 45 s
   et ne voit que le verdict. */
export async function targetTest({ res, role, params, user }) {
  if (reserve(role)) return refus(res);
  const job = await enqueue("test_wp_target", { targetId: String(params[0] ?? "") }, user);
  const fin = await attendreJob(job.id);
  if (fin.error) return send(res, /inconnue/.test(fin.error) ? 404 : 502, { error: fin.error });
  send(res, 200, fin.result);
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
