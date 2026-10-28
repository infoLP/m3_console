"use client";

// Le formulaire de connexion (classes de styles/login.css). La soumission est
// une action serveur (useActionState).

import { useActionState, useEffect, useRef } from "react";
import { seConnecter, type EtatConnexion } from "@/seConnecter/seConnecter.action";
import { affichage, type Modes } from "@/seConnecter/seConnecter.regles";

export function FormulaireConnexion({ modes, retour, erreurInitiale }: { modes: Modes; retour: string; erreurInitiale: string | null }) {
  const [etat, soumettre, enCours] = useActionState<EtatConnexion, FormData>(seConnecter, {});
  const a = affichage(modes);
  const erreur = etat.erreur ?? erreurInitiale;
  const champLogin = useRef<HTMLInputElement>(null);
  const champMdp = useRef<HTMLInputElement>(null);

  useEffect(() => { if (a.formulaire) champLogin.current?.focus(); }, [a.formulaire]);
  /* Après un refus : le mot de passe est vidé et reprend le focus, comme avant. */
  useEffect(() => {
    if (etat.erreur && champMdp.current) { champMdp.current.value = ""; champMdp.current.focus(); }
  }, [etat]);

  return (
    <div className="lg-box">
      <h1 className="lg-brand">M3</h1>
      <p className="lg-sub">Console de rédaction</p>

      <p className={`lg-err${erreur ? " on" : ""}`} role="alert">{erreur ?? ""}</p>

      {a.sso && (
        <section id="sso">
          {/* Un lien et non un bouton : partir vers Microsoft est une navigation. */}
          <a className="lg-sso-btn" href={`/auth/login?next=${encodeURIComponent(retour)}`}>Se connecter avec mon compte Windows</a>
          <p className="lg-sso-hint">Sur un poste de l’entreprise, aucune saisie n’est nécessaire.</p>
        </section>
      )}

      {a.ou && <div className="lg-or">ou</div>}

      {a.formulaire && (
        <form action={soumettre} autoComplete="on">
          <input type="hidden" name="next" value={retour} />
          <div className="lg-field">
            <label className="lg-label" htmlFor="login">Identifiant</label>
            <input ref={champLogin} className="lg-input" id="login" name="login" type="text" autoComplete="username"
                   autoCapitalize="off" spellCheck={false} required placeholder="p.nom@legalprime.fr" />
          </div>
          <div className="lg-field">
            <label className="lg-label" htmlFor="password">Mot de passe</label>
            <input ref={champMdp} className="lg-input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className={`lg-btn${a.motDePasseSecondaire ? " lg-alt" : ""}`} type="submit" disabled={enCours}>
            {enCours ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      )}

      <p className="lg-note">{a.note}</p>
    </div>
  );
}
