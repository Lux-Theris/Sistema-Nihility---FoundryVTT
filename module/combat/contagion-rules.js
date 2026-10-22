/**
 * Contágio (backlog B3) — a parte pura e testada. Quem procura Tokens, rola e aplica é
 * `combat/contagion.js`.
 *
 * Uma Condição do catálogo com `spread` se espalha: no início do turno de quem a carrega, cada
 * Personagem num raio rola a chance de pegar. Traço da lista `immuneTraits` dá imunidade; a
 * Resistência aos elementos da Condição reduz a chance na mesma proporção (100% = imune).
 */

/** `spread` limpo: `{chance 0–100, radius > 0 em metros, immuneTraits[]}`, ou null se não espalha. */
export function normalizeSpread(spread) {
  const chance = Math.min(100, Math.max(0, Math.round(Number(spread?.chance) || 0)));
  const radius = Math.max(0, Number(spread?.radius) || 0);
  if (!chance || !radius) return null;
  const immuneTraits = Array.isArray(spread?.immuneTraits) ? spread.immuneTraits.filter(t => typeof t === "string" && t) : [];
  return { chance, radius, immuneTraits };
}

/**
 * Chance de pegar, em %, depois da proteção.
 * @param {{chance:number, resistance?:number, immune?:boolean}} input - `resistance` 0–1
 */
export function contagionChance({ chance, resistance = 0, immune = false }) {
  if (immune) return 0;
  const r = Math.min(1, Math.max(0, Number(resistance) || 0));
  return Math.max(0, Math.round((Number(chance) || 0) * (1 - r)));
}

/** Dois pontos (pixels) estão a até `radius` metros? `pxPerUnit` = pixels por metro da cena. */
export function withinRadius(a, b, radius, pxPerUnit) {
  const meters = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0)) / (Number(pxPerUnit) || 1);
  return meters <= (Number(radius) || 0) + 1e-6;
}

/** Algum Traço do alvo está na lista de imunes? */
export function immuneByTrait(targetTraits, immuneTraits) {
  const set = new Set(targetTraits ?? []);
  return (immuneTraits ?? []).some(t => set.has(t));
}
