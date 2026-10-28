/* Extraction de texte d'une source PDF. */

import { createHash } from "node:crypto";
import { cleanText } from "./fetchFeed.js";
import { fetchCapped } from "./net.js";

export async function harvestPdf(url, { timeoutMs = 20000 } = {}) {
  try {
    const { default: pdfParse } = await import("pdf-parse");
    const buf = await fetchCapped(url, { timeoutMs, maxBytes: 8 * 1024 * 1024, as: "buffer" });
    const data = await pdfParse(buf, { max: 12 });
    const text = cleanText(data.text, 12000);
    if (text.length < 200) return { ok: false, error: "PDF sans texte exploitable", items: [] };
    const title = cleanText((data.info && data.info.Title) || text.split("\n")[0] || "Document PDF", 250);
    return {
      ok: true,
      items: [{
        externalId: createHash("sha1").update(url).digest("hex").slice(0, 16),
        title,
        link: url,
        publishedAt: null,
        rawText: text,
        summary: text.slice(0, 400),
      }],
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err), items: [] };
  }
}
