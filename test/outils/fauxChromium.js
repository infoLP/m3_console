/* Faux playwright-core partagé par test/scrapingFallback.test.js et
   test/scrapingFallback.gel.test.js (T29 : le test du Chromium furtif gelé, 10 s
   de démontage borné, tourne dans son propre fichier, donc en parallèle). */

/* M3-116 — faux playwright-core à plusieurs lancements : chaque launchServer()
   rend un serveur et un navigateur neufs (st.launches). `hang` : numéros des
   lancements (0, 1…) qui attendent st.release[n]() ; `hangCtxClose` : numéros des
   contextes dont close() ne rend jamais la main (navigateur gelé). */
export function fakeChromium({ hang = [], hangCtxClose = [] } = {}) {
  const st = { launches: 0, killed: [], pending: [], release: {}, contexts: 0 };
  const chromium = {
    name: () => "chromium",
    launchServer: () => {
      const n = st.launches++;
      const server = { n, wsEndpoint: () => `ws://127.0.0.1:1/${n}`, kill: async () => { st.killed.push(n); }, process: () => ({ kill: () => {} }) };
      return hang.includes(n) ? new Promise((r) => { st.release[n] = () => r(server); }) : Promise.resolve(server);
    },
    connect: async (ws) => ({
      n: Number(ws.split("/").pop()),
      newContext: async () => {
        const c = st.contexts++;
        return {
          newPage: async () => ({
            route: async () => {},
            goto: () => new Promise((r) => st.pending.push(() => r({ status: () => 200 }))),
            content: async () => `<html>${c}</html>`,
          }),
          close: () => (hangCtxClose.includes(c) ? new Promise(() => {}) : Promise.resolve()),
        };
      },
      close: async () => {},
    }),
  };
  return { lib: { chromium }, st };
}
