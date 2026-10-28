/* Récupération réseau bornée — protège la mémoire du harvest.
   Coupe le timeout ET la taille (un site peut servir un fichier énorme). */

export const UA = "Mozilla/5.0 (compatible; M3-prototype/0.1)";

const MAX_BYTES = 3 * 1024 * 1024; // 3 Mo par ressource

export async function fetchCapped(url, { timeoutMs = 15000, maxBytes = MAX_BYTES, headers = {}, as = "text" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const cl = Number(res.headers.get("content-length") || 0);
    if (cl && cl > maxBytes) throw new Error(`réponse trop volumineuse (${Math.round(cl / 1024)} Ko)`);

    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error("réponse trop volumineuse");
      return as === "buffer" ? buf : buf.toString("utf8");
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) { controller.abort(); throw new Error("réponse trop volumineuse"); }
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    return as === "buffer" ? buf : buf.toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}
