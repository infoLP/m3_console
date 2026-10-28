/* Accès PostgreSQL — un pool unique pour tout le processus.

   Le pool est créé à la première utilisation et non à l'import : pendant la
   bascule, des modules importent db.js alors que DATABASE_URL n'est pas encore
   renseignée, et un import ne doit pas échouer pour autant. */

import pg from "pg";
import { log } from "./log.js";

const { Pool } = pg;

/* Le pool vit sur globalThis et non dans une variable de module (V3 de
   docs/plans/PLAN-nextjs-migration.md) : `next dev` ré-évalue les modules à chaque
   modification, et chaque sauvegarde créerait un pool de 10 connexions de plus
   sans fermer le précédent, jusqu'à épuiser max_connections de la base
   partagée. Inoffensif en production, dans le worker et les outils : un seul
   processus, un seul module, un seul pool. */
const G = globalThis;
let pool = G.__m3Pool || null;

export function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL n'est pas définie. En local : docker compose --env-file .env.docker up -d m3-postgres, " +
      "puis exporter DATABASE_URL (cf. .env.docker.example). En stack : la variable est construite par docker-compose.yml."
    );
  }
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    /* pg n'impose aucun délai de connexion par défaut : sans cela, un Postgres
       injoignable fait attendre indéfiniment au lieu de remonter une erreur. */
    connectionTimeoutMillis: 5000,
  });
  /* Une erreur sur un client inactif (coupure réseau, redémarrage du conteneur
     Postgres) est émise sur le pool : sans écouteur, Node arrête le processus. */
  pool.on("error", (e) => log.error("db", "pool PostgreSQL", { erreur: e.message, code: e.code }));
  G.__m3Pool = pool;
  return pool;
}

/* Requête simple, hors transaction. Toujours passer les valeurs en paramètres
   ($1, $2, …) — jamais par concaténation de chaînes. */
export function query(text, params) {
  return getPool().query(text, params);
}

/* Exécute `fn(client)` dans une transaction, avec COMMIT ou ROLLBACK selon
   l'issue. Le client passé à `fn` est celui de la transaction : toutes les
   requêtes de `fn` doivent l'utiliser, sinon elles partent hors transaction. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* À n'appeler que dans les outils one-shot, pour que le processus se termine.
   Le serveur ne ferme jamais son pool. */
export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  G.__m3Pool = null;
  await p.end();
}
