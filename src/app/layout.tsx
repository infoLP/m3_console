import type { Metadata } from "next";
import "../../styles/base.css";
import "./globals.css";
import { RemonteeErreurs } from "@/composants/RemonteeErreurs";

export const metadata: Metadata = {
  title: "M3",
  description: "Génération assistée d'articles de presse locale — console de relecture",
  icons: { icon: "/site-icon" },
};

/* Tout est lu en base à chaque requête : rien n'est pré-rendu (comme M2_Console). */
export const dynamic = "force-dynamic";

/* Le thème AVANT le premier rendu, sinon la page s'affiche en clair puis bascule.
   Avant connexion, on suit le système. Les pages connectées réappliquent ensuite
   la préférence de poste (m3:prefs) par appliquerTheme() de composants/prefs.ts. */
const THEME = `(function(){var mq=window.matchMedia("(prefers-color-scheme: dark)");var apply=function(d){document.documentElement.dataset.theme=d?"dark":"light";};apply(mq.matches);mq.addEventListener("change",function(e){apply(e.matches);});})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body><RemonteeErreurs />{children}</body>
    </html>
  );
}
