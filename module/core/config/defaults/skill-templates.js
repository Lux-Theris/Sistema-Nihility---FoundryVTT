/**
 * Modelos de Skill de fábrica (backlog L7; canvas "Editor de Skill Assistido", prancha 2). Cada um
 * é uma Skill no formato solto das Raciais (`skill`), com rótulo, uma frase do que vem pronto
 * (`hint`) e o grupo da janela de criação. "Em branco" não é um modelo: é a opção fixa de sempre.
 * Dados puros: não importa nada.
 */

const effect = (target, amount, rounds, extra = {}) => ({
  target,
  amount,
  durationRounds: rounds,
  conditionId: "",
  periodic: false,
  tickUnit: "combatRound",
  damageElements: [],
  amountMode: "flat",
  modifierType: "flat",
  ...extra
});

const base = { tier: "normal", level: 1, description: "" };

export const DEFAULT_SKILL_TEMPLATES = [
  {
    id: "golpe",
    label: "Golpe",
    hint: "dano físico num alvo",
    group: "dano",
    skill: { ...base, cost: 8, effectType: "damage", targetType: "targeted", damageFormula: "2d6", damageElements: ["physical"], scalingAttribute: "strength" }
  },
  {
    id: "ataque_magico",
    label: "Ataque mágico",
    hint: "dano mágico num alvo",
    group: "dano",
    skill: { ...base, cost: 10, effectType: "damage", targetType: "targeted", damageFormula: "2d6", damageElements: [], scalingAttribute: "magic", isMagicDamage: true }
  },
  {
    id: "area_dano",
    label: "Área de dano",
    hint: "círculo, todos dentro",
    group: "dano",
    skill: { ...base, cost: 25, effectType: "damage", targetType: "emission", areaShape: "circle", areaDistance: 4, areaAngle: 53, damageFormula: "4d6", damageElements: ["fire"], scalingAttribute: "magic", isMagicDamage: true }
  },
  {
    id: "veneno",
    label: "Veneno",
    hint: "dano por rodada",
    group: "dano",
    skill: { ...base, cost: 10, effectType: "temporary", targetType: "targeted", effects: [effect("hp", -5, 3, { periodic: true, conditionId: "poison" })] }
  },
  {
    id: "cura",
    label: "Cura",
    hint: "Vida na hora",
    group: "ajuda",
    skill: { ...base, cost: 12, effectType: "temporary", targetType: "targeted", effects: [effect("heal", 30, 0)] }
  },
  {
    id: "cura_tempo",
    label: "Cura ao longo do tempo",
    hint: "Vida por rodada",
    group: "ajuda",
    skill: { ...base, cost: 12, effectType: "temporary", targetType: "targeted", effects: [effect("hp", 10, 3, { periodic: true, healKind: "cura" })] }
  },
  {
    id: "buff",
    label: "Buff de atributo",
    hint: "+ num aliado, rodadas",
    group: "ajuda",
    skill: { ...base, cost: 8, effectType: "temporary", targetType: "targeted", effects: [effect("strength", 3, 3)] }
  },
  {
    id: "escudo",
    label: "Escudo",
    hint: "absorve dano",
    group: "ajuda",
    skill: { ...base, cost: 12, effectType: "temporary", targetType: "targeted", effects: [effect("shield", 30, 0)] }
  },
  {
    id: "aura",
    label: "Aura",
    hint: "Skill Ativa, buff até desligar",
    group: "ajuda",
    skill: { ...base, cost: 10, hasUpkeep: true, upkeepCost: 3, effectType: "temporary", targetType: "self", effects: [effect("defense", 3, 0)] }
  },
  {
    id: "debuff",
    label: "Debuff com Condição",
    hint: "Lentidão, Medo…",
    group: "controle",
    skill: { ...base, cost: 12, effectType: "temporary", targetType: "targeted", effects: [effect("dexterity", -4, 3, { conditionId: "slow" })] }
  },
  {
    id: "barreira",
    label: "Barreira",
    hint: "Estrutura no mapa",
    group: "controle",
    skill: { ...base, cost: 15, effectType: "structure", targetType: "targeted", structureId: "stone-wall" }
  },
  {
    id: "zona",
    label: "Zona",
    hint: "área que fica e bate todo turno",
    group: "controle",
    skill: { ...base, cost: 20, effectType: "damage", targetType: "zone", areaShape: "circle", areaDistance: 3, areaAngle: 53, zoneRounds: 3, damageFormula: "2d6", damageElements: ["fire"], scalingAttribute: "magic", isMagicDamage: true }
  }
];

/** Grupos da janela de criação, na ordem. */
export const SKILL_TEMPLATE_GROUP_LABELS = { dano: "Dano", ajuda: "Ajuda", controle: "Controle" };
