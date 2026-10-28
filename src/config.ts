// Configuration du côté Next.js, lue dans l'environnement et validée par Zod,
// comme M2_Console/src/config.ts. Une variable illisible arrête le serveur au
// premier appel, avec son nom — aujourd'hui, M3_SECRET_KEY absente ne se
// découvre qu'au back-office.
//
// Le métier JavaScript de src/ continue de lire process.env directement : ce
// fichier ne le remplace pas, il garde la façade honnête.

import { z } from "zod";

const drapeau = z.enum(["0", "1"]).default("0");

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requise (cf. .env.docker.example)"),
  PORT: z.coerce.number().int().positive().default(4173),
  // Posé à 1 derrière Traefik (TLS). Sans TLS, un cookie Secure n'est jamais renvoyé.
  M3_COOKIE_SECURE: drapeau,
  // Chiffre les clés d'API LLM posées au back-office. Vide = on ne peut pas en enregistrer.
  M3_SECRET_KEY: z.string().default(""),
  // Sert à construire le redirect_uri du SSO ; jamais déduite de la requête.
  M3_PUBLIC_URL: z.string().url().default("https://m3-prototype.dev.legalprime.fr"),
  M3_ENTRA_TENANT_ID: z.string().default(""),
  M3_ENTRA_CLIENT_ID: z.string().default(""),
  M3_ENTRA_CLIENT_SECRET: z.string().default(""),
  M3_AUTH_MODE: z.enum(["", "local", "entra", "both"]).default(""),
  // Booléen « comme dans M2 » (M3-98), traduit en M3_AUTH_MODE par src/lib/oidc.js
  // (PASSWORD_LOGIN_ENV, même nom que dans M2_Console). Volontairement PAS validé
  // ici : une valeur illisible arrêterait le site entier ; elle est ignorée et
  // signalée au démarrage, comme un M3_AUTH_MODE inconnu dans oidc.js.
  CONSOLE_CONNEXION_LOCALE: z.string().default(""),
  // Liste noire d'adresses IP (M3-44, src/lib/ipBan.js). Une liste illisible
  // n'arrête pas le serveur : l'entrée fautive est ignorée et signalée au
  // démarrage (src/instrumentation.ts).
  M3_TRUSTED_PROXIES: z.string().default(""),
  M3_IP_BAN_EXEMPT: z.string().default(""),
  M3_IP_BAN_THRESHOLD: z.union([z.literal(""), z.coerce.number().int().min(0)]).default(15),
  M3_IP_BAN_WINDOW_HOURS: z.union([z.literal(""), z.coerce.number().positive()]).default(24),
});

export type Config = z.infer<typeof schema>;

let cache: Config | undefined;

export function lireConfig(): Config {
  if (cache) return cache;
  const resultat = schema.safeParse(process.env);
  if (!resultat.success) {
    const details = resultat.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${details}`);
  }
  cache = resultat.data;
  return cache;
}
