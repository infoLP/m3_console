// Coque du back-office (phase 3 de docs/plans/PLAN-nextjs-migration.md) : réservée au droit
// « backoffice » ou, depuis M3-120, « manage_competitors » (le superutilisateur, qui n'y
// voit que Sources → Concurrents), évalués sur le rôle du COMPTE — « Voir comme » ne
// change pas ce qu'on a le droit d'ouvrir. Chaque page garde sa propre garde. La colonne, l'en-tête et le toast sont dans
// CoqueAdmin ; chaque onglet est une page sous ce dossier.

import type { Metadata } from "next";
import "../../../../styles/admin.css";
import { exigerUnDesDroits } from "@/session";
import { DROITS_COQUE_ADMIN } from "@/gererConcurrents/gererConcurrents.regles";
import { lireMoi } from "@/seConnecter/seConnecter.requetes";
import { lireNotifications } from "@/suivreNotifications/suivreNotifications.requetes";
import { CoqueAdmin } from "./CoqueAdmin";

export const metadata: Metadata = { title: "Back-office — M3" };

/* Le thème de poste AVANT hydratation : sombre si la préférence le dit, clair sinon
   (le système n'est suivi qu'avant connexion). La FEAT « mode sombre » est
   rappliquée après hydratation par CoqueAdmin, quand on connaît le rôle. */
const THEME_PREFS = `(function(){try{var p=JSON.parse(localStorage.getItem("m3:prefs")||"{}");document.documentElement.dataset.theme=p.theme==="dark"?"dark":"";}catch(e){}})();`;

export default async function LayoutAdmin({ children }: LayoutProps<"/admin">) {
  const compte = await exigerUnDesDroits(DROITS_COQUE_ADMIN, "/admin");
  /* Les notifications sont lues ici et pas seulement dans leur onglet : la
     pastille de la colonne se calcule dessus. */
  const [moi, notifs] = await Promise.all([
    lireMoi({}),
    lireNotifications({}).catch(() => ({ notifications: [], unread: 0 })),
  ]);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_PREFS }} />
      <div className="cr">
        <CoqueAdmin moi={moi.user} role={compte.role} feats={moi.feats} nonLues={notifs.unread}>{children}</CoqueAdmin>
      </div>
    </>
  );
}
