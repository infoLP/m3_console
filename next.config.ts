import type { NextConfig } from "next";

/* Configuration reprise de M2_Console, moins ce que M3 ne peut pas encore
   assumer (docs/plans/PLAN-nextjs-migration.md, « Configuration Next.js »). */
const nextConfig: NextConfig = {
  /* m3_console (extraire-console.mjs) : sortie standalone. Les fichiers lus par
     chemin (config/*.baseline.yml, migrations/, src/generate/communes.fr.json)
     sont copiés à côté de server.js par le Dockerfile ; ROOT (src/lib/racine.js)
     retombe alors sur le répertoire courant, /app. Le commentaire ci-dessous
     date de M3. */
  output: "standalone",

  /* Pas de `output: "standalone"` pour l'instant (V2 du plan) : le métier lit des
     fichiers par chemin (config/*.baseline.yml, migrations/) que le traçage de
     fichiers ne voit pas. L'image Docker embarque l'arbre complet ; standalone
     se revisite en fin de migration. */

  /* pg, cheerio, pdf-parse et consorts restent des modules Node ordinaires,
     chargés depuis node_modules à l'exécution : pdf-parse 1.1.4 lit un fichier
     de test à l'import, et le bundler le casserait. playwright et crawlee
     (crawlers de repli de la récolte, M3-57) sont chargés par import dynamique. */
  serverExternalPackages: ["pg", "cheerio", "pdf-parse", "rss-parser", "yaml", "xlsx", "playwright", "playwright-core", "crawlee"],

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  async headers() {
    /* no-store partout, sauf les ressources empreintées de /_next/static et les
       polices : le HTML change à chaque déploiement sans changer de nom ; une
       police ne change jamais sans changer de fichier, et sans cette exception
       les 130 Ko d'Inter repartiraient à chaque chargement de page. */
    return [
      { source: "/fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/((?!_next/static|fonts/).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
