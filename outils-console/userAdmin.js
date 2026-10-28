/* Gestion des comptes en ligne de commande.
 *
 *   npm run user:list
 *   npm run user:set -- --login a.sanchez@legalprime.fr --name "Alexandre Sanchez" --role administrateur
 *   npm run user:set -- --login a.sanchez@legalprime.fr             (change le seul mot de passe)
 *   npm run user:delete -- --login a.sanchez@legalprime.fr
 *
 * Dans le conteneur de la console (le -it est nécessaire pour la saisie masquée
 * du mot de passe ; T25 : l'outil a quitté le moteur avec lib/auth) :
 *   docker exec -it <conteneur console> node outils-console/userAdmin.js --set --login … --role administrateur
 *
 * Sert surtout à créer le PREMIER administrateur : sans lui, personne ne peut se
 * connecter, et donc personne ne peut ouvrir le back-office pour créer des comptes.
 * Ensuite, la gestion se fait depuis /admin.
 *
 * LE LOGIN DOIT ÊTRE L'UPN EXACT, celui de l'annuaire Entra — chez nous
 * `p.nom@legalprime.fr`, l'initiale du prénom et non le prénom entier (vérifié
 * le 2026-10-05 auprès de l'intégrateur Windows). C'est par cette valeur que le
 * SSO rattache un compte à sa première connexion : une adresse approchée ne
 * rattache rien, et la personne se voit refuser l'entrée avec « compte inconnu ».
 */

import { randomUUID } from "node:crypto";
import { query, closePool } from "../src/lib/db.js";
import { hashPassword, deleteUserSessions } from "../src/lib/auth.js";
import { isMain } from "./estPrincipal.js";

const ROLES = ["administrateur", "super_utilisateur", "relecteur"];

function arg(name, argv) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

/* Saisie masquée. Sans TTY (pipe, CI), on lit simplement stdin. */
function askPassword(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d) => { buf += d; });
      stdin.on("end", () => resolve(buf.trim()));
      stdin.on("error", reject);
      return;
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let pwd = "";
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "") {
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData);
        stdout.write("\n"); resolve(pwd); return;
      }
      if (ch === "") { stdin.setRawMode(false); stdout.write("\n"); process.exit(130); }
      if (ch === "" || ch === "\b") { pwd = pwd.slice(0, -1); return; }
      pwd += ch;
    };
    stdin.on("data", onData);
  });
}

export async function listUsers({ log = console.log } = {}) {
  const { rows } = await query(
    `SELECT id, name, login, role, (password_hash IS NOT NULL) AS peut_se_connecter, password_set_at
       FROM users ORDER BY position, id`
  );
  if (!rows.length) return log("  aucun compte");
  log("  " + "login".padEnd(34) + "rôle".padEnd(20) + "connexion   nom");
  for (const u of rows) {
    log("  " + String(u.login).padEnd(34) + String(u.role).padEnd(20)
        + (u.peut_se_connecter ? "oui       " : "NON       ") + " " + u.name);
  }
  const sansMdp = rows.filter((u) => !u.peut_se_connecter).length;
  if (sansMdp) log(`\n  ${sansMdp} compte(s) sans mot de passe : ils ne peuvent pas se connecter.`);
  return rows;
}

export async function setUser({ login, name, role, password, log = console.log } = {}) {
  if (!login) throw new Error("--login est obligatoire");
  if (role && !ROLES.includes(role)) throw new Error(`--role doit valoir : ${ROLES.join(", ")}`);
  if (!/^[^@\s]+@[^@\s]+$/.test(login)) {
    log(`  ⚠ « ${login} » n'est pas une adresse : le rattachement au SSO Entra demandera une reprise.`);
  }

  const existing = await query("SELECT id, name, role FROM users WHERE lower(login) = lower($1)", [login]);
  const hash = await hashPassword(password);

  if (existing.rows.length) {
    const u = existing.rows[0];
    await query(
      `UPDATE users SET name = $2, role = $3, password_hash = $4, password_set_at = now()
        WHERE id = $1`,
      [u.id, name || u.name, role || u.role, hash]
    );
    const killed = await deleteUserSessions(u.id);
    log(`  ✓ mot de passe changé pour « ${login} » (${role || u.role})`);
    if (killed) log(`    ${killed} session(s) ouverte(s) fermée(s)`);
    return { created: false, id: u.id };
  }

  const id = `u-${randomUUID().slice(0, 8)}`;
  const { rows: pos } = await query("SELECT coalesce(max(position), -1) + 1 AS p FROM users");
  await query(
    `INSERT INTO users (id, name, login, role, position, password_hash, password_set_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, name || login.split("@")[0], login, role || "relecteur", pos[0].p, hash]
  );
  log(`  ✓ compte créé : ${login} (${role || "relecteur"})`);
  return { created: true, id };
}

export async function deleteUser({ login, log = console.log } = {}) {
  const { rowCount } = await query("DELETE FROM users WHERE lower(login) = lower($1)", [login]);
  log(rowCount ? `  ✓ « ${login} » supprimé (ses sessions avec)` : `  compte introuvable : ${login}`);
  return rowCount;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  (async () => {
    if (argv.includes("--list")) return listUsers();
    if (argv.includes("--delete")) return deleteUser({ login: arg("login", argv) });
    if (argv.includes("--set")) {
      const login = arg("login", argv);
      if (!login) throw new Error("--login est obligatoire");
      const pwd = await askPassword(`Mot de passe pour ${login} : `);
      const again = process.stdin.isTTY ? await askPassword("Confirmer                : ") : pwd;
      if (pwd !== again) throw new Error("les deux saisies diffèrent");
      return setUser({ login, name: arg("name", argv), role: arg("role", argv), password: pwd });
    }
    console.log("Usage : node outils-console/userAdmin.js --list | --set --login <upn> [--name <nom>] [--role <rôle>] | --delete --login <upn>");
  })()
    .then(() => closePool())
    .catch(async (e) => {
      console.error("✗ " + e.message);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
