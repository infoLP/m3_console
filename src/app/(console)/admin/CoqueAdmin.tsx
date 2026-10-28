"use client";

// La coque du back-office : même colonne que la console (classes cr-* de
// base.css), mêmes onglets dans le même ordre, le repli de la colonne et le
// thème lus dans les préférences de poste. Un onglet = une URL.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Icone } from "@/composants/Icone";
import { ToastProvider } from "@/composants/Toast";
import { appliquerTheme, ecrirePrefs, usePrefs } from "@/composants/prefs";
import { seDeconnecter } from "@/seConnecter/seConnecter.action";
import { ongletsVisibles, HREF_CONCURRENTS, type Onglet } from "@/gererConcurrents/gererConcurrents.regles";

const ONGLETS: readonly Onglet[] = [
  ["/admin", "Sources", "Sliders"],
  ["/admin/utilisateurs", "Utilisateurs", "Users"],
  ["/admin/notifications", "Notifications", "Bell"],
  ["/admin/tickets", "Tickets", "Inbox"],
  ["/admin/executions", "Dernier run", "RotateCcw"],
  ["/admin/llm", "LLM", "Sparkles"],
  ["/admin/journal", "Journal", "Clock"],
  ["/admin/securite", "Sécurité", "Shield"],
  ["/admin/publication", "Publication", "Send"],
  ["/admin/parametres", "Paramètres", "Settings"],
];

/* La coque est plafonnée à 1180 px pour que les onglets de LECTURE gardent une
   longueur de ligne tenable. Les onglets en TABLE n'ont pas ce besoin et en
   souffrent : on lève le plafond là où il y a une grille à remplir. */
const LARGES = new Set(["/admin", "/admin/utilisateurs", "/admin/executions", "/admin/journal", HREF_CONCURRENTS]);

/* `role` : celui du COMPTE (pas « Voir comme ») ; il choisit les onglets de la
   colonne (M3-120 : un superutilisateur n'y a que Sources → Concurrents). */
export function CoqueAdmin({ moi, role, feats, nonLues, children }: {
  moi: { name: string; login: string } | null;
  role: string;
  feats: Record<string, boolean>;
  nonLues: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const replie = usePrefs().navFolded;

  /* Une FEAT « mode sombre » fermée à ce rôle ramène le thème clair. */
  useEffect(() => { appliquerTheme(feats); }, [feats]);

  const basculer = () => { ecrirePrefs({ navFolded: !replie }); };
  /* L'onglet Sources couvre aussi son sous-onglet Concurrents. */
  const actif = (href: string) => (href === "/admin" || href === HREF_CONCURRENTS
    ? pathname === "/admin" || pathname.startsWith(HREF_CONCURRENTS)
    : pathname.startsWith(href));
  const onglets = ongletsVisibles(ONGLETS, role);

  return (
    <ToastProvider>
      <div className={`cr-app${replie ? " folded" : ""}`}>
        <nav className="cr-side">
          <div className="cr-side-id">
            <span className="cr-side-mark">M3<span>back-office</span></span>
            <button className="cr-fold" type="button" onClick={basculer} aria-expanded={!replie}
                    title={replie ? "Déplier la navigation" : "Replier la navigation"}><Icone nom="AlignLeft" size={15} /></button>
          </div>
          <div className="cr-side-g">
            {onglets.map(([href, libelle, icone]) => (
              <Link key={href} href={href} className={`cr-navrow${actif(href) ? " on" : ""}`} title={libelle}>
                <Icone nom={icone} size={15} /><span className="cr-navrow-l">{libelle}</span>
                {href === "/admin/notifications" && nonLues > 0 && <span className="b">{nonLues}</span>}
              </Link>
            ))}
          </div>
          <div className="cr-side-foot">
            {/* <a> et non <Link> : la console est encore servie par l'ancien serveur. */}
            <a className="cr-navrow" href="/console" title="Console de rédaction"><Icone nom="FileText" size={15} /><span className="cr-navrow-l">Console de rédaction</span></a>
            <div className="cr-side-me">{moi && <span className="cr-who" title={moi.login}>{moi.name}</span>}</div>
            <form action={seDeconnecter}>
              <button className="cr-navrow" type="submit" title="Se déconnecter"><Icone nom="LogOut" size={15} /><span className="cr-navrow-l">Se déconnecter</span></button>
            </form>
          </div>
        </nav>
        <div className={`bo-shell${LARGES.has(pathname) ? " bo-shell--large" : ""}`}>
          <div className="bo-top">
            <div><div className="bo-title">Back-office</div>
              <div className="bo-sub">Référentiel de sources, comptes et réglages</div></div>
          </div>
          {children}
        </div>
      </div>
    </ToastProvider>
  );
}
