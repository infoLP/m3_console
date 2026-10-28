/* M3-116 — Chromium furtif gelé sous crawlee (src/ingest/fetchRendered.js).
   Séparé de scrapingFallback.test.js (T29) : il attend le démontage borné réel
   (10 s), comme « ctx.close() gelé » là-bas ; deux fichiers, deux processus,
   les deux attentes se recouvrent. */

import test from "node:test";
import assert from "node:assert/strict";
import { fetchStealth } from "../src/ingest/fetchRendered.js";
import { fakeChromium } from "./outils/fauxChromium.js";

const LIST = "https://exemple.test/actualites";

/* Faux crawlee dont le crawler lance son navigateur par le lanceur reçu, puis
   gèle (run et teardown ne rendent jamais la main) : un Chromium furtif gelé. */
function frozenCrawlee(seen) {
  return {
    Configuration: class {},
    PlaywrightCrawler: class {
      constructor(options) { this.options = options; seen.options = options; }
      async run() {
        seen.browser = await this.options.launchContext.launcher.launch({ headless: true });
        return new Promise(() => {});
      }
      teardown() { return new Promise(() => {}); }
    },
  };
}

test("M3-116 : Chromium furtif gelé sous crawlee → son serveur est tué après le démontage borné", async () => {
  const seen = {};
  const { lib: pw, st } = fakeChromium();
  await assert.rejects(fetchStealth(LIST, { lib: frozenCrawlee(seen), pw, hardMs: 50 }), /délai dépassé/);
  assert.equal(seen.options.launchContext.useIncognitoPages, true, "pages incognito : crawlee passe par launch()");
  assert.ok(seen.browser, "navigateur lancé par notre lanceur");
  assert.deepEqual(st.killed, [0], "serveur tué (BrowserServer.kill)");
}, { timeout: 30000 });
