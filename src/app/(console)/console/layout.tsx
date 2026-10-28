// Coque de la console (phase 4 de docs/plans/PLAN-nextjs-migration.md) : réservée aux
// connectés. Qui je suis, la file complète et le nombre de notifications sont
// lus ici, une fois, et confiés au magasin client, qui survit aux navigations
// entre les quatre vues.

import type { Metadata } from "next";
import "../../../../styles/console.css";
import { exigerUtilisateur } from "@/session";
import { lireMoi } from "@/seConnecter/seConnecter.requetes";
import { lireIndexComplet, lireReferentielSources } from "@/relireArticles/relireArticles.requetes";
import { lireNotifications } from "@/suivreNotifications/suivreNotifications.requetes";
import { CoqueConsole } from "./CoqueConsole";

export const metadata: Metadata = { title: "Console de rédaction — M3" };

const THEME_PREFS = `(function(){try{var p=JSON.parse(localStorage.getItem("m3:prefs")||"{}");document.documentElement.dataset.theme=p.theme==="dark"?"dark":"";}catch(e){}})();`;

export default async function LayoutConsole({ children }: LayoutProps<"/console">) {
  await exigerUtilisateur("/console");
  const [moi, index, sources, notifs] = await Promise.all([
    lireMoi({}),
    lireIndexComplet(),
    /* Le filtre « source » se construit sans lui (depuis les articles) : une
       lecture ratée ne doit pas fermer la console. */
    lireReferentielSources().catch(() => []),
    lireNotifications({}).catch(() => ({ notifications: [], unread: 0 })),
  ]);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_PREFS }} />
      <div className="cr">
        <CoqueConsole moi={moi} index={index.articles} sources={sources} nonLues={notifs.unread}>{children}</CoqueConsole>
      </div>
    </>
  );
}
