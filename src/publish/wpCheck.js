/* M3-53 — « Tester la connexion » d'une cible WordPress : l'adresse répond-elle,
   le compte et le mot de passe d'application sont-ils acceptés, le rôle permet-il
   d'écrire des articles ? Sans rien écrire sur le site. Même vérification que
   l'écran Cibles de M2 (GET /users/me), plus le rôle. */

import { createWpClient } from "./wpClient.js";

const ROLES_QUI_PUBLIENT = new Set(["administrator", "editor", "author"]);

function expliquer(e) {
  if (e?.status === 401 || e?.status === 403) return "Identifiants refusés : vérifier le compte et le mot de passe d'application (les mots de passe d'application doivent être activés sur le site).";
  if (e?.status === 404) return "API REST WordPress introuvable à cette adresse : vérifier l'URL du site.";
  return e?.message || "Échec de la connexion.";
}

export async function checkWpTarget({ url, user, appPassword }, { fetch } = {}) {
  const client = createWpClient({ url, user, appPassword, fetch });
  try {
    const me = await client.get("/wp/v2/users/me?context=edit");
    const roles = Array.isArray(me?.roles) ? me.roles : [];
    const canPost = roles.some((r) => ROLES_QUI_PUBLIENT.has(r));
    const name = me?.name || user;
    return {
      ok: canPost,
      name,
      roles,
      canPost,
      message: canPost
        ? `Connecté : ${name} (${roles.join(", ")}).`
        : `Connecté, mais le rôle (${roles.join(", ") || "inconnu"}) ne permet pas d'écrire des articles : il faut Auteur, Éditeur ou Administrateur.`,
    };
  } catch (e) {
    return { ok: false, name: null, roles: [], canPost: false, message: expliquer(e) };
  }
}
