import type { NextConfig } from "next";

/* Configuration reprise de M2_Console, moins ce que M3 ne peut pas encore
   assumer (docs/plans/PLAN-nextjs-migration.md, « Configuration Next.js »). */
const nextConfig: NextConfig = {
  /* m3_console (extraire-console.mjs) : sortie standalone. Les fichiers lus par
     chemin (config/*.baseline.yml), que le traçage de Next ne voit pas, sont
     copiés à côté de server.js par le Dockerfile ; ROOT (src/lib/racine.js)
     retombe alors sur le répertoire courant, /app. */
  output: "standalone",

  /* pg et yaml restent des modules Node ordinaires, chargés depuis node_modules
     à l'exécution. T26 : les dépendances du moteur (cheerio, pdf-parse,
     rss-parser, xlsx, playwright, crawlee) ne sont plus dans la console. */
  serverExternalPackages: ["pg", "yaml"],

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
