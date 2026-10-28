/* Liste noire d'adresses IP en ligne de commande (M3-44, piège 2).
 *
 *   node outils-console/ipBanAdmin.js --list
 *   node outils-console/ipBanAdmin.js --unban 203.0.113.7
 *   node outils-console/ipBanAdmin.js --ban 203.0.113.7 [--note "motif"]
 *
 * Dans le conteneur de la console (T25 : l'outil a quitté le moteur, qui n'a
 * plus ni lib/ipBan ni lib/clientIp) :
 *   docker exec -it <conteneur console> node outils-console/ipBanAdmin.js --unban 203.0.113.7
 *
 * LE RECOURS QUAND ON S'EST BANNI SOI-MÊME. La liste noire s'édite depuis le
 * back-office, qui est derrière la connexion : un administrateur dont l'adresse
 * est bannie ne peut plus l'ouvrir. Cette commande ne passe pas par la connexion,
 * au même titre que `user:set` est la seule porte d'entrée quand aucun compte
 * n'existe. Autres recours : se connecter par le SSO Entra (non concerné par la
 * liste noire), ou ajouter l'adresse à M3_IP_BAN_EXEMPT dans la stack.
 */

import { closePool } from "../src/lib/db.js";
import { isMain } from "./estPrincipal.js";
import { createIpBans, pgRepo } from "../src/lib/ipBan.js";

function arg(name, argv) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

export async function run(argv, { bans = createIpBans({ repo: pgRepo() }), log = console.log } = {}) {
  if (argv.includes("--list")) {
    const list = await bans.list();
    if (!list.length) { log("  liste noire vide"); return list; }
    log("  " + "adresse".padEnd(40) + "depuis".padEnd(22) + "motif     identifiants tentés");
    for (const b of list) {
      log("  " + b.ip.padEnd(40) + b.bannedAt.slice(0, 19).replace("T", " ").padEnd(22)
          + (b.reason === "auto" ? `auto (${b.failures})` : `manuel${b.bannedBy ? ` (${b.bannedBy})` : ""}`).padEnd(10)
          + (b.logins.join(", ") || "—"));
    }
    return list;
  }
  if (argv.includes("--unban")) {
    const ip = arg("unban", argv);
    if (!ip) throw new Error("--unban <adresse> : adresse manquante");
    const r = await bans.unban(ip, { by: "ligne de commande" });
    log(r.removed ? `  ✓ ${r.ip} retirée de la liste noire (compteur de refus remis à zéro)` : `  ${r.ip} n'était pas dans la liste noire (compteur de refus remis à zéro)`);
    return r;
  }
  if (argv.includes("--ban")) {
    const ip = arg("ban", argv);
    if (!ip) throw new Error("--ban <adresse> : adresse manquante");
    const r = await bans.ban(ip, { by: "ligne de commande", note: arg("note", argv) });
    log(`  ✓ ${r.ip} ajoutée à la liste noire`);
    return r;
  }
  log("Usage : node outils-console/ipBanAdmin.js --list | --unban <adresse> | --ban <adresse> [--note <motif>]");
  return null;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2))
    .then(() => closePool())
    .catch(async (e) => {
      console.error("✗ " + e.message);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
