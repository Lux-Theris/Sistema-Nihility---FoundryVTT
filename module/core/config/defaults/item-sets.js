/**
 * Conjuntos de fábrica (J12, 1.122.0): quatro exemplos para o Mestre editar ou copiar, e as peças deles
 * (Itens que `ensureFactorySetItems` semeia nos Compêndios do sistema). Só dados — não importa nada
 * (constants.js carrega este arquivo na avaliação do módulo; um ciclo seria um erro de TDZ).
 *
 * Cada conjunto é `{id, label, for, pieces: [{key, name, kind}], tiers: [{count, bonuses}]}`. O que a faixa
 * guarda (`bonuses`) é o mesmo do "Enquanto equipado" do Item: `attributeBonuses`, `statModifiers`,
 * `resistances`, `luck`, `conditionalModifiers`, `grantsSkill` (Habilidade concedida) e, no conjunto de Nave,
 * `ship` (`[{target, amount}]`).
 */

export const DEFAULT_ITEM_SETS = [
  {
    id: "armadura_do_dragao",
    label: "Armadura do Dragão",
    for: "character",
    pieces: [
      { key: "elmo_de_escama", name: "Elmo de Escama", kind: "armadura" },
      { key: "peitoral_de_escama", name: "Peitoral de Escama", kind: "armadura" },
      { key: "manoplas_de_garra", name: "Manoplas de Garra", kind: "arma" },
      { key: "coracao_de_brasa", name: "Coração de Brasa", kind: "implante" }
    ],
    tiers: [
      { count: 2, bonuses: { resistances: [{ target: "fire", amount: 20 }] } },
      { count: 3, bonuses: { attributeBonuses: [{ attribute: "defense", amount: 1 }], statModifiers: { hp: 25, energy: 0 } } },
      {
        count: 4,
        bonuses: {
          grantsSkill: {
            name: "Sopro Dracônico",
            tier: "normal",
            level: 1,
            cost: 15,
            effectType: "damage",
            targetType: "targeted",
            damageFormula: "3d8",
            damageElements: ["fire"],
            isMagicDamage: true,
            scalingAttribute: "magic",
            description: "<p>O fôlego do dragão: uma lufada de fogo no alvo.</p>"
          },
          conditionalModifiers: [{ when: { kind: "selfHpBelow", value: "", threshold: 50 }, then: { kind: "attributeFlat", target: "strength", value: 2 }, perEach: "" }]
        }
      }
    ]
  },
  {
    id: "vestes_do_arquimago",
    label: "Vestes do Arquimago",
    for: "character",
    pieces: [
      { key: "chapeu_do_arquimago", name: "Chapéu do Arquimago", kind: "armadura" },
      { key: "manto_do_arquimago", name: "Manto do Arquimago", kind: "armadura" },
      { key: "cajado_do_arquimago", name: "Cajado do Arquimago", kind: "arma" },
      { key: "anel_do_arquimago", name: "Anel do Arquimago", kind: "acessório" }
    ],
    tiers: [
      { count: 2, bonuses: { statModifiers: { hp: 0, energy: 30 } } },
      { count: 3, bonuses: { attributeBonuses: [{ attribute: "magic", amount: 1 }] } },
      { count: 4, bonuses: { conditionalModifiers: [{ when: { kind: "always", value: "", threshold: 50 }, then: { kind: "rollFlat", target: "magic", value: 2 }, perEach: "" }] } }
    ]
  },
  {
    id: "traje_tatico_kestrel",
    label: "Traje Tático Kestrel",
    for: "character",
    pieces: [
      { key: "capacete_kestrel", name: "Capacete Kestrel", kind: "armadura" },
      { key: "colete_kestrel", name: "Colete Kestrel", kind: "armadura" },
      { key: "rifle_kestrel", name: "Rifle Kestrel", kind: "arma" },
      { key: "otica_kestrel", name: "Ótica Kestrel", kind: "implante" }
    ],
    tiers: [
      { count: 2, bonuses: { resistances: [{ target: "kinetic", amount: 15 }] } },
      { count: 3, bonuses: { attributeBonuses: [{ attribute: "precision", amount: 1 }] } },
      {
        count: 4,
        bonuses: {
          grantsSkill: {
            name: "Mira Travada",
            tier: "normal",
            level: 1,
            cost: 5,
            effectType: "temporary",
            targetType: "self",
            effects: [{ target: "precision", amount: 2, durationRounds: 3, amountMode: "flat", modifierType: "flat" }],
            description: "<p>A ótica trava no alvo: +2 de Precisão por 3 rodadas.</p>"
          }
        }
      }
    ]
  },
  {
    id: "kit_de_caca",
    label: "Kit de Caça (Nave)",
    for: "vessel",
    pieces: [
      { key: "propulsor_de_caca", name: "Propulsor de Caça", kind: "módulo" },
      { key: "sensor_de_caca", name: "Sensor de Caça", kind: "módulo" },
      { key: "canhao_de_caca", name: "Canhão de Caça", kind: "módulo" }
    ],
    tiers: [
      { count: 2, bonuses: { ship: [{ target: "evasion", amount: 5 }] } },
      { count: 3, bonuses: { ship: [{ target: "signature", amount: -10 }] } }
    ]
  }
];

/**
 * As peças de fábrica como Itens: `type` e `system` do Item, o conjunto (`set`) e a chave da peça (`key`).
 * O Compêndio de Itens leva as de Personagem; o de Módulos de Nave, as de Nave.
 */
export const DEFAULT_ITEM_SET_PIECES = [
  { set: "armadura_do_dragao", key: "elmo_de_escama", type: "item", name: "Elmo de Escama", system: { weight: 2, value: { amount: 80, currency: "gold" }, description: "<p>Escamas de dragão sobre couro curtido.</p>" } },
  { set: "armadura_do_dragao", key: "peitoral_de_escama", type: "item", name: "Peitoral de Escama", system: { weight: 8, value: { amount: 220, currency: "gold" }, description: "<p>O peitoral do conjunto da Armadura do Dragão.</p>" } },
  { set: "armadura_do_dragao", key: "manoplas_de_garra", type: "item", name: "Manoplas de Garra", system: { weight: 3, value: { amount: 120, currency: "gold" }, description: "<p>Manoplas com garras de dragão.</p>", weapon: { enabled: true, damageFormula: "2d6", scalingAttribute: "strength", damageElements: ["slashing"] } } },
  { set: "armadura_do_dragao", key: "coracao_de_brasa", type: "item", name: "Coração de Brasa", system: { weight: 1, magic: true, value: { amount: 300, currency: "gold" }, description: "<p>Uma brasa viva que bate como um coração. Implante.</p>", implant: { enabled: true, kind: "implant", fitsSlots: [], location: "Peito", functions: [], hpMode: "percent", hp: 20 } } },

  { set: "vestes_do_arquimago", key: "chapeu_do_arquimago", type: "item", name: "Chapéu do Arquimago", system: { weight: 0.5, magic: true, value: { amount: 90, currency: "gold" }, description: "<p>Pontudo, como manda a tradição.</p>" } },
  { set: "vestes_do_arquimago", key: "manto_do_arquimago", type: "item", name: "Manto do Arquimago", system: { weight: 2, magic: true, value: { amount: 200, currency: "gold" }, description: "<p>Bordado com runas que zumbem de leve.</p>" } },
  { set: "vestes_do_arquimago", key: "cajado_do_arquimago", type: "item", name: "Cajado do Arquimago", system: { weight: 2, magic: true, value: { amount: 160, currency: "gold" }, description: "<p>Um cajado de madeira antiga.</p>", weapon: { enabled: true, damageFormula: "1d8", scalingAttribute: "magic", isMagicDamage: true, damageElements: [] } } },
  { set: "vestes_do_arquimago", key: "anel_do_arquimago", type: "item", name: "Anel do Arquimago", system: { weight: 0.1, magic: true, value: { amount: 140, currency: "gold" }, description: "<p>Um aro de prata com uma pedra azul.</p>" } },

  { set: "traje_tatico_kestrel", key: "capacete_kestrel", type: "item", name: "Capacete Kestrel", system: { weight: 1.5, value: { amount: 150, currency: "gold" }, description: "<p>Capacete tático com visor.</p>" } },
  { set: "traje_tatico_kestrel", key: "colete_kestrel", type: "item", name: "Colete Kestrel", system: { weight: 5, value: { amount: 400, currency: "gold" }, description: "<p>Colete balístico leve.</p>" } },
  { set: "traje_tatico_kestrel", key: "rifle_kestrel", type: "item", name: "Rifle Kestrel", system: { weight: 4, tech: true, value: { amount: 600, currency: "gold" }, description: "<p>Rifle de pulso do traje Kestrel.</p>", weapon: { enabled: true, damageFormula: "2d8", scalingAttribute: "precision", damageElements: ["kinetic"] } } },
  { set: "traje_tatico_kestrel", key: "otica_kestrel", type: "item", name: "Ótica Kestrel", system: { weight: 0.1, tech: true, value: { amount: 500, currency: "gold" }, description: "<p>Implante ocular com mira assistida.</p>", implant: { enabled: true, kind: "implant", fitsSlots: [], location: "Olho", functions: [], hpMode: "percent", hp: 10 } } },

  { set: "kit_de_caca", key: "propulsor_de_caca", type: "starship_module", name: "Propulsor de Caça", system: { category: "engine", moduleSize: "compact", powerConsumption: 10, description: "<p>Propulsor ágil do Kit de Caça.</p>" } },
  { set: "kit_de_caca", key: "sensor_de_caca", type: "starship_module", name: "Sensor de Caça", system: { category: "utility", moduleSize: "compact", powerConsumption: 4, description: "<p>Sensor leve do Kit de Caça.</p>" } },
  { set: "kit_de_caca", key: "canhao_de_caca", type: "starship_module", name: "Canhão de Caça", system: { category: "weapon", moduleSize: "compact", powerConsumption: 8, description: "<p>Canhão rápido do Kit de Caça.</p>" } }
];
