"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Icone } from "@/composants/Icone";
import { useFlash } from "@/composants/Toast";
import { detailsDemande, type Demande } from "@/traiterDemandes/traiterDemandes.regles";
import { marquerTraitee } from "@/traiterDemandes/traiterDemandes.action";
import { libelleStatut } from "./statutDemande";

export function ListeDemandes({ demandes }: { demandes: Demande[] }) {
  const flash = useFlash();
  const router = useRouter();
  const [enCours, lancer] = useTransition();
  const traiter = (id: string) => lancer(async () => {
    const r = await marquerTraitee(id);
    if (!r.ok) return flash(r.erreur, true);
    router.refresh();
  });
  return (
    <div className="bo-card"><h3>Demandes d&apos;ajout de source</h3>
      {demandes.length ? demandes.map((t) => {
        const details = detailsDemande(t);
        return (
          <div key={t.id} className="bo-row-line">
            <span><Icone nom="Inbox" size={15} /></span>
            <div className="bo-grow"><b>{t.label}</b> <span className={`bo-pill ${t.status === "traite" ? "on" : "a"}`}>{libelleStatut(t.status)}</span>
              <div className="bo-note">{t.url || ""}</div>
              {details.length > 0 && <div className="bo-note">{details.join(" · ")}</div>}
              {t.note && <div className="bo-note">{t.note}</div>}
              <div className="bo-note">par {t.requestedBy} · {new Date(t.at).toLocaleString("fr-FR")}</div></div>
            {t.status !== "traite" && (
              <>
                {/* Proposition, comme « Ajouter une source » : rien n'est enregistré avant
                    « Enregistrer », et la demande reste ouverte jusqu'à « Marquer traitée ». */}
                <button className="bo-btn" type="button" onClick={() => router.push(`/admin?demande=${encodeURIComponent(t.id)}`)} title="Ajoute une source pré-remplie, inactive, dans l'onglet Sources — à relire puis enregistrer"><Icone nom="Plus" size={13} />Créer la source</button>
                <button className="bo-btn" type="button" onClick={() => traiter(t.id)} disabled={enCours}>Marquer traitée</button>
              </>
            )}
          </div>
        );
      }) : <p className="bo-note">Aucune demande.</p>}
    </div>
  );
}
