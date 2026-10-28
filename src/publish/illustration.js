/* Illustration posée par le relecteur (M3-66) → `featured_media` WordPress.

   WordPress n'accepte en image mise en avant qu'un identifiant NUMÉRIQUE de sa
   médiathèque : une URL ne suffit pas. Le relecteur colle une adresse dans le
   champ « Image » ; deux cas, distingués ici et nulle part ailleurs :
   - un LIEN vers un média déjà présent dans la médiathèque du site cible
     (page du média, `?attachment_id=`, fichier sous /wp-content/uploads/) :
     on réutilise son identifiant, sans nouveau téléversement ;
   - une URL d'image du web : téléchargée puis téléversée dans la médiathèque,
     l'URL d'origine gardée dans la description du média (droit d'usage à la
     charge du relecteur, TODO M3-66).

   Une illustration qui ne peut pas partir NE BLOQUE PAS la publication : l'article
   part sans image et l'erreur, lisible, remonte au relecteur. Bloquer l'absence
   d'image relève de la FEAT « Parution sans illustration » (M3-93), contrôlée
   avant d'arriver ici.

   Le serveur télécharge une adresse saisie par un humain : chaque saut (adresse
   saisie, puis chaque redirection, 3 au plus) est revalidé : nom d'hôte ici,
   puis IP au moment même de la connexion (safeGet.js : la socket ne va qu'à
   l'adresse validée, pas de DNS rebinding, T5). Le corps d'une réponse écartée
   (redirection, erreur) est abandonné, la lecture s'arrête au plafond de taille.
   Hors champ : téléversement depuis le poste, Shutterstock (M3-54). */

import { checkIllustrationUrl, privateHostName } from "./illustrationUrl.js";
import { PRIVATE_ADDRESS, safeGet } from "./safeGet.js";

export { checkIllustrationUrl };

const EXT_OF_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 15000;
const LOCAL_REFUSAL = "L'adresse de l'illustration désigne le réseau local : elle n'est pas téléchargée.";

const sameSite = (u, siteUrl) => {
  try { return u.host.toLowerCase() === new URL(siteUrl).host.toLowerCase(); } catch { return false; }
};

/* Identifiant de média lisible dans un lien de la médiathèque du site cible,
   ou null. Formes reconnues : ?attachment_id=N, upload.php?item=N,
   post.php?post=N (écran d'édition du média), route REST /wp/v2/media/N. */
export function mediaIdFromLink(raw, siteUrl) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (!sameSite(u, siteUrl)) return null;
  const q = u.searchParams;
  const rest = (q.get("rest_route") || u.pathname).match(/\/wp\/v2\/media\/(\d+)\/?$/);
  const n = q.get("attachment_id")
    || (u.pathname.endsWith("/upload.php") && q.get("item"))
    || (u.pathname.endsWith("/post.php") && q.get("post"))
    || rest?.[1];
  return /^\d+$/.test(String(n || "")) && Number(n) > 0 ? Number(n) : null;
}

/* Fichier déjà dans la médiathèque (…/wp-content/uploads/…) : on le retrouve par
   son nom. WordPress sert aussi des déclinaisons « photo-300x200.jpg » : on
   compare au fichier d'origine comme à chacune de ses tailles. 100 résultats,
   le maximum d'une page de l'API : au-delà, un homonyme peut masquer le bon. */
async function findUploaded(client, u) {
  if (!u.pathname.includes("/wp-content/uploads/")) return null;
  const file = decodeURIComponent(u.pathname.split("/").pop());
  const stem = file.replace(/\.[^.]+$/, "").replace(/-\d+x\d+$/, "").replace(/-scaled$/, "");
  const found = await client.get(`/wp/v2/media?search=${encodeURIComponent(stem)}&per_page=100`);
  const target = u.origin + u.pathname;
  const hit = (Array.isArray(found) ? found : []).find((m) =>
    m?.source_url === target || Object.values(m?.media_details?.sizes || {}).some((sz) => sz?.source_url === target));
  return hit ? hit.id : null;
}

/* Refus (message) ou null pour un saut, sur ce que l'URL dit d'elle-même : une
   IP littérale ne passe pas par le lookup de safeGet, elle est jugée ici. Le
   site cible lui-même est admis : il peut être local (WordPress de test), et
   c'est l'administrateur qui l'a réglé. */
function hopRefusal(u, siteUrl) {
  if (u.protocol !== "http:" && u.protocol !== "https:") return "L'adresse de l'illustration doit commencer par http:// ou https://.";
  if (sameSite(u, siteUrl)) return null;
  return privateHostName(u.hostname) ? LOCAL_REFUSAL : null;
}

/* Corps écarté sans être lu : la connexion est fermée, pas vidée. */
const discard = (res) => { try { res.cancel ? res.cancel() : res.body?.cancel?.(); } catch { /* déjà fermé */ } };

/* Corps lu en flux, abandonné dès qu'il dépasse le plafond. */
async function readCapped(res) {
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_IMAGE_BYTES) { discard(res); return null; }
  const chunks = [];
  let n = 0;
  for await (const chunk of res.body || []) {
    n += chunk.length;
    if (n > MAX_IMAGE_BYTES) return null; // sortir de la boucle annule le flux
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function download(start, { siteUrl, get, lookup }) {
  let u = start;
  for (let hop = 0; ; hop++) {
    const refusal = hopRefusal(u, siteUrl);
    if (refusal) return { error: refusal };
    let res;
    try {
      res = await get(u.toString(), { headers: { Accept: "image/*" }, timeoutMs: DOWNLOAD_TIMEOUT_MS, allowPrivate: sameSite(u, siteUrl), ...(lookup ? { lookup } : {}) });
    } catch (e) {
      if (e?.code === PRIVATE_ADDRESS) return { error: LOCAL_REFUSAL };
      if (e?.code === "ENOTFOUND") return { error: `Illustration injoignable : nom d'hôte inconnu (${u.hostname}).` };
      return { error: `Illustration injoignable (${u.host}) : ${e.message}.` };
    }
    if (res.status < 200 || res.status >= 300) discard(res);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { error: `Illustration introuvable à cette adresse (HTTP ${res.status} sans destination).` };
      if (hop >= MAX_REDIRECTS) return { error: `Illustration non téléchargée : plus de ${MAX_REDIRECTS} redirections.` };
      try { u = new URL(location, u); } catch { return { error: "Illustration non téléchargée : redirection vers une adresse invalide." }; }
      continue;
    }
    if (!res.ok) return { error: `Illustration introuvable à cette adresse (HTTP ${res.status}).` };
    const contentType = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXT_OF_TYPE[contentType]) { discard(res); return { error: `L'adresse de l'illustration ne renvoie pas une image (${contentType || "type inconnu"}).` }; }
    const bytes = await readCapped(res);
    if (!bytes) return { error: `L'illustration dépasse ${MAX_IMAGE_BYTES / 1024 / 1024} Mo.` };
    if (!bytes.length) return { error: "L'illustration téléchargée est vide." };
    const base = decodeURIComponent(u.pathname.split("/").pop() || "").replace(/\.[^.]+$/, "") || "illustration";
    return { bytes, contentType, filename: `${base}.${EXT_OF_TYPE[contentType]}` };
  }
}

/* → null (pas d'illustration) ou { sourceUrl, mediaId, reused, uploaded, error }.
   Ne lève jamais : une erreur, même de WordPress, devient `error` et `mediaId` null.
   `get` (téléchargement, safeGet par défaut) et `lookup` (sa résolution DNS)
   sont injectables pour les tests. */
export async function resolveFeaturedMedia(client, illustration, { siteUrl, get = safeGet, lookup }) {
  const sourceUrl = String(illustration?.url || "").trim();
  if (!sourceUrl) return null;
  const out = (o) => ({ sourceUrl, mediaId: null, reused: false, uploaded: false, error: null, ...o });
  const bad = checkIllustrationUrl(sourceUrl);
  if (bad) return out({ error: bad });
  const u = new URL(sourceUrl);
  try {
    const linked = mediaIdFromLink(sourceUrl, siteUrl);
    if (linked) {
      const m = await client.get(`/wp/v2/media/${linked}`);
      return out({ mediaId: m.id, reused: true });
    }
    if (sameSite(u, siteUrl)) {
      const id = await findUploaded(client, u);
      if (id) return out({ mediaId: id, reused: true });
    }
    const file = await download(u, { siteUrl, get, lookup });
    if (file.error) return out({ error: file.error });
    const media = await client.upload("/wp/v2/media", file.bytes, file);
    /* Crédit et URL d'origine gardés avec l'image. Un échec ici n'annule pas
       le téléversement : l'image est dans la médiathèque, elle part. */
    const credit = String(illustration.credit || "").trim();
    try {
      await client.post(`/wp/v2/media/${media.id}`, { ...(credit ? { caption: credit } : {}), description: `Source : ${sourceUrl}` });
    } catch { /* méta du média : non bloquant */ }
    return out({ mediaId: media.id, uploaded: true });
  } catch (e) {
    const status = e?.status === 404 ? " (média introuvable dans la médiathèque du site cible)" : "";
    return out({ error: `Illustration non transmise${status} : ${e.message}` });
  }
}
