/**
 * Nível e magia dos efeitos (prancha 8 do canvas "Rework de Espécies") — regras PURAS, testadas.
 *
 * Todo efeito criado por uma Skill guarda o nível dela (`sourceLevel`) e se é mágico (`magic`).
 * Com isso: a Antimagia corta só o que alcança (efeito mágico de nível ≤ o dela), e uma cura forte
 * passa por cima de um bloqueio de cura (maldição, Fogo/Ácido) de nível menor. Descanso,
 * regeneração natural, Título e o que o Mestre marcou à mão contam como nível 0.
 */

/**
 * Quanto um bloqueio de cura de nível `blockLevel` reduz uma cura de nível `healLevel` (0–1):
 * bloqueio total até o nível do bloqueio + ⅓ dele (maldição 9 → até 12); acima disso a redução cai
 * em linha reta e zera em `zeroMultiplier` × o limite (2× = 24); abaixo de 1%, a cura passa inteira.
 */
export function healBlockReduction(healLevel, blockLevel, zeroMultiplier = 2) {
  const heal = Math.max(0, Number(healLevel) || 0);
  const block = Math.max(0, Number(blockLevel) || 0);
  const limit = block + block / 3;
  if (heal <= limit) return 1;
  const zeroAt = limit * Math.max(1, Number(zeroMultiplier) || 2);
  if (zeroAt <= limit) return 0;
  const reduction = Math.max(0, Math.min(1, 1 - (heal - limit) / (zeroAt - limit)));
  return reduction < 0.01 ? 0 : reduction;
}

/**
 * O bloqueio pega este tipo de cura? "regen" = só Regeneração; "all" = toda cura (Cura,
 * Regeneração, Descanso). Reparo é conserto de máquina: nunca.
 */
export function healBlockApplies(blockKinds, healKind) {
  if (healKind === "reparo") return false;
  if (blockKinds === "all") return true;
  return healKind === "regeneracao";
}

/**
 * Fator final (0–1) de uma cura contra uma lista de bloqueios: fica o pior (a maior redução).
 * @param {Array<{level:number, kinds:string}>} blocks
 */
export function healBlockFactor(blocks = [], healLevel = 0, healKind = "cura", zeroMultiplier = 2) {
  let worst = 0;
  for (const b of blocks) {
    if (!healBlockApplies(b.kinds, healKind)) continue;
    worst = Math.max(worst, healBlockReduction(healLevel, b.level, zeroMultiplier));
  }
  return 1 - worst;
}

/**
 * A Skill é mágica (a Antimagia alcança)? A marca da Skill manda (mágica / mundana); no automático:
 * Skill Racial só se gastar energia ou causar Dano Mágico (teleporte sim, Couro Grosso não); toda
 * outra Skill — inclusive Resistências e passivos — é mágica.
 */
export function skillIsMagic(sys = {}) {
  if (sys.magicTag === "magic") return true;
  if (sys.magicTag === "mundane") return false;
  if (sys.tier !== "racial") return true;
  return (Number(sys.cost) || 0) > 0 || (Boolean(sys.hasUpkeep) && (Number(sys.upkeepCost) || 0) > 0) || Boolean(sys.isMagicDamage);
}

/**
 * Efeitos que uma Antimagia de nível `level` corta: os mágicos de nível ≤ o dela.
 * @param {Array<{id:string, level?:number, magic?:boolean}>} effects
 * @returns {string[]} ids
 */
export function dispelledEffects(effects = [], level = 0) {
  const lvl = Math.max(0, Number(level) || 0);
  return effects.filter(e => e.magic && (Number(e.level) || 0) <= lvl).map(e => e.id);
}

/** Uma fonte mágica de nível `level` está suprimida por uma supressão de nível `suppression`? */
export function isSuppressedBy(level, suppression) {
  if (suppression === null || suppression === undefined) return false;
  return (Number(level) || 0) <= Number(suppression);
}
