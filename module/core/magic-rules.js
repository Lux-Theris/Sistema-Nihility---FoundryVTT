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
  if (typeof sys.isMagic === "boolean") return sys.isMagic;
  if (sys.magicTag === "magic") return true;
  if (sys.magicTag === "mundane") return false;
  if (sys.tier !== "racial") return true;
  return (Number(sys.cost) || 0) > 0 || (Boolean(sys.hasUpkeep) && (Number(sys.upkeepCost) || 0) > 0) || Boolean(sys.isMagicDamage);
}

/**
 * A Skill é tecnológica (o PEM alcança)? Só a caixa "Tecnológico" (`isTech`); sem ela, não — o que
 * uma Nave/Módulo concede já nasce com a caixa marcada (ver buildGrantedSkillData). Pura.
 */
export function skillIsTech(sys = {}, actor = null) {
  if (typeof sys.isTech === "boolean") return sys.isTech;
  return ["starship", "vehicle"].includes(actor?.type);
}

/**
 * Item Geral / implante é tecnológico? Caixa `tech`; sem ela (null), implante e prótese e o
 * aparelho do PAD já são tecnológicos por padrão. Pura.
 */
export function itemIsTech(sys = {}) {
  if (typeof sys.tech === "boolean") return sys.tech;
  return Boolean(sys.implant?.enabled) || Boolean(sys.isPadDevice);
}

/** Natureza `{magic, tech}` de um Item Geral (para a Skill que ele concede herdar). */
export function itemNature(sys = {}) {
  return { magic: Boolean(sys.magic), tech: itemIsTech(sys) };
}

/** Natureza `{magic, tech}` de uma Skill já criada (para efeitos e escudos que ela deixa). */
export function skillNature(sys = {}, actor = null) {
  return { magic: skillIsMagic(sys), tech: skillIsTech(sys, actor) };
}

/**
 * Camadas do tipo OPOSTO protegem: um Escudo (ou Estrutura) só mágico segura o que o PEM acabaria;
 * um só tecnológico segura o que a Antimagia acabaria. Tecnomágico (as duas) não protege de nada —
 * é desfeito pelos dois. Pura.
 * @param {"magic"|"tech"} kind - o tipo do efeito que quer acabar (Antimagia = "magic", PEM = "tech")
 * @param {{magic?:boolean, tech?:boolean, value?:number}[]} shieldKinds - camadas de Escudo (só conta value > 0)
 * @param {{magic?:boolean, tech?:boolean}[]} structureKinds - Estruturas no caminho ou em volta do alvo
 */
export function protectedFromKind({ kind = "magic", shieldKinds = [], structureKinds = [] } = {}) {
  const own = kind === "tech" ? "tech" : "magic";
  const other = own === "tech" ? "magic" : "tech";
  const protects = layer => Boolean(layer?.[other]) && !layer?.[own];
  return shieldKinds.some(l => (l?.value === undefined || Number(l.value) > 0) && protects(l)) || structureKinds.some(protects);
}

/** "magic" | "tech": a chave do booleano de natureza em fontes (efeito, Estrutura, mod). */
export const NATURE_KINDS = ["magic", "tech"];

/** Chaves das Skills pré-feitas do sistema (`system.coreSkill`). */
export const CORE_SKILLS = { manipulation: "manaManipulation", detection: "manaDetection", concealment: "concealment" };

/**
 * Nível de Manipulação de quem tem estas Skills (a mais alta com `coreSkill` de Manipulação;
 * Skill concedida por Item conta). 0 = não tem. Pura.
 * @param {{coreSkill?:string, level?:number}[]} skills - o `system` de cada Skill do Ator
 */
export function manipulationLevelOf(skills = []) {
  return skills.reduce((best, s) => (s?.coreSkill === CORE_SKILLS.manipulation ? Math.max(best, Number(s.level) || 0) : best), 0);
}

/**
 * O que um campo de Antimagia/Interferência (ou Selo) faz com um USO (regra do dono, 12/11).
 * - `inside`: quem usa está dentro do campo ou sob Selo; senão o uso vem de fora e cruza o campo.
 * - A força do campo contra o uso: tecnologia nunca tem contra (f = 1); magia sem Manipulação
 *   também não (f = 1); com Manipulação vale a curva do bloqueio de cura (`healBlockReduction`).
 * - f = 1: de dentro → "blocked" (nada acontece, nada se gasta); de fora → "vanish" (já pago, some).
 * - 0 < f < 1: "extra" = `ceil(custo-base × f)` a mais de energia (sem ela, de dentro "blocked",
 *   de fora "vanish" — quem chama confere o saldo).
 * - f = 0: "pass", de graça. Sem campo (nível 0): "pass".
 * @returns {{action:"blocked"|"vanish"|"extra"|"pass", extra:number, factor:number, resisted:boolean}}
 *   `resisted` = a Manipulação deixou algo passar (f < 1 com campo): dá XP por uso à Skill.
 */
export function fieldUseOutcome({ inside = false, kind = "magic", manipulationLevel = 0, fieldLevel = 0, baseCost = 0, zeroMultiplier = 2 } = {}) {
  const field = Math.max(0, Number(fieldLevel) || 0);
  if (field <= 0) return { action: "pass", extra: 0, factor: 0, resisted: false };
  const manipulation = Math.max(0, Number(manipulationLevel) || 0);
  const factor = kind === "tech" || manipulation <= 0 ? 1 : healBlockReduction(manipulation, field, zeroMultiplier);
  if (factor >= 1) return { action: inside ? "blocked" : "vanish", extra: 0, factor, resisted: false };
  if (factor <= 0) return { action: "pass", extra: 0, factor, resisted: true };
  return { action: "extra", extra: Math.ceil(Math.max(0, Number(baseCost) || 0) * factor), factor, resisted: true };
}

/**
 * Efeitos que uma Antimagia de nível `level` corta: os mágicos de nível ≤ o dela.
 * @param {Array<{id:string, level?:number, magic?:boolean}>} effects
 * @param {"magic"|"tech"} [kind] - Antimagia corta "magic" (inclui tecnomágico); o PEM corta "tech".
 * @returns {string[]} ids
 */
export function dispelledEffects(effects = [], level = 0, kind = "magic") {
  const lvl = Math.max(0, Number(level) || 0);
  return effects.filter(e => e[kind] && (Number(e.level) || 0) <= lvl).map(e => e.id);
}

/** Escopos do efeito Dissipar: tudo o que é mágico, só marcas, ou uma Condição escolhida. */
export const DISPEL_SCOPES = ["all", "marks", "condition"];
export const DISPEL_SCOPE_LABELS = { all: "todo efeito mágico", marks: "só marcas", condition: "só uma Condição" };

/**
 * Dissipar (8d.2): quais efeitos do alvo acabam. Só os MÁGICOS de nível ≤ o da Skill (alcance = o nível,
 * sem o ×1,5 da Antimagia). `scope`: "all" = qualquer um deles; "marks" = só os de Condição marcada como
 * marca (`markIds`); "condition" = só os da Condição `conditionId`. Pura.
 * @param {Array<{id:string, level?:number, magic?:boolean, conditionId?:string}>} effects
 * @returns {string[]} ids
 */
export function dissipatedEffects(effects = [], { level = 0, scope = "all", conditionId = "", markIds = [] } = {}) {
  const lvl = Math.max(0, Number(level) || 0);
  const marks = new Set(markIds);
  return effects
    .filter(e => {
      if (!e.magic || (Number(e.level) || 0) > lvl) return false;
      if (scope === "marks") return Boolean(e.conditionId) && marks.has(e.conditionId);
      if (scope === "condition") return Boolean(conditionId) && e.conditionId === conditionId;
      return true;
    })
    .map(e => e.id);
}

/** Uma fonte mágica de nível `level` está suprimida por uma supressão de nível `suppression`? */
export function isSuppressedBy(level, suppression) {
  if (suppression === null || suppression === undefined) return false;
  return (Number(level) || 0) <= Number(suppression);
}

/**
 * Supressão do campo de antimagia: o que fazer com a que o Token carrega, dado o nível do campo em
 * que ele está agora (0 = fora de qualquer campo) e o nível da que já existe (null = nenhuma).
 * "create"/"update" gravam, "remove" tira (saiu do campo), "keep" e "none" não fazem nada. Pura.
 */
export function fieldSuppressionPlan({ fieldLevel = 0, existingLevel = null } = {}) {
  const field = Math.max(0, Math.floor(Number(fieldLevel) || 0));
  const has = existingLevel !== null && existingLevel !== undefined;
  if (field <= 0) return has ? "remove" : "none";
  if (!has) return "create";
  return Number(existingLevel) === field ? "keep" : "update";
}

/**
 * Um efeito mágico de nível `level` sobre quem está num campo de nível `fieldLevel` seria desfeito
 * na hora (o campo alcança até o nível dele). Pura.
 */
export function effectEndedByField({ magic = false, level = 0, fieldLevel = 0 } = {}) {
  return Boolean(magic) && (Number(fieldLevel) || 0) > 0 && (Number(level) || 0) <= (Number(fieldLevel) || 0);
}
