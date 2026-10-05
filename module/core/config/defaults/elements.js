/**
 * Tipos de Dano (fantasia e sci-fi) e Condições de fábrica.
 * Dados puros, referenciados por MEU_SISTEMA (core/config/constants.js); importe de
 * `core/config.js`. Separado em 1.68.0 sem mudar nenhum valor.
 */

/**
 * Cortante, Perfurante e Contundente — subtipos do Físico. Fora do objeto porque a migração
 * `physicalSubtypes` acrescenta exatamente estes num catálogo de Tipos de Dano já salvo.
 */
export const PHYSICAL_SUBTYPES = [
  { id: "slashing", label: "Cortante", color: "#c9ced9", group: "Físico", parent: "physical", effects: [{ type: "sever", chance: 10 }, { type: "condition", conditionId: "bleeding", chance: 25 }] },
  { id: "piercing", label: "Perfurante", color: "#a7b0c8", group: "Físico", parent: "physical", effects: [{ type: "penetration", percent: 20 }] },
  { id: "blunt", label: "Contundente", color: "#8c93ad", group: "Físico", parent: "physical", effects: [{ type: "traitBonus", trait: "mechanical", percent: 20 }, { type: "condition", conditionId: "stun", chance: 10 }] }
];

/** Tipos de dano elemental padrão, sobrescritos pela setting `damageElementsData` (editor visual). */
export const DEFAULT_DAMAGE_ELEMENTS = [
  { id: "physical", label: "Físico", color: "#9aa1c2", group: "Físico", effects: [] },
  // Subtipos do Físico ("Subtipo de", `parent`): Resistência Física vale para os três, e a deles
  // entra depois (Geral → Físico → Cortante). Armas e Skills "Físico" continuam o golpe genérico.
  ...PHYSICAL_SUBTYPES,
  // `affinity`: vantagem contra outros elementos (−2 Imune … 2 Super efetivo) — ver a tabela no editor.
  // Fogo e Ácido cauterizam: a Regeneração não age por 2 rodadas (o troll só morre assim).
  { id: "fire", label: "Fogo", color: "#ff7043", group: "Fantasia", effects: [{ type: "condition", conditionId: "burn", chance: 25 }, { type: "blockRegen", chance: 100, rounds: 2 }], affinity: { ice: 1 } },
  { id: "ice", label: "Gelo", color: "#6ee7ff", group: "Fantasia", effects: [{ type: "condition", conditionId: "slow", chance: 25 }], affinity: { fire: -1 } },
  { id: "lightning", label: "Elétrico", color: "#ffe066", group: "Fantasia", effects: [] },
  { id: "acid", label: "Ácido", color: "#8bc34a", group: "Fantasia", effects: [{ type: "blockRegen", chance: 100, rounds: 2 }] },
  { id: "dark", label: "Sombrio", color: "#7b5ea7", group: "Fantasia", effects: [], affinity: { holy: 1 } },
  { id: "holy", label: "Sagrado", color: "#e8c170", group: "Fantasia", effects: [], affinity: { dark: 1 } }
];

/** Elementos de energia estilo Star Trek Online — carregados pelo preset Sci-Fi. */
export const SCIFI_DAMAGE_ELEMENTS = [
  // Cinético/torpedo: fraco contra Escudo, forte contra Casco (Elite e Star Trek Online).
  { id: "kinetic", label: "Cinético", color: "#b0b7d6", group: "Físico", effects: [
    { type: "layer", layer: "shield", percent: -50 }, { type: "layer", layer: "casco", percent: 30 }, { type: "layer", layer: "hull", percent: 10 }
  ] },
  // Phaser: bom no Escudo, fraco no Casco; chance de derrubar um sistema.
  { id: "phaser", label: "Phaser", color: "#ff9f43", group: "Energia", effects: [
    { type: "layer", layer: "shield", percent: 20 }, { type: "layer", layer: "casco", percent: -20 }, { type: "moduleDisable", chance: 10, rounds: 2 }
  ] },
  // Disruptor: atravessa um pouco e amolece as defesas do alvo.
  { id: "disruptor", label: "Disruptor", color: "#6ee7a0", group: "Energia", effects: [
    { type: "penetration", percent: 10 }, { type: "resistanceDown", chance: 20, percent: 10, rounds: 2 }
  ] },
  // Plasma: queima (dano contínuo) e morde o Casco.
  { id: "plasma", label: "Plasma", color: "#7bed9f", group: "Energia", effects: [
    { type: "condition", conditionId: "burn", chance: 25 }, { type: "layer", layer: "casco", percent: 15 }
  ] },
  // Pólaron: forte contra orgânicos e drena a energia do alvo.
  { id: "polaron", label: "Pólaron", color: "#a29bfe", group: "Energia", effects: [
    { type: "traitBonus", trait: "organic", percent: 20 }, { type: "energyDrain", chance: 20, percent: 15, rounds: 2 }
  ] },
  { id: "tetryon", label: "Táquion", color: "#74b9ff", group: "Energia", effects: [{ type: "layer", layer: "shield", percent: 30 }] },
  { id: "antiproton", label: "Antiprótons", color: "#fd79a8", group: "Energia", effects: [{ type: "layer", layer: "hull", percent: 15 }] },
  { id: "transphasic", label: "Transfásico", color: "#e8c170", group: "Exótico", effects: [{ type: "penetration", percent: 40 }] }
];

/**
 * Condições nomeadas padrão, sobrescritas pela setting `statusConditionsData` (editor
 * visual, mesmo padrão de Moedas/Elementos de Dano). Puramente ícone + rótulo — dão nome
 * reconhecível (e ícone de status no token, via `ActiveEffect.statuses`) a uma entrada de
 * `effects[]` de uma Skill, mas NÃO bloqueiam ação nenhuma sozinhas: o Mestre arbitra o que
 * "cego"/"atordoado" impede na mesa, o sistema só automatiza o número por trás (debuff de
 * atributo, ou dano/cura por tick se `periodic: true`). Ícones são os SVGs já embutidos no
 * core do Foundry (`icons/svg/*`), sem depender de asset externo.
 */
export const DEFAULT_STATUS_CONDITIONS = [
  { id: "blindness", label: "Cegueira", icon: "icons/svg/blind.svg" },
  // Selo antimagia: toda magia de quem tem o selo paga Mana extra (ver antimagicSurcharge).
  { id: "antimagic-seal", label: "Selo Antimagia", icon: "icons/svg/padlock.svg", antimagicLevel: 1 },
  { id: "poison", label: "Veneno", icon: "icons/svg/poison.svg",
    effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } },
  { id: "burn", label: "Queimadura", icon: "icons/svg/fire.svg",
    effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 10, durationRounds: 2, tickUnit: "combatRound" } },
  { id: "slow", label: "Lentidão", icon: "icons/svg/frozen.svg",
    effect: { kind: "modifier", modTarget: "movement", modMode: "percent", value: -50, durationRounds: 2 } },
  { id: "stun", label: "Atordoamento", icon: "icons/svg/daze.svg" },
  { id: "silence", label: "Silêncio", icon: "icons/svg/silenced.svg" },
  { id: "paralysis", label: "Paralisia", icon: "icons/svg/paralysis.svg" },
  { id: "fear", label: "Medo", icon: "icons/svg/terror.svg" },
  { id: "bleeding", label: "Sangramento", icon: "icons/svg/blood.svg",
    effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } },
  { id: "regeneration", label: "Regeneração", icon: "icons/svg/regen.svg",
    effect: { kind: "tick", tickTarget: "hp", tickSign: "heal", healKind: "regeneracao", valueMode: "maxPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } },
  // Marca "Impede cura" (`healBlock`): só Regeneração ou toda cura, no corpo todo ou só na parte
  // atingida; o nível é o de quem aplicou (ver healBlockReduction). É a Condição que o efeito de
  // elemento "Impede regeneração" aplica (0 rodadas = até ser removida).
  { id: "regen-blocked", label: "Regeneração bloqueada", icon: "icons/svg/acid.svg", healBlock: { kinds: "regen", scope: "body" } },
  // Antimagia (prancha 8): enquanto durar, passivos, Resistências, itens e implantes mágicos de
  // nível ≤ o da supressão não contam, e Habilidades Ativas mágicas desse nível não ligam.
  { id: "antimagic-suppressed", label: "Suprimido (Antimagia)", icon: "icons/svg/cancel.svg", suppressesMagic: true },
  // Exemplo de Maldição (prancha 6): vários efeitos, sem prazo, paga pela Mana da vítima.
  { id: "curse-blood", label: "Maldição de Sangue", icon: "icons/svg/blood.svg", healBlock: { kinds: "regen", scope: "body" },
    curse: { enabled: true, costPercent: 5, onUnpaid: "hp", worsenStep: 25, worsenCap: 3, effects: [
      { kind: "modifier", modTarget: "strength", modMode: "percent", value: -20 },
      { kind: "modifier", modTarget: "movement", modMode: "percent", value: -30 },
      { kind: "tick", tickSign: "damage", tickTarget: "hp", valueMode: "maxPercent", value: 2 }
    ] } },
  // Usadas pelas Funções de Parte (Ferimentos por parte): só o marcador, o Mestre arbitra.
  { id: "deafness", label: "Surdo", icon: "icons/svg/deaf.svg" },
  { id: "maimed", label: "Sem mão", icon: "icons/svg/bones.svg" },
  { id: "unbalanced", label: "Desequilibrado", icon: "icons/svg/falling.svg" }
];
