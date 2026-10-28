// Primitives du système de design (M3-106). Styles : src/composants/composants.css
// (préfixe ui-), qui ne s'appuie que sur les jetons var(--…) du bloc .cr.

export { Titre, type TitreProps, type NiveauTitre, type BaliseTitre } from "./Titre";
export { Carte, type CarteProps, type VarianteCarte } from "./Carte";
export { Tuile, type TuileProps, type TonTuile, type Tendance } from "./Tuile";
export { Etiquette, slugRubrique, type EtiquetteProps, type TonEtiquette, type StatutCle } from "./Etiquette";
export { Vide, type VideProps } from "./Vide";
export { Bouton, type BoutonProps, type VarianteBouton, type TailleBouton } from "./Bouton";
export { Champ, type ChampProps } from "./Champ";
export { Message, type MessageProps, type TonMessage } from "./Message";
export { ConfirmationSurPlace, type ConfirmationSurPlaceProps } from "./ConfirmationSurPlace";
export { transition as transitionConfirmation, cibleFocus as cibleFocusConfirmation, type EtatConfirmation, type EvenementConfirmation } from "./ConfirmationSurPlace.logique";
export { PageErreur, type PageErreurProps } from "./PageErreur";
export { Tiroir, type TiroirProps, type CoteTiroir } from "./Tiroir";
export { formatTiroir, SEUILS_TIROIR, type FormatTiroir } from "./Tiroir.logique";
