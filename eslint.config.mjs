// Lint du code Next.js, repris de M2_Console (eslint-config-next : core-web-vitals
// + typescript). Le métier JavaScript de src/ n'est pas linté ici : il a ses
// propres habitudes, et le faire entrer d'un coup noierait les vraies alertes
// du nouveau code.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    ".claude/**",
    "**/*.js",
    "**/*.mjs",
  ]),
  {
    /* V6 du plan : le métier (pg, cheerio, pdf-parse…) ne doit jamais entrer dans
       un composant. Les pages et layouts sont des composants serveur et peuvent
       lire la base ; tout autre .tsx — un formulaire, une brique — passe par la
       tranche (.action.ts, .requetes.ts), jamais par le métier directement. */
    files: ["src/**/*.tsx"],
    ignores: ["src/app/**/page.tsx", "src/app/**/layout.tsx", "src/app/**/error.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/api/*", "@/lib/*", "@/llm/*", "@/ingest/*", "@/generate/*", "@/schedule/*", "@/publish/*", "@/jobs/*", "@/tools/*", "@/pont", "@/session", "**/*.requetes"],
          message: "Un composant ne touche pas le métier : passer par l'action ou la page serveur de la tranche.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
