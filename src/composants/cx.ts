// Assemblage de classes CSS : ignore les valeurs fausses (false, null, undefined, "").

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
