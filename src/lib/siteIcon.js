/* Icône du site (favicon), choisie au back-office → Paramètres.

   Stockée dans la table `settings` sous la clé `site_icon`, en data URL. Elle
   n'est PAS déclarée dans SETTING_SPECS, à dessein : ce n'est pas un scalaire du
   formulaire, et y figurer la ferait recopier dans chaque instantané de
   config_history (cent versions de 300 Ko) et dans le journal, qui écrit les
   changements « avant → après ». writeSettings l'écarte de ses instantanés. */

import { createHash } from "node:crypto";
import { query } from "./db.js";
import { SITE_ICON_KEY } from "../../shared/contrat.js";

export { SITE_ICON_KEY };

/* 256 Ko décodés : une icône en fait rarement plus de 50. Le corps JSON (base64,
   +33 %) reste ainsi sous la limite de 1 Mo de readJsonBody. */
export const SITE_ICON_MAX_BYTES = 256 * 1024;

export const SITE_ICON_TYPES = {
  "image/png": "PNG", "image/svg+xml": "SVG", "image/x-icon": "ICO",
  "image/vnd.microsoft.icon": "ICO", "image/jpeg": "JPEG", "image/webp": "WebP", "image/gif": "GIF",
};

function parseDataUrl(s) {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(s || "").trim());
  if (!m) return null;
  return { type: m[1].toLowerCase(), buf: Buffer.from(m[2], "base64") };
}

/* Valide et enregistre. Le type annoncé par le navigateur se vérifie sur les
   premiers octets : un fichier renommé en .png ne passe pas pour une image. */
export async function writeSiteIcon(dataUrl) {
  const p = parseDataUrl(dataUrl);
  if (!p) throw Object.assign(new Error("image attendue (data URL base64)"), { status: 400 });
  if (!SITE_ICON_TYPES[p.type]) {
    throw Object.assign(new Error(`format non pris en charge : ${p.type} — ${[...new Set(Object.values(SITE_ICON_TYPES))].join(", ")}`), { status: 400 });
  }
  if (!p.buf.length) throw Object.assign(new Error("fichier vide"), { status: 400 });
  if (p.buf.length > SITE_ICON_MAX_BYTES) {
    throw Object.assign(new Error(`icône trop lourde : ${Math.ceil(p.buf.length / 1024)} Ko, ${SITE_ICON_MAX_BYTES / 1024} Ko au plus`), { status: 400 });
  }
  if (!looksLike(p.type, p.buf)) throw Object.assign(new Error(`le contenu n'est pas un fichier ${SITE_ICON_TYPES[p.type]}`), { status: 400 });
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SITE_ICON_KEY, `data:${p.type};base64,${p.buf.toString("base64")}`]
  );
  return { type: p.type, bytes: p.buf.length };
}

function looksLike(type, b) {
  const starts = (...bytes) => bytes.every((x, i) => b[i] === x);
  if (type === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (type === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (type === "image/gif") return starts(0x47, 0x49, 0x46, 0x38);
  if (type === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && b.toString("latin1", 8, 12) === "WEBP";
  if (type === "image/x-icon" || type === "image/vnd.microsoft.icon") return starts(0x00, 0x00, 0x01, 0x00);
  if (type === "image/svg+xml") return /<svg[\s>]/i.test(b.toString("utf8", 0, Math.min(b.length, 4096)));
  return false;
}

export async function deleteSiteIcon() {
  const { rowCount } = await query("DELETE FROM settings WHERE key = $1", [SITE_ICON_KEY]);
  return rowCount;
}

export async function readSiteIcon() {
  const { rows } = await query("SELECT value FROM settings WHERE key = $1", [SITE_ICON_KEY]);
  const p = rows[0] && parseDataUrl(rows[0].value);
  if (!p) return null;
  return { ...p, etag: `"${createHash("sha1").update(p.buf).digest("hex").slice(0, 16)}"` };
}

/* GET /site-icon et /favicon.ico. Ouverts sans session : la page de connexion
   affiche l'icône elle aussi. Sans icône choisie, 404 — le navigateur garde son
   icône par défaut, comme avant que le réglage existe.

   no-cache + ETag plutôt que no-store : le navigateur revalide à chaque page (un
   changement au back-office se voit au rechargement suivant) sans retélécharger
   l'image quand elle n'a pas bougé.

   Le CSP est pour le SVG : servi depuis notre origine et ouvert directement, un
   SVG peut porter du script. `default-src 'none'` l'en empêche, sans gêner son
   affichage comme icône. */
export async function serveSiteIcon(req, res) {
  let icon = null;
  try { icon = await readSiteIcon(); } catch { /* base injoignable : pas d'icône */ }
  if (!icon) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end("aucune icône");
  }
  const headers = {
    "Content-Type": icon.type,
    "Cache-Control": "no-cache",
    ETag: icon.etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  };
  if (req.headers["if-none-match"] === icon.etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  res.end(icon.buf);
}
