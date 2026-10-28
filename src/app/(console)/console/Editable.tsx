"use client";

// Un champ contenteditable sous React, NON contrôlé : React ne pose aucun
// enfant dans l'élément, donc ne touche jamais au texte que l'on tape ; le
// texte initial est écrit une fois, et réécrit seulement quand la valeur
// change ailleurs (plan Hn, régénération) et que le champ n'a pas le focus.
// C'est le prototype demandé en tête de la phase 4 : il tient, pas de plan B.

import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

export function Editable({ tag = "div", className, value, placeholder, onInput, onBlur, entreeValide = false }: {
  tag?: keyof HTMLElementTagNameMap;
  className?: string;
  value: string;
  placeholder?: string;
  onInput: (texte: string) => void;
  onBlur?: () => void;
  /* Entrée quitte le champ (titre, chapô, signature) au lieu d'insérer une ligne. */
  entreeValide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  }, [value]);
  const Tag = tag as "div";
  return (
    <Tag ref={ref} className={className} contentEditable suppressContentEditableWarning data-ph={placeholder} aria-placeholder={placeholder}
         onInput={(e: FormEvent<HTMLDivElement>) => onInput(e.currentTarget.textContent ?? "")}
         onBlur={onBlur}
         onKeyDown={entreeValide ? (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } } : undefined} />
  );
}
