/**
 * Espécies, Heranças, Funções do corpo, Traços e carga por Espécie de fábrica.
 * Dados puros, referenciados por MEU_SISTEMA (core/config/constants.js); importe de
 * `core/config.js`. Separado em 1.68.0 sem mudar nenhum valor.
 */

export const DEFAULT_SPECIES_PRESETS = {
  humano: {
    label: "Humano",
    group: "fantasia",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 20, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 8, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 8, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 10, tags: ["limb"] }
    ],
    skills: [
      { name: "Adaptabilidade", description: "Aprende habilidades comuns com mais facilidade que as demais espécies.", level: 1, cost: 0 }
    ]
  },
  elfo: {
    label: "Elfo",
    group: "fantasia",
    traits: ["organic"],
    availableAtCreation: true,
    lineages: [
      { id: "alto", label: "Alto Elfo", description: "Cidades de pedra branca e magia antiga.", skills: [{ key: "afinidade_arcana", name: "Afinidade Arcana", description: "Sente a presença de magia por perto e reconhece runas antigas.", level: 1, cost: 0 }] },
      { id: "floresta", label: "Elfo da Floresta", description: "Rápido e silencioso entre as árvores.", movement: { percent: 10 } },
      { id: "sombrio", label: "Elfo Sombrio", description: "Criado no subterrâneo, longe do sol.", passives: { resistances: [{ target: "dark", amount: 20 }] }, skills: [{ key: "visao_nas_sombras", name: "Visão nas Sombras", description: "Enxerga no escuro total como se fosse penumbra.", level: 1, cost: 0 }] }
    ],
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 8, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 16, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 6, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 6, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "ears", label: "Orelhas Élficas", slot: "cosmetic", hpMax: 4, tags: ["sensory"] }
    ],
    skills: [
      { name: "Visão Élfica", description: "Enxerga com clareza mesmo em pouca luz; bônus em Precisão à distância.", level: 1, cost: 0 }
    ]
  },
  anao: {
    label: "Anão",
    group: "fantasia",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 12, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 24, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 10, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 10, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 8, tags: ["limb"] }
    ],
    skills: [
      { name: "Constituição Pétrea", description: "Corpo denso e baixo centro de gravidade: resiste a ser derrubado e a venenos comuns.", level: 1, cost: 0 },
      { name: "Olho de Forja", description: "Reconhece metal, liga e qualidade de forja no toque — e enxerga no escuro das minas.", level: 1, cost: 0 }
    ]
  },
  orc: {
    label: "Orc",
    group: "fantasia",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 12, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 26, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 12, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 12, tags: ["limb"] }
    ],
    skills: [
      { name: "Fúria Crescente", description: "Quanto mais ferido, mais forte bate — a dor vira ímpeto em vez de hesitação.", level: 1, cost: 0, conditionalModifiers: [{ when: { kind: "selfHpBelow", value: "", threshold: 50 }, then: { kind: "attributeFlat", target: "strength", value: 3 }, perEach: "" }] },
      { name: "Couro Grosso", description: "A pele espessa absorve parte dos cortes e contusões.", level: 1, cost: 0, resistanceTarget: "physical" }
    ]
  },
  goblin: {
    label: "Goblin",
    group: "fantasia",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 6, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 12, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 5, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 5, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 7, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 7, tags: ["limb"] }
    ],
    skills: [
      { name: "Esgueirar-se", description: "Pequeno e silencioso: passa por brechas e some de vista em terreno bagunçado.", level: 1, cost: 0 },
      { name: "Instinto de Sucata", description: "Improvisa ferramenta ou arma com o que houver por perto.", level: 1, cost: 0 }
    ]
  },
  halfling: {
    label: "Pequenino",
    group: "fantasia",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 7, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 13, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 5, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 5, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 7, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 7, tags: ["limb"] }
    ],
    skills: [
      { name: "Sorte Teimosa", description: "Uma vez por cena, o desastre erra por pouco.", level: 1, cost: 0 },
      { name: "Pés Silenciosos", description: "Anda sem fazer ruído, mesmo sobre folhas secas ou assoalho velho.", level: 1, cost: 0 }
    ]
  },
  slime: {
    label: "Slime",
    group: "isekai",
    traits: ["organic"],
    availableAtCreation: true,
    // Cadeia de evolução estilo Tensura (aba Evolução do editor; botão "Evoluir…" do Mestre).
    evolvesTo: [{ species: "slime_demoniaco", minLevel: 10, hint: "Ao receber um Nome de um Lorde Demônio.", keepLineage: true, resistancesToImmunity: true }],
    parts: [
      { key: "core", label: "Núcleo", slot: "core", hpMax: 30, tags: ["vital", "regenerative"] },
      { key: "mass", label: "Massa Gelatinosa", slot: "body", hpMax: 40, hpPercent: 100, tags: ["amorphous", "regenerative"] }
    ],
    skills: [
      { name: "Regeneração Amorfa", description: "Recupera uma fração do HP máximo por turno enquanto o Núcleo estiver intacto.", level: 1, cost: 0, effectType: "temporary", targetType: "self", hasUpkeep: true, upkeepCost: 2, effects: [{ target: "hp", amount: 5, durationRounds: 0, periodic: true, tickUnit: "combatRound", healKind: "regeneracao", conditionId: "", damageElements: [] }] }
    ]
  },
  dragoide: {
    label: "Dragoide",
    group: "isekai",
    traits: ["organic", "draconic", "wingless"],
    availableAtCreation: true,
    lineageRequired: true,
    lineages: [
      { id: "fogo", label: "Linhagem do Fogo", description: "Escamas rubras; o sopro queima.", elements: ["fire"], passives: { resistances: [{ target: "fire", amount: 20 }] } },
      {
        id: "gelo", label: "Linhagem do Gelo", description: "Escamas azuladas; o sopro congela.", elements: ["ice"], passives: { resistances: [{ target: "ice", amount: 20 }] },
        skills: [{ key: "sopro_gelido", name: "Sopro Gélido", description: "Exala gelo num cone à frente.", level: 1, cost: 20, effectType: "damage", damageFormula: "3d6", damageElements: ["ice"], targetType: "emission", areaShape: "cone", areaDistance: 6, areaAngle: 53 }],
        replaces: { skills: ["sopro_draconico"] }
      },
      {
        id: "raio", label: "Linhagem do Raio", description: "Escamas que estalam; o sopro é um relâmpago.", elements: ["lightning"], passives: { resistances: [{ target: "lightning", amount: 20 }] },
        skills: [{ key: "sopro_eletrico", name: "Sopro Elétrico", description: "Exala um relâmpago em linha reta.", level: 1, cost: 20, effectType: "damage", damageFormula: "3d6", damageElements: ["lightning"], targetType: "emission", areaShape: "ray", areaDistance: 8 }],
        replaces: { skills: ["sopro_draconico"] }
      }
    ],
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 14, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 28, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 12, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 12, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 14, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 14, tags: ["limb"] },
      { key: "tail", label: "Cauda", slot: "tail", hpMax: 12, tags: ["limb"] },
      { key: "wings", label: "Asas Membranosas", slot: "wing", hpMax: 10, tags: ["limb", "flight"] }
    ],
    skills: [
      { name: "Escamas Ancestrais", description: "As escamas reduzem dano físico e resistem ao calor.", level: 1, cost: 0, resistanceTarget: "physical" },
      { name: "Sopro Dracônico", description: "Exala o elemento da própria linhagem num cone à frente.", level: 1, cost: 20, effectType: "damage", damageFormula: "3d6", damageElements: ["fire"], targetType: "emission", areaShape: "cone", areaDistance: 6, areaAngle: 53 },
      { name: "Presença de Dragão", description: "A mera presença impõe medo a criaturas menores.", level: 1, cost: 10, unlockLevel: 10, effectType: "temporary", targetType: "emission", areaShape: "circle", areaDistance: 4, effects: [{ target: "strength", amount: 0, durationRounds: 2, conditionId: "fear", periodic: false, damageElements: [] }] }
    ]
  },
  ogro: {
    label: "Ogro",
    group: "isekai",
    traits: ["organic"],
    availableAtCreation: true,
    evolvesTo: [{ species: "kijin", minLevel: 10, hint: "Ao receber um Nome.", keepLineage: true, resistancesToImmunity: false }],
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 16, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 34, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 18, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 18, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 16, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 16, tags: ["limb"] }
    ],
    skills: [
      { name: "Força Bruta", description: "Ergue e arremessa o que criatura nenhuma do seu tamanho deveria.", level: 1, cost: 0 },
      { name: "Estômago de Ferro", description: "Come e bebe o que for sem adoecer — veneno ingerido quase não o afeta.", level: 1, cost: 0 }
    ]
  },
  lobo_tempestade: {
    label: "Lobo Tempestade",
    group: "isekai",
    traits: ["organic", "beast"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 12, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 24, tags: ["vital"] },
      { key: "front_left", label: "Pata Dianteira Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "front_right", label: "Pata Dianteira Direita", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "tail", label: "Cauda", slot: "tail", hpMax: 6, tags: ["limb"] }
    ],
    skills: [
      { name: "Passo de Trovão", description: "Move-se em rajadas curtas, rápido demais para o olho acompanhar.", level: 1, cost: 0 },
      { name: "Pelo Estático", description: "A pelagem carregada fere quem o agarra.", level: 1, cost: 0 }
    ]
  },
  harpia: {
    label: "Harpia",
    group: "isekai",
    traits: ["organic", "flying"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 8, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 16, tags: ["vital"] },
      { key: "left_wing", label: "Asa Esquerda", slot: "wing", hpMax: 10, tags: ["limb", "flight"] },
      { key: "right_wing", label: "Asa Direita", slot: "wing", hpMax: 10, tags: ["limb", "flight"] },
      { key: "left_talon", label: "Garra Esquerda", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "right_talon", label: "Garra Direita", slot: "leg", hpMax: 8, tags: ["limb"] }
    ],
    skills: [
      { name: "Voo Batido", description: "Voa de verdade — não plana: sobe, para no ar e mergulha.", level: 1, cost: 0 },
      { name: "Grito Cortante", description: "Um grito que desorienta quem estiver perto.", level: 1, cost: 15, effectType: "temporary", targetType: "emission", areaShape: "circle", areaDistance: 3, effects: [{ target: "dexterity", amount: -2, durationRounds: 1, conditionId: "stun", periodic: false, damageElements: [] }] }
    ]
  },
  ciborgue: {
    label: "Ciborgue",
    group: "scifi",
    traits: ["organic", "mechanical"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 22, tags: ["vital", "mechanical"] },
      { key: "left_arm", label: "Braço Esquerdo (Protético)", slot: "arm", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] },
      { key: "right_arm", label: "Braço Direito (Protético)", slot: "arm", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] },
      { key: "left_leg", label: "Perna Esquerda (Protética)", slot: "leg", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] },
      { key: "right_leg", label: "Perna Direita (Protética)", slot: "leg", hpMax: 14, tags: ["limb", "mechanical", "prosthetic"] }
    ],
    skills: [
      { name: "Blindagem Sintética", description: "Membros protéticos absorvem parte do dano físico recebido.", level: 1, cost: 0, resistanceTarget: "physical" }
    ]
  },
  androide: {
    label: "Androide",
    group: "scifi",
    traits: ["mechanical"],
    availableAtCreation: true,
    lineages: [
      { id: "combate", label: "Modelo de Combate", description: "Chassi reforçado para o front.", passives: { resistances: [{ target: "physical", amount: 10 }] } },
      { id: "servico", label: "Modelo de Serviço", description: "Feito para conviver com pessoas.", skills: [{ key: "protocolos_de_servico", name: "Protocolos de Serviço", description: "Etiqueta, primeiros socorros e tradução básica embutidos.", level: 1, cost: 0 }] }
    ],
    parts: [
      { key: "core", label: "Núcleo de Processamento", slot: "core", hpMax: 18, tags: ["vital", "mechanical"] },
      { key: "chassis", label: "Chassi", slot: "torso", hpMax: 28, tags: ["vital", "mechanical"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 16, tags: ["limb", "mechanical"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 16, tags: ["limb", "mechanical"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 16, tags: ["limb", "mechanical"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 16, tags: ["limb", "mechanical"] },
      { key: "optics", label: "Conjunto Óptico", slot: "head", hpMax: 8, tags: ["sensory", "mechanical"] }
    ],
    skills: [
      { name: "Sem Fôlego a Perder", description: "Não respira, não cansa e não dorme: imune a veneno inalado e a sufocamento.", level: 1, cost: 0 },
      { name: "Interface Direta", description: "Conecta-se a sistemas e portas de dados sem precisar de terminal.", level: 1, cost: 0 }
    ]
  },
  mutante: {
    label: "Mutante",
    group: "scifi",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 22, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 10, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 10, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 11, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 11, tags: ["limb"] }
    ],
    skills: [
      { name: "Carne Instável", description: "O corpo se reconfigura sob estresse — fecha ferimentos rápido demais para ser natural.", level: 1, cost: 0, effectType: "temporary", targetType: "self", hasUpkeep: true, upkeepCost: 3, effects: [{ target: "hp", amount: 3, durationRounds: 0, periodic: true, tickUnit: "combatRound", healKind: "regeneracao", conditionId: "", damageElements: [] }] },
      { name: "Anomalia Latente", description: "Cada Mutante carrega uma mutação única, definida com o Mestre na criação.", level: 1, cost: 0 }
    ]
  },
  simbionte: {
    label: "Simbionte",
    group: "scifi",
    traits: ["organic"],
    availableAtCreation: true,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 20, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 9, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 9, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "symbiote", label: "Simbionte", slot: "body", hpMax: 20, tags: ["vital", "regenerative", "parasitic"] }
    ],
    skills: [
      { name: "Hospedeiro Compartilhado", description: "O simbionte cura o hospedeiro — e sente o que ele sente.", level: 1, cost: 0 },
      { name: "Massa Adaptativa", description: "O simbionte endurece sobre o corpo, virando lâmina ou escudo conforme a necessidade.", level: 1, cost: 10, effectType: "temporary", targetType: "self", effects: [{ target: "shield", amount: 10, durationRounds: 0, conditionId: "", periodic: false, damageElements: [] }] }
    ]
  },
  slime_demoniaco: {
    label: "Slime Demoníaco",
    group: "isekai",
    description: "Um Slime que recebeu um Nome: a massa ganhou vontade e fome de Mana.",
    traits: ["organic"],
    elements: ["dark"],
    availableAtCreation: false,
    passives: { statModifiers: { hp: 0, energy: 100 } },
    parts: [
      { key: "core", label: "Núcleo", slot: "core", hpMax: 60, tags: ["vital", "regenerative"] },
      { key: "mass", label: "Massa Gelatinosa", slot: "body", hpMax: 80, hpPercent: 100, tags: ["amorphous", "regenerative"] }
    ],
    skills: [
      { key: "regeneracao_amorfa", name: "Regeneração Demoníaca", description: "Recupera Vida a cada rodada, mais rápido que um Slime comum.", level: 1, cost: 0, effectType: "temporary", targetType: "self", hasUpkeep: true, upkeepCost: 3, effects: [{ target: "hp", amount: 12, durationRounds: 0, periodic: true, tickUnit: "combatRound", conditionId: "", damageElements: [] }] },
      { name: "Aura Demoníaca", description: "A presença pesa no ar: criaturas fracas hesitam.", level: 1, cost: 15, effectType: "temporary", targetType: "emission", areaShape: "circle", areaDistance: 3, effects: [{ target: "strength", amount: 0, durationRounds: 2, conditionId: "fear", periodic: false, damageElements: [] }] }
    ]
  },
  kijin: {
    label: "Kijin",
    group: "isekai",
    description: "Um Ogro que recebeu um Nome: menor, mais rápido, com chifres e mana desperta.",
    traits: ["organic"],
    availableAtCreation: false,
    passives: { resistances: [{ target: "physical", amount: 10 }] },
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 16, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 34, tags: ["vital"] },
      { key: "left_arm", label: "Braço Esquerdo", slot: "arm", hpMax: 18, tags: ["limb"] },
      { key: "right_arm", label: "Braço Direito", slot: "arm", hpMax: 18, tags: ["limb"] },
      { key: "left_leg", label: "Perna Esquerda", slot: "leg", hpMax: 16, tags: ["limb"] },
      { key: "right_leg", label: "Perna Direita", slot: "leg", hpMax: 16, tags: ["limb"] },
      { key: "horns", label: "Chifres", slot: "horn", hpMax: 8, tags: [] }
    ],
    skills: [
      { name: "Força Bruta", description: "Ergue e arremessa o que criatura nenhuma do seu tamanho deveria.", level: 1, cost: 0 },
      { name: "Estômago de Ferro", description: "Come e bebe o que for sem adoecer — veneno ingerido quase não o afeta.", level: 1, cost: 0 },
      { name: "Mana Desperta", description: "O corpo agora conduz Mana: Skills mágicas ficam ao alcance.", level: 1, cost: 0 }
    ]
  },
  cavalo: {
    label: "Cavalo",
    group: "besta",
    traits: ["organic", "beast"],
    availableAtCreation: false,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 30, tags: ["vital"] },
      { key: "front_left", label: "Pata Dianteira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "front_right", label: "Pata Dianteira Direita", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 14, tags: ["limb"] },
      { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 14, tags: ["limb"] }
    ],
    skills: [
      { name: "Galope Sustentado", description: "Mantém velocidade alta por horas sem se esgotar.", level: 1, cost: 0 },
      { name: "Coice", description: "Um coice das patas traseiras derruba quem se aproxima por trás.", level: 1, cost: 0, effectType: "damage", damageFormula: "1d10", damageElements: ["physical"], scalingAttribute: "strength" }
    ]
  },
  lobo_gigante: {
    label: "Lobo Gigante",
    group: "besta",
    traits: ["organic", "beast"],
    availableAtCreation: false,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 14, tags: ["vital"] },
      { key: "torso", label: "Tronco", slot: "torso", hpMax: 28, tags: ["vital"] },
      { key: "front_left", label: "Pata Dianteira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "front_right", label: "Pata Dianteira Direita", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 14, tags: ["limb"] },
      { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 14, tags: ["limb"] },
      { key: "tail", label: "Cauda", slot: "tail", hpMax: 6, tags: ["limb"] }
    ],
    skills: [
      { name: "Faro de Caçador", description: "Segue um rastro por dias, mesmo depois da chuva.", level: 1, cost: 0 },
      { name: "Mordida Travante", description: "A mordida prende a presa no lugar.", level: 1, cost: 0, effectType: "damage", damageFormula: "1d8", damageElements: ["physical"], scalingAttribute: "strength" }
    ]
  },
  grifo: {
    label: "Grifo",
    group: "besta",
    traits: ["organic", "beast", "flying"],
    availableAtCreation: false,
    parts: [
      { key: "head", label: "Cabeça de Águia", slot: "head", hpMax: 12, tags: ["vital", "sensory"] },
      { key: "torso", label: "Tronco Leonino", slot: "torso", hpMax: 26, tags: ["vital"] },
      { key: "left_wing", label: "Asa Esquerda", slot: "wing", hpMax: 12, tags: ["limb", "flight"] },
      { key: "right_wing", label: "Asa Direita", slot: "wing", hpMax: 12, tags: ["limb", "flight"] },
      { key: "front_left", label: "Garra Dianteira Esquerda", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "front_right", label: "Garra Dianteira Direita", slot: "leg", hpMax: 10, tags: ["limb"] },
      { key: "hind_left", label: "Pata Traseira Esquerda", slot: "leg", hpMax: 12, tags: ["limb"] },
      { key: "hind_right", label: "Pata Traseira Direita", slot: "leg", hpMax: 12, tags: ["limb"] }
    ],
    skills: [
      { name: "Montaria Alada", description: "Carrega um cavaleiro em voo, não só em terra.", level: 1, cost: 0 },
      { name: "Olhar de Águia", description: "Distingue detalhes a distâncias que olho nenhum alcança.", level: 1, cost: 0 }
    ]
  },
  inseto_de_carga: {
    label: "Inseto de Carga",
    group: "besta",
    traits: ["organic", "beast"],
    availableAtCreation: false,
    parts: [
      { key: "head", label: "Cabeça", slot: "head", hpMax: 10, tags: ["vital"] },
      { key: "thorax", label: "Tórax", slot: "torso", hpMax: 26, tags: ["vital", "chitinous"] },
      { key: "abdomen", label: "Abdômen", slot: "body", hpMax: 30, tags: ["chitinous"] },
      { key: "leg_1", label: "Perna 1", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "leg_2", label: "Perna 2", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "leg_3", label: "Perna 3", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "leg_4", label: "Perna 4", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "leg_5", label: "Perna 5", slot: "leg", hpMax: 8, tags: ["limb"] },
      { key: "leg_6", label: "Perna 6", slot: "leg", hpMax: 8, tags: ["limb"] }
    ],
    skills: [
      { name: "Carapaça de Quitina", description: "A casca dura reduz cortes e perfurações.", level: 1, cost: 0, resistanceTarget: "physical" },
      { name: "Besta de Carga", description: "Carrega várias vezes o próprio peso sem perder o passo.", level: 1, cost: 0 }
    ]
  }
};

/**
 * Presets de Partes do Corpo E Skills Raciais por Espécie, sobrescritos pela setting
 * `speciesPresetsData` (editor visual) para permitir espécies próprias sem tocar em código.
 *
 * Cada espécie: `{ label, group, availableAtCreation, parts[], skills[] }`
 *  - `parts`: `{ key, label, slot, hpMax, tags[] }` — vira um Item `body_part` na ficha.
 *  - `skills`: `{ name, description, level, cost }` — vira uma Skill de tier Racial.
 *  - `group`: só organiza a lista no editor (ver SPECIES_GROUP_LABELS), sem efeito mecânico.
 *  - `availableAtCreation`: `false` tira a espécie do seletor da ficha do JOGADOR. O Mestre
 *    continua vendo todas (precisa poder aplicar qualquer uma), e a geração via IA também —
 *    é o que permite ter Grifo e Cavalo como preset de Montaria sem oferecê-los como escolha
 *    de personagem. Ausente conta como `true`, então espécie criada à mão continua aparecendo.
 */
/**
 * Grupos de Espécie — só rótulo, pra organizar a lista no editor e deixar óbvio de qual tipo de
 * campanha cada uma veio. Não têm efeito mecânico nenhum.
 */
/**
 * Heranças padrão (ver getActiveHeritages). Valem para qualquer Espécie, salvo `allowedSpecies`;
 * `excludes` vale nos dois sentidos. Passivos no mesmo formato da Espécie.
 */
export const DEFAULT_HERITAGES = [
  {
    id: "vampirizado", label: "Vampirizado", group: "fantasia", acquired: "acquired",
    description: "Mordido e transformado: imortal, faminto, avesso à luz do sol.",
    traits: ["undead"], removesTraits: ["organic"], elements: ["dark"],
    passives: { resistances: [{ target: "dark", amount: 30 }], attributeBonuses: [{ attribute: "strength", amount: 1 }] },
    skills: [{ key: "dreno_vital", name: "Dreno Vital", level: 1, cost: 10, effectType: "damage", damageFormula: "1d8", damageElements: ["dark"], isMagicDamage: true, description: "Morde e drena a vida do alvo." }],
    excludes: ["abencoado"], allowedSpecies: { mode: "any", list: [] }
  },
  {
    id: "meio_dragao", label: "Meio-Dragão", group: "fantasia", acquired: "birth",
    description: "Sangue de dragão na linhagem: escamas pelo corpo e pele que não queima fácil.",
    traits: ["draconic"], elements: [],
    passives: { resistances: [{ target: "fire", amount: 20 }], attributeBonuses: [{ attribute: "defense", amount: 1 }] },
    skills: [], allowedSpecies: { mode: "except", list: ["dragoide"] }
  },
  {
    id: "possuido", label: "Possuído", group: "fantasia", acquired: "acquired",
    description: "Algo mora com você. Às vezes ajuda, às vezes cobra.",
    traits: [], elements: ["dark"],
    passives: { attributeBonuses: [{ attribute: "magic", amount: 2 }], statModifiers: { hp: -10 } },
    skills: [{ key: "voz_interior", name: "Voz Interior", level: 1, cost: 0, effectType: "none", description: "A entidade sussurra o que viu. O Mestre decide o preço." }],
    allowedSpecies: { mode: "any", list: [] }
  },
  {
    id: "abencoado", label: "Abençoado", group: "fantasia", acquired: "both",
    description: "Marcado por uma divindade.",
    traits: [], elements: ["holy"],
    passives: { resistances: [{ target: "dark", amount: 20 }] },
    skills: [], excludes: ["vampirizado"], allowedSpecies: { mode: "any", list: [] }
  },
  {
    id: "convertido_ciborgue", label: "Convertido em Ciborgue", group: "scifi", acquired: "acquired",
    description: "Partes do corpo trocadas por máquina.",
    traits: ["mechanical"], elements: [],
    passives: { statModifiers: { hp: 20 } },
    parts: [
      { key: "cyber_left_arm", label: "Braço Cibernético Esquerdo", slot: "arm", hpMax: 20, tags: ["manipulacao"] },
      { key: "cyber_right_arm", label: "Braço Cibernético Direito", slot: "arm", hpMax: 20, tags: ["manipulacao"] }
    ],
    replaces: { slots: ["arm"] },
    skills: [{ key: "interface_neural", name: "Interface Neural", level: 1, cost: 0, effectType: "none", description: "Conecta-se a máquinas e redes pelo implante." }],
    excludes: ["mutacao_radioativa"], allowedSpecies: { mode: "except", list: ["androide"] }
  },
  {
    id: "mutacao_radioativa", label: "Mutação Radioativa", group: "scifi", acquired: "acquired",
    description: "A radiação reescreveu o corpo: mais resistente, nem sempre mais bonito.",
    traits: [], elements: ["acid"],
    passives: { statModifiers: { hp: 30 }, resistances: [{ target: "acid", amount: 25 }] },
    skills: [], excludes: ["convertido_ciborgue"], allowedSpecies: { mode: "any", list: [] }
  }
];

/**
 * Funções de Parte (bloco "Ferimentos por parte"): o que um órgão FAZ, guardado na parte. A
 * granularidade continua sendo a Parte da Espécie; a Função diz o que acontece quando a parte
 * é perdida. `count`: "proportional" (o que sobra ÷ o total: locomoção), "perPart" (vale ao
 * perder qualquer uma; mostra quantas) ou "once" (só quando TODAS se perdem).
 * `effect.kind`: "none" | "notify" (aviso ao Mestre) | "condition" (conditionId) |
 * "movement" (proporcional; `crawlMeters` se ainda houver `crawlFunction` funcionando) |
 * "removeTrait" (traitId). Parte não regenera sozinha: quem regenera é Skill/Condição com cura
 * periódica do tipo Regeneração (ver partHealing) — o antigo "regen" foi tirado de propósito.
 * `woundedByHp`: a parte ferida conta pela Vida (perna a 50% = meia perna).
 */
export const DEFAULT_BODY_FUNCTIONS = [
  { id: "vital", label: "vital", count: "perPart", effect: { kind: "notify" } },
  { id: "visao", label: "visão", count: "once", effect: { kind: "condition", conditionId: "blindness" } },
  { id: "audicao", label: "audição", count: "once", effect: { kind: "condition", conditionId: "deafness" } },
  { id: "manipulacao", label: "manipulação", count: "perPart", effect: { kind: "condition", conditionId: "maimed" } },
  { id: "locomocao", label: "locomoção", count: "proportional", woundedByHp: true, effect: { kind: "movement", crawlMeters: 1, crawlFunction: "manipulacao" } },
  { id: "voo", label: "voo", count: "perPart", effect: { kind: "removeTrait", traitId: "flying" } },
  { id: "equilibrio", label: "equilíbrio", count: "once", effect: { kind: "condition", conditionId: "unbalanced" } }
];

/**
 * Traços (Dracônico, Voador, Orgânico…): etiquetas que uma Espécie dá a quem a tem, e que a
 * ficha pode acrescentar ou retirar. Usados por Elementos ("+X% contra Orgânico") e, depois,
 * pelos Modificadores Condicionais ("Caçador de Dragões"). Sobrescritos pela setting `traitsData`.
 */
export const DEFAULT_TRAITS = [
  { id: "organic", label: "Orgânico" },
  { id: "mechanical", label: "Mecânico" },
  { id: "draconic", label: "Dracônico" },
  { id: "flying", label: "Voador" },
  { id: "wingless", label: "Sem Asas" },
  { id: "undead", label: "Morto-vivo" },
  { id: "beast", label: "Besta" }
];

/**
 * Slots e carga base por Espécie padrão — o que ela carregaria no corpo, sem mochila (os
 * contêineres somam por cima). O editor de Espécies sobrescreve.
 */
export const SPECIES_CARRY_DEFAULTS = {
  humano: { slots: 10, carry: 30 },
  elfo: { slots: 10, carry: 25 },
  anao: { slots: 12, carry: 45 },
  orc: { slots: 12, carry: 50 },
  goblin: { slots: 8, carry: 15 },
  halfling: { slots: 8, carry: 15 },
  slime: { slots: 6, carry: 20 },
  dragoide: { slots: 12, carry: 60 },
  ogro: { slots: 14, carry: 90 },
  lobo_tempestade: { slots: 3, carry: 20 },
  harpia: { slots: 6, carry: 10 },
  ciborgue: { slots: 12, carry: 60 },
  androide: { slots: 12, carry: 50 },
  mutante: { slots: 10, carry: 40 },
  simbionte: { slots: 10, carry: 35 },
  slime_demoniaco: { slots: 8, carry: 30 },
  kijin: { slots: 12, carry: 70 },
  cavalo: { slots: 4, carry: 100 },
  lobo_gigante: { slots: 4, carry: 60 },
  grifo: { slots: 4, carry: 80 },
  inseto_de_carga: { slots: 8, carry: 150 }
};
