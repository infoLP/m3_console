/* Ce que l'adresse d'une illustration dit d'elle-même (M3-66) — pur, sans
   dépendance Node : la grille de la relecture (R12) et le champ « Image » de la
   console s'en servent aussi. Le téléchargement et le téléversement vivent dans
   illustration.js, côté serveur seulement. */

export const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif"]);

const extOf = (pathname) => (pathname.split("/").pop().match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();

/* null : rien à dire (champ vide ou adresse plausible). Sinon le message à
   montrer au relecteur. Le contenu réel (une image ?) n'est vérifiable qu'au
   téléchargement. */
export function checkIllustrationUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return "L'adresse de l'illustration n'est pas une URL valide."; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "L'adresse de l'illustration doit commencer par http:// ou https://.";
  const ext = extOf(u.pathname);
  if (ext && !IMAGE_EXT.has(ext) && !["php", "html", "htm"].includes(ext)) return `L'adresse de l'illustration ne pointe pas vers une image (fichier .${ext}).`;
  return null;
}

/* IPv6 → ses 8 groupes de 16 bits, ou null si l'écriture est invalide.
   Gère « :: », la zone (%eth0) et une IPv4 pointée en queue (::ffff:1.2.3.4). */
function ipv6Groups(raw) {
  let h = raw.split("%")[0];
  const v4 = h.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const o = v4.slice(2).map(Number);
    if (o.some((x) => x > 255)) return null;
    h = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const parts = h.split("::");
  if (parts.length > 2) return null;
  const side = (p) => (p ? p.split(":") : []);
  const [head, tail] = [side(parts[0]), side(parts[1])];
  const fill = 8 - head.length - tail.length;
  if (parts.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array(parts.length === 2 ? fill : 0).fill("0"), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

const v4Of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/* Adresse IP du réseau local, de la boucle locale, des métadonnées du nuage, ou
   réservée. En IPv6, une IPv4 embarquée est extraite et jugée : v4 dans v6
   (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 64:ff9b::/96, 6to4
   2002::/16. 64:ff9b:1::/48 (NAT64 local, RFC 8215) est refusé en bloc : la place
   de l'IPv4 y dépend de la longueur de préfixe choisie par le réseau. Une
   écriture illisible est refusée. */
export function privateIp(raw) {
  const h = String(raw || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (h.includes(":")) {
    const g = ipv6Groups(h);
    if (!g) return true;
    const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
    if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return privateIp(v4Of(g[6], g[7])); // v4 dans v6, compatible, :: et ::1
    if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return privateIp(v4Of(g[6], g[7])); // NAT64 /96
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // NAT64 local /48
    if (g[0] === 0x2002) return privateIp(v4Of(g[1], g[2])); // 6to4
    return (g[0] & 0xfe00) === 0xfc00 // fc00::/7, unique local
      || (g[0] & 0xffc0) === 0xfe80 // fe80::/10, lien local
      || (g[0] & 0xffc0) === 0xfec0 // fec0::/10, site local (déprécié)
      || (g[0] & 0xff00) === 0xff00; // ff00::/8, multicast
  }
  const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ip) return false;
  const [a, b, c] = [Number(ip[1]), Number(ip[2]), Number(ip[3])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    /* 192.0.0.0/24 (attributions IETF) et 198.18.0.0/15 (bancs d'essai réseau, T5). */
    || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
}

/* Nom d'hôte manifestement local ; une IP littérale est jugée par privateIp. */
export function privateHostName(host) {
  const h = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || privateIp(h);
}
