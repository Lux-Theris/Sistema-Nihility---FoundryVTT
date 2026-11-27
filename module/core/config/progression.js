/**
 * Curvas de progressão e fórmulas lidas das Regras da Mesa: XP, nível de Skill, escala de dano, Vida/Mana, pontos.
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { NIHILITY, SYSTEM_ID } from "./constants.js";
import { isEnergyPoolEnabled } from "./features.js";
import { damageElementChain } from "./catalogs.js";
import { inheritedElementEffects } from "../../combat/damage-rules.js";
import { levelPlan, maxLevelFor, nextStepKind, collectChances, chanceLevelsNeeded, DEFAULT_CHANCE_POINTS } from "../../skills/chance-rules.js";

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
    formula = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.xpFormula);
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
    const value = Number(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.resistanceLearnThreshold));
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
    const configured = Number(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.resistanceXpFactor));
    if (Number.isFinite(configured) && configured >= 0) factor = configured;
  } catch (err) {
    /* setting ainda não registrada — segue no padrão */
  }

  return Math.round((blocked / maxHp) * factor);
}

/**
 * Os números do ciclo de níveis lidos das Regras da Mesa (poder, desconto, piso, passos por ciclo e os pontos de Chance).
 * Cada leitura cai no padrão se a setting ainda não existe (ordem de inicialização).
 */
function readCycleSettings() {
  const read = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  return {
    powerStep: read("skillPowerPerLevel", 10) / 100,
    discountStep: read("skillDiscountPerLevel", 20) / 100,
    floor: Math.clamp(read("skillCostFloorPercent", 10) / 100, 0, 1),
    powerLevels: Math.max(0, Math.round(read("skillCyclePower", 2))),
    discountLevels: Math.max(0, Math.round(read("skillCycleDiscount", 2))),
    chanceLevels: Math.max(0, Math.round(read("skillCycleChance", 1))),
    chancePoints: Math.max(1, Math.round(read("skillChancePoints", DEFAULT_CHANCE_POINTS)))
  };
}

/** As chances de Condição de um elemento no catálogo (já com as que herda do pai), para as chaves `element:<id>:<n>`. */
function elementConditionChances(elementId) {
  const chain = damageElementChain(elementId).map(el => el.id);
  return inheritedElementEffects(chain.length ? chain : [elementId])
    .filter(effect => effect.type === "condition" && effect.conditionId)
    .map((effect, n) => ({ n, chance: Number(effect.chance) || 0, conditionId: effect.conditionId }));
}

/** As chances desta Skill (ou Sub-Skill) com chave estável, base e sentido. Vazio sem nenhuma. */
export function skillChances(mech) {
  return mech && typeof mech === "object" ? collectChances(mech, elementConditionChances) : [];
}

/** O Custo ou a manutenção que o Desconto do ciclo corta existe? (sem isso, o Desconto não entrega nada) */
function hasDiscountTarget(mech) {
  return (Number(mech?.cost) || 0) > 0 || (Number(mech?.upkeepCost) || 0) > 0 || (Number(mech?.structureRegenCost) || 0) > 0;
}

/**
 * A configuração do ciclo para uma mecânica. Sem mecânica (só o número do nível), é o ciclo de sempre: sem chance e com Custo.
 * @param {object|null} mech - a Skill (`system`) ou a Sub-Skill; com Sub-Skills, as chances delas entram na conta
 */
export function skillCycleConfig(mech = null) {
  const settings = readCycleSettings();
  if (!mech) return { ...settings, chanceNeed: 0, hasDiscount: true };
  return { ...settings, chanceNeed: chanceLevelsNeeded(skillChances(mech), settings.chancePoints), hasDiscount: hasDiscountTarget(mech) };
}

/**
 * O que o nível de uma Skill entrega, acumulado do nível 1 até `level`. Aceita o número do nível ou a mecânica da Skill (com a
 * qual o ciclo conhece as chances dela).
 *
 * O nível avança num CICLO fixo e previsível: N níveis de Poder (cada um multiplica o efeito da Skill), M de Desconto (cada um
 * corta o Custo) e, para a Skill que tem alguma chance, P de Chance (1.124.0: pontos de chance sorteados entre as chances da
 * Skill; ver skills/chance-rules.js), repetindo. O jogador sempre sabe o que o próximo nível dá sem consultar tabela.
 *
 * Regras não-óbvias, todas deliberadas:
 *  - **Poder e Desconto são multiplicativos, nunca subtrativos.** Um desconto de -20% subtrativo levaria o custo ao piso em 5
 *    níveis; multiplicativo, o piso chega por volta do nível 24 com os padrões.
 *  - **Passo que já não entrega nada vai para outro passo:** Desconto com o Custo no piso vira Chance (se ainda há chance
 *    abaixo de 100%); Chance com tudo em 100% vira Desconto (se o Custo ainda não está no piso). A conversão antiga, Desconto
 *    no piso → Poder, deixou de existir: o fim dos dois é o **nível máximo** (`skillMaxLevel`); depois dele só Poder.
 *  - Skill sem chance percorre exatamente o ciclo de antes (teste de ida e volta). Skill sem Custo e sem chance: todo nível é Poder.
 *
 * Skill de Resistência não passa por aqui: ela tem progressão própria (10%/nível, ver `computeResistancePercent`).
 * @param {number|object} levelOrMech - o nível, ou a mecânica (Skill/Sub-Skill) cujo `level` e chances valem
 * @returns {{power: number, cost: number}} multiplicadores (1 = sem alteração)
 */
export function skillLevelBonuses(levelOrMech) {
  const mech = levelOrMech && typeof levelOrMech === "object" ? levelOrMech : null;
  const plan = levelPlan(mech ? mech.level : levelOrMech, skillCycleConfig(mech));
  return { power: plan.power, cost: plan.cost };
}

/**
 * Custo de Energia efetivo de uma Skill/Sub-Skill no nível dela — o valor escrito na Skill já com o desconto acumulado do ciclo.
 * Uma Skill que custa alguma coisa nunca fica de graça por arredondamento: o mínimo é 1.
 * @param {number} baseCost - `cost` ou `upkeepCost` escrito na Skill
 * @param {number|object} levelOrMech - o nível, ou a mecânica da Skill
 */
export function effectiveSkillCost(baseCost, levelOrMech) {
  const base = Number(baseCost) || 0;
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * skillLevelBonuses(levelOrMech).cost));
}

/**
 * O nível máximo automático da Skill (1.124.0): onde o Desconto chega ao piso e toda chance chega a 100%.
 * `Infinity` com a caixa "Sem limite" (`unlimitedLevel`, só do Mestre) ou numa Skill sem Custo e sem chance.
 * @param {object} system - o `system` da Skill (a Sub-Skill não sobe de nível sozinha)
 */
export function skillMaxLevel(system) {
  if (!system || system.unlimitedLevel) return Infinity;
  return maxLevelFor(skillCycleConfig(system));
}

/** A Skill chegou ao nível máximo (e não tem "Sem limite")? Nesse caso o botão de Level Up some e o XP para de entrar. */
export function skillAtMaxLevel(system) {
  return Number(system?.level) >= skillMaxLevel(system);
}

/** O que o próximo nível da Skill dá: "power" | "discount" | "chance" | "beyond". */
export function skillNextStep(system) {
  return nextStepKind(system?.level, skillCycleConfig(system));
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
  if (!attributeKey || !NIHILITY.COMBAT_ATTRIBUTES.includes(attributeKey)) return 1;

  const total = actor?.system?.attributes?.combat?.[attributeKey]?.total ?? 0;
  if (total <= 0) return 1;

  let divisor = 10;
  try {
    const configured = Number(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.damageScalingDivisor));
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
      const value = game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS[key]);
      return NIHILITY.COMBAT_ATTRIBUTES.includes(value) ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };
  const readNumber = (key, fallback) => {
    try {
      const value = Number(game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS[key]));
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch (err) {
      return fallback;
    }
  };

  return {
    hp: [read("hpFormulaPrimary", "strength"), read("hpFormulaSecondary", "defense")],
    energy: [read("energyFormulaPrimary", "magic"), read("energyFormulaSecondary", "magicalDefense")],
    multiplier: readNumber("vitalFormulaMultiplier", NIHILITY.DEFAULT_VITAL_FORMULA_MULTIPLIER),
    floor: readNumber("vitalFormulaFloor", NIHILITY.MIN_BASE_VITAL_STAT),
    energyEnabled: isEnergyPoolEnabled()
  };
}

/** Pontos de Atributo/Habilidade concedidos na criação e por nível (settings do Mestre). */
export function getAttributePointsStarting() {
  return game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.attributePointsStarting);
}

export function getAttributePointsPerLevel() {
  return game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.attributePointsPerLevel);
}

export function getSkillPointsStarting() {
  return game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.skillPointsStarting);
}

export function getSkillPointsPerLevel() {
  return game.settings.get(SYSTEM_ID, NIHILITY.SETTINGS.skillPointsPerLevel);
}
