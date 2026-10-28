// Conséquence écrite de « Débannir » (M3-109, B4) : l'adresse sort de la liste
// noire et peut de nouveau tenter une connexion par mot de passe.

export function consequenceDebannissement(ip: string): string {
  return `L'adresse ${ip} sera retirée de la liste noire et pourra de nouveau se connecter par mot de passe. Si elle dépasse encore le seuil de refus, elle sera rebannie.`;
}
