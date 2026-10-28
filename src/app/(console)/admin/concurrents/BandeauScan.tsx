"use client";

// Bandeau du scan des concurrents (M3-122) : en cours, dernier passage, prochain
// créneau ou « scan quotidien désactivé », et le bouton « Lancer le scan ». Le
// bouton ne bloque pas : le serveur répond tout de suite et le scan tourne
// derrière ; le bandeau se relit tant qu'il tourne, puis la page se recharge
// (dernier scan de chaque concurrent, nouveaux candidats).

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bouton } from "@/composants/Bouton";
import { useFlash } from "@/composants/Toast";
import { lienParametres, texteBandeau, type EtatScan } from "@/gererConcurrents/gererConcurrents.regles";
import { lancerScan, relireEtatScan } from "@/gererConcurrents/gererConcurrents.action";

const RELECTURE_MS = 5000;

export function BandeauScan({ initial, role }: { initial: EtatScan | null; role: string }) {
  const flash = useFlash();
  const router = useRouter();
  const [etat, setEtat] = useState<EtatScan | null>(initial);
  const [suivre, setSuivre] = useState(!!initial?.running);
  const [enCours, lancer] = useTransition();

  useEffect(() => {
    if (!suivre) return;
    const t = setInterval(async () => {
      const r = await relireEtatScan();
      if (!r.ok) return;
      setEtat(r.data.scan);
      if (!r.data.scan?.running) { setSuivre(false); router.refresh(); }
    }, RELECTURE_MS);
    return () => clearInterval(t);
  }, [suivre, router]);

  const demarrer = () => lancer(async () => {
    const r = await lancerScan();
    if (!r.ok) return flash(r.erreur, true);
    flash("Scan lancé : il tourne en arrière-plan, les candidats arriveront à la fin.");
    const e = await relireEtatScan();
    if (e.ok) setEtat(e.data.scan);
    setSuivre(true);
  });

  const t = texteBandeau(etat);
  const indisponible = !etat;
  return (
    <div className="bo-card" aria-live="polite">
      <h3>Scan des concurrents {etat?.running && <span className="bo-note">en cours</span>}</h3>
      {t.etat && !indisponible && <p className="bo-ok">{t.etat}</p>}
      <p className={indisponible ? "bo-note" : undefined}>{t.dernier}</p>
      {t.prochain && <p className="bo-note">{t.prochain}{lienParametres(role) && <> · <Link href="/admin/parametres">Réglages du scan dans Paramètres</Link></>}</p>}
      <div className="bo-actions">
        <Bouton variante="primaire" icone="RotateCcw" onClick={demarrer} disabled={indisponible || !!etat?.running || enCours} chargement={enCours}
          title="Lit maintenant les concurrents actifs ; marche même si le scan quotidien est désactivé">Lancer le scan</Bouton>
      </div>
    </div>
  );
}
