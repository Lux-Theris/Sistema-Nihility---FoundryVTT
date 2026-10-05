/**
 * Curvas de progressão e fórmulas lidas das Regras da Mesa: XP, nível de Skill, escala de dano, Vida/Mana, pontos.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { MEU_SISTEMA, SYSTEM_ID } from "./constants.js";
import { isEnergyPoolEnabled } from "./features.js";

/**
 * XP necessário para sair de `level` para o próximo. A fórmula é uma setting (padrão
 * `100 * @nivel`, ou seja 100 no nv 1, 1000 no nv 10) porque a curva certa depende da campanha:
 * o poder do personagem cresce de forma QUADRÁTICA (HP = Atributo × Atributo × mult, sobre
 * pontos que crescem linearmente por nível), então uma curva linear de XP mantém o preço por
 * ponto de poder quase constante, enquanto uma quadrática vira um teto disfarçado.
 *
 * Avaliada por `Roll.safeEval` (só aritmética, nunca código do usuário). Fórmula inválida cai no
 * padrão em vez de quebrar a ficha.
 * @param {number} level
 * @returns {number} XP para o próximo nível (mínimo 1)
 */
export function getXpForNextLevel(level) {
  const safeLevel = Math.max(1, Math.round(Number(level) || 1));
  const fallback = 100 * safeLevel;
  let formula;
  try {
    formula = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.xpFormula);
  } catch (err) {
    return fallback;
  }
  if (!formula?.trim()) return fallback;

  try {
    const value = Roll.safeEval(String(formula).replaceAll("@nivel", String(safeLevel)));
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Fórmula de XP inválida ("${formula}") — usando o padrão.`, err);
    return fallback;
  }
}

/** Golpes de um mesmo tipo até o sistema sugerir a Resistência ao Mestre (0 = aviso desligado). */
export function getResistanceLearnThreshold() {
  try {
    const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.resistanceLearnThreshold));
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 25;
  } catch (err) {
    return 25;
  }
}

/**
 * XP que uma Skill de Resistência ganha por ter bloqueado `blocked` de dano num defensor com
 * `maxHp` de Vida Máxima.
 *
 * É proporcional à FRAÇÃO da própria Vida que foi salva, nunca ao número absoluto de dano: como
 * o dano deste sistema escala com o quadrado do atributo, XP proporcional ao dano bruto
 * inflacionaria sozinho (a mesma defesa renderia dezenas de vezes mais XP no fim da campanha que
 * no começo, e a Skill subiria de nível sem esforço). Em fração, defender um golpe igualmente
 * perigoso rende o mesmo XP em qualquer nível — e arranhão continua rendendo 0.
 * @returns {number} XP inteiro (0 quando o bloqueio foi irrelevante perto da Vida do defensor)
 */
export function resistanceXpGain(blocked, maxHp) {
  if (!(blocked > 0) || !(maxHp > 0)) return 0;

  let factor = 100;
  try {
    const configured = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.resistanceXpFactor));
    if (Number.isFinite(configured) && configured >= 0) factor = configured;
  } catch (err) {
    /* setting ainda não registrada — segue no padrão */
  }

  return Math.round((blocked / maxHp) * factor);
}

/**
 * O que o nível de uma Skill entrega, acumulado do nível 1 até `level`.
 *
 * O nível avança num CICLO fixo e previsível: N níveis de Poder (cada um multiplica o efeito da
 * Skill) seguidos de M níveis de Desconto (cada um corta o Custo), repetindo pra sempre. O
 * jogador sempre sabe o que o próximo nível dá sem consultar tabela — é o motivo de o ciclo ser
 * fixo em vez de uma tabela por nível.
 *
 * Duas regras não-óbvias, ambas deliberadas:
 *  - **Os dois são multiplicativos, nunca subtrativos.** Um desconto de -20% subtrativo levaria o
 *    custo ao piso em 5 níveis e tornaria todo o resto da curva inútil; multiplicativo, o piso
 *    chega por volta do nível 24 com os padrões atuais.
 *  - **Nível de Desconto que cai com o custo JÁ no piso vira nível de Poder.** Sem isso, toda
 *    Skill que passa do piso acumula níveis que não entregam nada (13 níveis mortos até o nível
 *    50, nos padrões) — e o Mestre ainda teria gasto o clique de Level Up em cada um.
 *
 * Skill de Resistência não passa por aqui: ela tem progressão própria (10%/nível, ver
 * `computeResistancePercent`) e teto de nível próprio.
 * @param {number} level
 * @returns {{power: number, cost: number}} multiplicadores (1 = sem alteração)
 */
export function skillLevelBonuses(level) {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };

  const powerStep = read("skillPowerPerLevel", 10) / 100;
  const discountStep = read("skillDiscountPerLevel", 20) / 100;
  const floor = Math.clamp(read("skillCostFloorPercent", 10) / 100, 0, 1);
  const powerLevels = Math.max(0, Math.round(read("skillCyclePower", 2)));
  const discountLevels = Math.max(0, Math.round(read("skillCycleDiscount", 2)));

  const cycle = [...Array(powerLevels).fill("power"), ...Array(discountLevels).fill("discount")];
  const safeLevel = Math.max(1, Math.round(Number(level) || 1));
  if (!cycle.length) return { power: 1, cost: 1 };

  let power = 1;
  let cost = 1;
  for (let i = 0; i < safeLevel - 1; i++) {
    const atFloor = cost <= floor + 1e-9;
    // Desconto com o custo já no piso não teria efeito nenhum — vira Poder (ver acima).
    const phase = cycle[i % cycle.length] === "discount" && !atFloor ? "discount" : "power";
    if (phase === "power") power *= 1 + powerStep;
    else cost = Math.max(floor, cost * (1 - discountStep));
  }

  return { power, cost };
}

/**
 * Custo de Energia efetivo de uma Skill/Sub-Skill no nível dela — o valor escrito na Skill já
 * com o desconto acumulado do ciclo. Uma Skill que custa alguma coisa nunca fica de graça por
 * arredondamento: o mínimo é 1.
 * @param {number} baseCost - `cost` ou `upkeepCost` escrito na Skill
 * @param {number} level
 */
export function effectiveSkillCost(baseCost, level) {
  const base = Number(baseCost) || 0;
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * skillLevelBonuses(level).cost));
}

/**
 * Multiplicador de dano vindo do Atributo de Escala de uma Skill: `(Atributo.Total)² ÷ divisor`.
 *
 * A forma é QUADRÁTICA de propósito, não por gosto: o HP deste sistema é
 * `Atributo × Atributo × multiplicador`, ou seja cresce com o quadrado dos pontos investidos.
 * Qualquer escala linear de dano (somar o bônus, multiplicar pelo total) é engolida pela curva
 * de HP — um alvo de mesmo nível passaria de ~24 golpes no nível 1 para ~200 no nível 50. Com a
 * forma quadrática o número de golpes fica constante em toda a campanha, e quem controla o
 * ritmo é o divisor (setting) e a fórmula de dado escrita na Skill.
 *
 * Sem Atributo de Escala escolhido (`""`, o padrão) devolve 1 — toda Skill criada antes desta
 * regra continua causando exatamente o dano que sempre causou.
 * @param {Actor} actor - quem está usando a Skill
 * @param {string} attributeKey - `mech.scalingAttribute`
 * @returns {number} fator multiplicativo (1 = sem escala)
 */
export function damageScalingMultiplier(actor, attributeKey) {
  if (!attributeKey || !MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(attributeKey)) return 1;

  const total = actor?.system?.attributes?.combat?.[attributeKey]?.total ?? 0;
  if (total <= 0) return 1;

  let divisor = 10;
  try {
    const configured = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.damageScalingDivisor));
    if (Number.isFinite(configured) && configured > 0) divisor = configured;
  } catch (err) {
    /* setting ainda não registrada — segue no padrão */
  }

  return (total * total) / divisor;
}

/**
 * Fórmula de HP/Mana Máximo, configurável pelo Mestre (ver `deriveVitalStats` em
 * data/character-model.js). O formato é sempre `Atributo A .Total × Atributo B .Total ×
 * multiplicador`, com um piso — o que muda por campanha é QUAIS atributos entram e com que
 * escala. É isso que permite uma campanha sem magia: basta apontar a Mana pra outros dois
 * atributos, ou desligar o pool inteiro (`energyPoolEnabled`).
 *
 * Um atributo removido da lista por engano (ou uma setting de um mundo antigo apontando pra
 * chave que não existe mais) cai no padrão em vez de quebrar a preparação da ficha.
 * @returns {{hp: [string, string], energy: [string, string], multiplier: number, floor: number, energyEnabled: boolean}}
 */
export function getVitalFormula() {
  const read = (key, fallback) => {
    try {
      const value = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]);
      return MEU_SISTEMA.COMBAT_ATTRIBUTES.includes(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  const readNumber = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };

  return {
    hp: [read("hpFormulaPrimary", "strength"), read("hpFormulaSecondary", "defense")],
    energy: [read("energyFormulaPrimary", "magic"), read("energyFormulaSecondary", "magicalDefense")],
    multiplier: readNumber("vitalFormulaMultiplier", MEU_SISTEMA.DEFAULT_VITAL_FORMULA_MULTIPLIER),
    floor: readNumber("vitalFormulaFloor", MEU_SISTEMA.MIN_BASE_VITAL_STAT),
    energyEnabled: isEnergyPoolEnabled()
  };
}

/** Pontos de Atributo/Habilidade concedidos na criação e por nível (settings do Mestre). */
export function getAttributePointsStarting() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributePointsStarting);
}

export function getAttributePointsPerLevel() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.attributePointsPerLevel);
}

export function getSkillPointsStarting() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.skillPointsStarting);
}

export function getSkillPointsPerLevel() {
  return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.skillPointsPerLevel);
}
