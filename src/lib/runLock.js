/* Verrou des exécutions longues (M3-58) : récolte et génération ne doivent jamais
   tourner deux fois en même temps. Une récolte lente croisant la suivante, ou un
   clic « Lancer une génération » pendant la run planifiée, traiteraient les mêmes
   contenus deux fois — deux articles, deux factures LLM.

   Un BAIL en base plutôt qu'un verrou en mémoire : il vaut entre le serveur web
   et un `npm run daily` lancé à la main, qui sont deux processus. Plutôt qu'un
   verrou consultatif PostgreSQL : celui-ci exigerait de garder une connexion
   dédiée ouverte pendant toute la run. Le bail expire seul (`ttlMs`) : un
   processus tué en pleine run ne bloque pas tout jusqu'à une intervention. */

import { randomUUID } from "node:crypto";
import { query } from "./db.js";
import { enRoutine } from "./routineContext.js";

const key = (name) => `locks/${name}.json`;

/* Prend le bail s'il est libre ou expiré. Rend un jeton, ou null si occupé —
   auquel cas `holder` dit qui le tient et depuis quand. Atomique : l'INSERT …
   ON CONFLICT … WHERE ne réécrit la ligne que si le bail en place est expiré,
   et RETURNING ne rend rien sinon. */
/* `origin` (M3-100) : « worker » (ordonnanceur, demandes du back-office) ou
   « cli » (npm run harvest / generate / daily, src/tools/chain.js). Seul le
   worker efface au démarrage, et seulement ses propres baux (cf. clear). */
export async function acquire(name, { ttlMs = 2 * 3600000, owner = "?", origin = "worker" } = {}) {
  const token = randomUUID();
  const value = { token, owner, origin, since: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  const { rows } = await query(
    `INSERT INTO kv_documents (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       WHERE (kv_documents.value->>'expiresAt')::timestamptz < now()
     RETURNING key`,
    [key(name), JSON.stringify(value)]
  );
  return rows.length ? token : null;
}

export async function holder(name) {
  const { rows } = await query("SELECT value FROM kv_documents WHERE key = $1", [key(name)]);
  const v = rows[0]?.value;
  return v && Date.parse(v.expiresAt) > Date.now() ? { owner: v.owner, since: v.since, origin: v.origin || "worker", expiresAt: v.expiresAt } : null;
}

/* Ne libère que SON bail : un bail expiré puis repris par un autre ne doit pas
   être effacé par le retardataire. */
export async function release(name, token) {
  if (!token) return;
  await query("DELETE FROM kv_documents WHERE key = $1 AND value->>'token' = $2", [key(name), token]);
}

/* Libère le bail sans jeton. Deux appelants :
   - le démarrage du worker, avec `origin: "worker"` : le worker est seul, un bail
     « worker » encore présent est celui d'un processus tué en pleine run (sans
     ça, une génération coupée par un redéploiement bloque tout clic « Lancer »
     jusqu'à deux heures). Il ÉPARGNE un bail « cli » (M3-100) : un npm run daily
     lancé à la main peut tourner pendant que le worker redémarre, et effacer son
     bail rouvrirait la double récolte. Un bail d'avant M3-100, sans origine,
     compte comme « worker » : seul le worker en prenait.
   - `node src/tools/chain.js unlock`, sans `origin` : déblocage manuel, quel que
     soit le détenteur (un daily tué garde sinon son bail jusqu'à expiration).
   Rend le bail effacé, ou null. */
export async function clear(name, { origin = null } = {}) {
  const { rows } = origin
    ? await query(
      "DELETE FROM kv_documents WHERE key = $1 AND coalesce(value->>'origin', 'worker') = $2 RETURNING value",
      [key(name), origin])
    : await query("DELETE FROM kv_documents WHERE key = $1 RETURNING value", [key(name)]);
  return rows[0]?.value || null;
}

/* Exécute `fn` sous le bail, ou lève une erreur 409 lisible s'il est tenu. */
export async function withLock(name, owner, fn, opts = {}) {
  const token = await acquire(name, { ...opts, owner });
  if (!token) {
    const h = await holder(name);
    const since = h ? new Date(h.since).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : null;
    throw Object.assign(new Error(`Une exécution est déjà en cours${h ? ` (${h.owner}, depuis ${since})` : ""} — réessayez quand elle sera terminée.`), { status: 409, code: "LOCKED" });
  }
  /* Le bail « chain » délimite une routine (M3-105) : ce qu'elle coûte se lit sur
     les runs écrits pendant qu'elle le tient. opts.routine dit d'où elle vient. */
  const run = name === "chain" ? () => enRoutine({ origine: opts.routine, owner }, fn) : fn;
  try { return await run(); }
  finally { await release(name, token); }
}
