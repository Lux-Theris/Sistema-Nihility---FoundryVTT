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

/**
 * Reações elementais de fábrica (item 8.1), por elemento do GOLPE: `{elementoCarregado: reação}`.
 * `damagePercent` +50 = ×1,5. Fora do objeto porque a migração `reactionsDefaults` acrescenta estas
 * a um catálogo já salvo (só onde o elemento não tem o campo `reactions`). "Sobrecarga" (Plasma contra
 * escudo de energia) ficou de fora: os elementos de Escudo (`shieldElements`) são escolhidos pelo
 * Mestre e não há um id de "escudo de energia" padrão para a regra apontar.
 */
export const DEFAULT_ELEMENT_REACTIONS = {
  fire: {
    ice: { label: "Derretimento", damagePercent: 50, consume: true, bodyConducts: true, leaveSurface: "water" },
    water: { label: "Vapor", damagePercent: -50, consume: true, bodyConducts: true, applyCondition: { conditionId: "blindness", rounds: 1 }, spread: { radius: 2, sameElement: false } },
    oil: { label: "Explosão", damagePercent: 100, consume: true, leaveSurface: "fire" }
  },
  ice: {
    fire: { label: "Apagar", damagePercent: 0, consume: true, removeCondition: "burn" },
    water: { label: "Congelar", damagePercent: 0, consume: true, applyCondition: { conditionId: "slow", rounds: 1 } }
  },
  lightning: {
    water: { label: "Eletrocutado", damagePercent: 50, consume: true, bodyConducts: true, spread: { radius: 2, sameElement: true } }
  },
  water: {
    fire: { label: "Vapor", damagePercent: 0, consume: true, removeCondition: "burn" }
  }
};

/**
 * Superfícies de fábrica (item 8.2, `FEATURES.surfaces`, desligado por padrão), por elemento. Fora do objeto
 * porque a migração `surfaceDefaults` acrescenta estas a um catálogo já salvo (só onde o elemento nunca
 * teve o campo `surface`). Mesmo formato de `normalizeSurface` (environment/surface-rules.js).
 */
export const DEFAULT_ELEMENT_SURFACES = {
  water: { enabled: true, label: "Poça d'água", chance: 100, radius: 2, damageFormula: "", conditionId: "wet", conditionRounds: 2, height: 0, nature: "matter", rounds: 3, minutes: 10, immuneTraits: [] },
  oil: { enabled: true, label: "Poça de óleo", chance: 100, radius: 2, damageFormula: "", conditionId: "oiled", conditionRounds: 3, height: 0, nature: "matter", rounds: 3, minutes: 10, immuneTraits: [] },
  fire: { enabled: true, label: "Chamas", chance: 50, radius: 2, damageFormula: "1d6", conditionId: "burn", conditionRounds: 2, height: 2, nature: "origin", rounds: 2, minutes: 5, immuneTraits: [] },
  ice: { enabled: true, label: "Gelo no chão", chance: 50, radius: 2, damageFormula: "", conditionId: "slow", conditionRounds: 1, height: 0, nature: "origin", rounds: 3, minutes: 10, immuneTraits: [] }
};

/** Água e Óleo: os elementos novos da 1.97.0 (a marca vem da Condição que o golpe aplica). */
export const REACTION_ELEMENTS = [
  { id: "water", label: "Água", color: "#5aa9ff", group: "Fantasia", effects: [{ type: "condition", conditionId: "wet", chance: 100, rounds: 2 }], reactions: DEFAULT_ELEMENT_REACTIONS.water, surface: DEFAULT_ELEMENT_SURFACES.water },
  // Óleo: quase sem uso como dano — existe para ser marca e superfície.
  { id: "oil", label: "Óleo", color: "#b8955a", group: "Fantasia", effects: [{ type: "condition", conditionId: "oiled", chance: 100, rounds: 3 }], surface: DEFAULT_ELEMENT_SURFACES.oil }
];

/** Molhado e Oleado: as marcas de Água e Óleo (só o ícone e o "Elemento do corpo"). */
export const REACTION_CONDITIONS = [
  { id: "wet", label: "Molhado", icon: "icons/svg/waterfall.svg", elements: ["water"], explanation: "Encharcado: reage a golpes de Fogo, Gelo e Elétrico (a tabela de reações da mesa diz como). A reação gasta a marca." },
  { id: "oiled", label: "Oleado", icon: "icons/svg/hazard.svg", elements: ["oil"], explanation: "Coberto de óleo: pega fogo com facilidade (a tabela de reações da mesa diz como). A reação gasta a marca." }
];

/** Tipos de dano elemental padrão, sobrescritos pela setting `damageElementsData` (editor visual). */
export const DEFAULT_DAMAGE_ELEMENTS = [
  { id: "physical", label: "Físico", color: "#9aa1c2", group: "Físico", effects: [] },
  // Subtipos do Físico ("Subtipo de", `parent`): Resistência Física vale para os três, e a deles
  // entra depois (Geral → Físico → Cortante). Armas e Skills "Físico" continuam o golpe genérico.
  ...PHYSICAL_SUBTYPES,
  // `affinity`: vantagem contra outros elementos (−2 Imune … 2 Super efetivo) — ver a tabela no editor.
  // Fogo e Ácido cauterizam: a Regeneração não age por 2 rodadas (o troll só morre assim).
  { id: "fire", label: "Fogo", color: "#ff7043", group: "Fantasia", effects: [{ type: "condition", conditionId: "burn", chance: 25 }, { type: "blockRegen", chance: 100, rounds: 2 }], affinity: { ice: 1 }, reactions: DEFAULT_ELEMENT_REACTIONS.fire, surface: DEFAULT_ELEMENT_SURFACES.fire },
  { id: "ice", label: "Gelo", color: "#6ee7ff", group: "Fantasia", effects: [{ type: "condition", conditionId: "slow", chance: 25 }], affinity: { fire: -1 }, reactions: DEFAULT_ELEMENT_REACTIONS.ice, surface: DEFAULT_ELEMENT_SURFACES.ice },
  { id: "lightning", label: "Elétrico", color: "#ffe066", group: "Fantasia", effects: [], reactions: DEFAULT_ELEMENT_REACTIONS.lightning },
  { id: "acid", label: "Ácido", color: "#8bc34a", group: "Fantasia", effects: [{ type: "blockRegen", chance: 100, rounds: 2 }] },
  { id: "dark", label: "Sombrio", color: "#7b5ea7", group: "Fantasia", effects: [], affinity: { holy: 1 } },
  { id: "holy", label: "Sagrado", color: "#e8c170", group: "Fantasia", effects: [], affinity: { dark: 1 } },
  // Água e Óleo (8.1): o golpe deixa a marca Molhado/Oleado; as reações do Fogo/Gelo/Elétrico a leem.
  ...REACTION_ELEMENTS
];

/** Elemento do dano de radiação do Ambiente (environment/radiation.js). */
export const RADIATION_ELEMENT = { id: "radiation", label: "Radiação", color: "#c6ff00", group: "Exótico", effects: [] };

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
  { id: "transphasic", label: "Transfásico", color: "#e8c170", group: "Exótico", effects: [{ type: "penetration", percent: 40 }] },
  // Radiação do Ambiente (cena, área, Token emissor): Resistência a ela reduz o dano por rodada.
  RADIATION_ELEMENT
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
  { id: "blindness", label: "Cegueira", icon: "icons/svg/blind.svg", mapStatus: "blind", explanation: "Não enxerga: o Mestre decide o que ele não consegue fazer (mirar de longe, ler, achar alguém)." },
  // Invisibilidade (J4b): marca o Token como Invisível no mapa; só quem tem "Ver o invisível" etc. o percebe.
  { id: "invisibility", label: "Invisibilidade", icon: "icons/svg/invisible.svg", mapStatus: "invisible", explanation: "Não é visto: quem não tem um sentido especial (Ver o invisível, Visão verdadeira, Sentir tudo) não o percebe no mapa." },
  // Selo antimagia: toda magia de quem tem o selo paga Mana extra (ver antimagicSurcharge).
  { id: "antimagic-seal", label: "Selo Antimagia", icon: "icons/svg/padlock.svg", antimagicLevel: 1, explanation: "Toda magia dele custa mais; num selo forte, ela nem sai." },
  // Selo de Interferência (espelho tecnológico do Selo Antimagia): todo uso tecnológico dele paga energia extra.
  { id: "interference-seal", label: "Selo de Interferência", icon: "icons/svg/lightning.svg", interferenceLevel: 1, explanation: "Toda tecnologia dele custa mais energia; num selo forte, ela nem funciona." },
  { id: "poison", label: "Veneno", icon: "icons/svg/poison.svg",
    effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 5, durationRounds: 3, tickUnit: "combatRound" } },
  { id: "burn", label: "Queimadura", icon: "icons/svg/fire.svg", elements: ["fire"],
    effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "hitPercent", value: 10, durationRounds: 2, tickUnit: "combatRound" } },
  { id: "slow", label: "Lentidão", icon: "icons/svg/frozen.svg", elements: ["ice"],
    effect: { kind: "modifier", modTarget: "movement", modMode: "percent", value: -50, durationRounds: 2 } },
  // Marcas de Água e Óleo (item 8.1): o "Elemento do corpo" delas é o que as reações leem.
  ...REACTION_CONDITIONS,
  { id: "stun", label: "Atordoamento", icon: "icons/svg/daze.svg", explanation: "Zonzo: costuma perder a próxima ação, a critério do Mestre." },
  { id: "silence", label: "Silêncio", icon: "icons/svg/silenced.svg", explanation: "Não consegue falar: o que pede voz (palavras de poder, gritar um aviso) não sai, a critério do Mestre." },
  { id: "paralysis", label: "Paralisia", icon: "icons/svg/paralysis.svg", explanation: "Não se mexe. O Mestre decide se ainda dá para fazer algo que não pede movimento." },
  { id: "fear", label: "Medo", icon: "icons/svg/terror.svg", explanation: "Não consegue se aproximar de quem causou o medo, a critério do Mestre." },
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
  // PEM: o mesmo para a tecnologia — Skills, itens, implantes e próteses tecnológicos de nível ≤ o da supressão não valem.
  { id: "tech-suppressed", label: "Suprimido (Tecnologia)", icon: "icons/svg/cancel.svg", suppressesTech: true },
  // Marca (H4): o efeito "Marcar" aplica esta Condição com o flag `markedBy` (uuid de quem marcou). Quem
  // marcou pode lançar Skills a partir do Marcado (alcance, custo × (distância ÷ alcance)²). É mágica:
  // Antimagia desfaz, e dentro de um campo ela acaba.
  { id: "marked", label: "Marcado", icon: "icons/svg/target.svg", explanation: "Alguém pôs uma Marca nele. Quem marcou pode lançar Skills como se estivesse onde o Marcado está, pagando mais quanto mais longe estiver. A Antimagia desfaz a Marca." },
  // Exemplo de Maldição (prancha 6): vários efeitos, sem prazo, paga pela Mana da vítima.
  { id: "curse-blood", label: "Maldição de Sangue", icon: "icons/svg/blood.svg", healBlock: { kinds: "regen", scope: "body" },
    curse: { enabled: true, costPercent: 5, onUnpaid: "hp", worsenStep: 25, worsenCap: 3, effects: [
      { kind: "modifier", modTarget: "strength", modMode: "percent", value: -20 },
      { kind: "modifier", modTarget: "movement", modMode: "percent", value: -30 },
      { kind: "tick", tickSign: "damage", tickTarget: "hp", valueMode: "maxPercent", value: 2 }
    ] } },
  // Usadas pelas Funções de Parte (Ferimentos por parte): só o marcador, o Mestre arbitra.
  { id: "deafness", label: "Surdo", icon: "icons/svg/deaf.svg", explanation: "Não ouve: o Mestre decide o que isso impede (ouvir um aviso, perceber alguém chegando)." },
  { id: "maimed", label: "Sem mão", icon: "icons/svg/bones.svg", explanation: "Perdeu a mão: não segura nem usa o que pede as duas mãos." },
  { id: "unbalanced", label: "Desequilibrado", icon: "icons/svg/falling.svg", explanation: "Perdeu o equilíbrio (cauda, perna): o Mestre decide o que fica mais difícil." },
  // Vida 0 (combat/incapacitation.js): "incapacita" = não age nem se move, Skills Ativas desligam;
  // o que é do corpo (regeneração, cura) continua. Caído entra sozinho em 0; Inconsciente vem de
  // sair do 0 (por N rodadas) ou de um desmaio marcado à mão.
  // Contágio (combat/contagion.js): no início do turno de quem tem, cada Personagem a até 2 m rola 25%.
  { id: "plague", label: "Praga", icon: "icons/svg/biohazard.svg",
    effect: { kind: "tick", tickTarget: "hp", tickSign: "damage", valueMode: "maxPercent", value: 3, durationRounds: 5, tickUnit: "combatRound" },
    spread: { chance: 25, radius: 2, immuneTraits: ["mechanical"] } },
  { id: "fallen", label: "Caído", icon: "icons/svg/skull.svg", incapacitates: true, explanation: "Vida 0: o contador de morte corre até alguém estabilizar ou curar." },
  { id: "unconscious", label: "Inconsciente", icon: "icons/svg/unconscious.svg", incapacitates: true, explanation: "Desacordado por algumas rodadas depois de sair do 0 de Vida." },
  // Descanso fora de combate (J9, core/world-clock.js): dorme até o relógio do mundo passar da hora de acordar.
  { id: "sleeping", label: "Dormindo", icon: "icons/svg/sleep.svg", incapacitates: true, explanation: "Descansando: acorda com o descanso feito quando o tempo passar. Levar dano acorda sem o descanso." }
];
