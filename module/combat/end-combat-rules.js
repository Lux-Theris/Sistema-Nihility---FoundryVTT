/**
 * Fim do combate (backlog L11 + H11; mockup aprovado "Fim do Combate", quadro 1, aberto ao
 * encerrar o combate do Foundry — opção A) — a parte pura e testada. A janela é
 * `apps/end-combat.js`.
 */

/**
 * XP sugerida pelos derrotados: para cada NPC derrotado, `percent`% da XP que o nível dele pede
 * para subir (`xpFor(level)`, a curva do mundo). Só uma sugestão: o Mestre edita.
 * @param {number[]} levels
 * @param {{xpFor: (level:number) => number, percent?: number}} options
 */
export function suggestCombatXp(levels, { xpFor, percent = 25 } = {}) {
  const pct = Math.max(0, Number(percent) || 0) / 100;
  let total = 0;
  for (const level of levels ?? []) {
    const lvl = Math.max(1, Math.round(Number(level) || 1));
    total += Math.round((Number(xpFor?.(lvl)) || 0) * pct);
  }
  return total;
}

/** Divide o total em `n` partes inteiras iguais; o resto vai, 1 a 1, para as primeiras. */
export function splitXp(total, n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (!count) return [];
  const sum = Math.max(0, Math.floor(Number(total) || 0));
  const base = Math.floor(sum / count);
  const rest = sum - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Um efeito entra na lista de "ainda correndo" quando tem prazo contado em rodadas/ticks (fora de
 * combate ele congelaria) ou é o contador do Caído/Inconsciente. Vem marcado para remover, menos o
 * Caído/Inconsciente — quem decide se estabiliza ou cura é o Mestre.
 * @param {{text:string, tone:string}|null} badge - de effectBadge (combat/effect-badge-rules.js)
 * @returns {{listed: boolean, checked: boolean}}
 */
export function endCombatEffectChoice(badge) {
  if (!badge) return { listed: false, checked: false };
  if (badge.tone === "time") return { listed: true, checked: true };
  if (badge.tone === "danger") return { listed: true, checked: false };
  return { listed: false, checked: false };
}
