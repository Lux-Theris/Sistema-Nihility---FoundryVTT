/**
 * Arquétipos de NPC de fábrica (Gerador de NPC, canvas "Gerador de NPC") e as tabelas de nomes.
 * Dados puros: não importa nada (constants.js lê isto no carregamento).
 *
 * Cada Skill é uma Skill completa no mesmo formato das Skills Raciais (campos soltos, editados no
 * editor de Skill). `weights`: 0 Pouco · 1 Normal · 2 Bastante · 3 Muito; atributo ausente = 1.
 * Elementos de Sci-Fi (kinetic, phaser) somem sozinhos num mundo que não os tem.
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

/** Skill de dano num alvo (ou em área, com `area`). */
const damage = (name, description, formula, elements, scaling, cost, extra = {}) => ({
  name,
  description,
  tier: "normal",
  level: 1,
  cost,
  effectType: "damage",
  damageFormula: formula,
  damageElements: elements,
  scalingAttribute: scaling,
  targetType: "targeted",
  ...extra
});

/** Skill de Efeito (buff, debuff, Condição, cura, Escudo). */
const buff = (name, description, targetType, effects, cost, extra = {}) => ({
  name,
  description,
  tier: "normal",
  level: 1,
  cost,
  effectType: "temporary",
  targetType,
  effects,
  ...extra
});

/** Skill Descritiva: o Mestre julga. */
const narrative = (name, description, cost = 0, extra = {}) => ({ name, description, tier: "normal", level: 1, cost, effectType: "none", targetType: "self", ...extra });

const area = (shape, distance, angle = 53) => ({ targetType: "emission", areaShape: shape, areaDistance: distance, areaAngle: angle });

const weapon = (name, formula, elements, scaling, chance = 100, extra = {}) => ({
  name,
  img: "icons/svg/sword.svg",
  chance,
  system: { quantity: 1, equipped: true, description: "", weapon: { enabled: true, damageFormula: formula, scalingAttribute: scaling, damageElements: elements, isMagicDamage: Boolean(extra.magic) } }
});

const gear = (name, chance = 100, img = "icons/svg/item-bag.svg") => ({ name, img, chance, system: { quantity: 1, equipped: false, description: "" } });

const potion = (name, target, chance, extra = {}) => ({
  name,
  img: "icons/svg/heal.svg",
  chance,
  system: {
    quantity: 1,
    equipped: false,
    description: "",
    consumable: { enabled: true, effectType: "temporary", targetType: extra.targetType ?? "self", effects: [effect(target, 25, 0, { amountMode: "percentMax" })], charges: extra.charges ?? 0 }
  }
});

const grenade = (name, formula, elements, chance) => ({
  name,
  img: "icons/svg/explosion.svg",
  chance,
  system: { quantity: 1, equipped: false, description: "", consumable: { enabled: true, effectType: "damage", targetType: "emission", areaShape: "circle", areaDistance: 3, damageFormula: formula, damageElements: elements, effects: [] } }
});

const FANTASY_FOLK = ["humano", "elfo", "anao", "halfling"];
const SCIFI_FOLK = ["humano", "ciborgue", "androide", "mutante"];

export const DEFAULT_NPC_ARCHETYPES = [
  /* ------------------------------------------------ Comum */
  {
    id: "civil",
    label: "Civil",
    group: "comum",
    img: "icons/svg/mystery-man.svg",
    description: "Gente comum: multidão, testemunha, refém. Sem Skills.",
    species: [],
    pointsPercent: 50,
    weights: {},
    luck: "high",
    skillsMin: 0,
    skillsMax: 0,
    skillLevel: "one",
    skills: [],
    items: [gear("Roupas comuns", 100), gear("Bolsa com algumas moedas", 50)]
  },
  {
    id: "comerciante",
    label: "Comerciante",
    group: "comum",
    img: "icons/svg/coins.svg",
    description: "Vende, compra e sabe o preço de tudo.",
    species: [],
    pointsPercent: 75,
    weights: { perception: 2, magic: 0, magicalDefense: 0 },
    luck: "medium",
    skillsMin: 1,
    skillsMax: 2,
    skillLevel: "one",
    skills: [
      narrative("Pechinchar", "Consegue um preço melhor numa negociação."),
      narrative("Avaliar Mercadoria", "Sabe se um objeto é falso e quanto vale."),
      buff("Olho Treinado", "Repara em detalhes que passam despercebidos.", "self", [effect("perception", 3, 3)], 5)
    ],
    items: [gear("Mercadorias", 100), weapon("Adaga", "1d6", ["piercing"], "dexterity", 30)]
  },
  {
    id: "guarda",
    label: "Guarda",
    group: "comum",
    img: "icons/svg/shield.svg",
    description: "Vigia portões, ruas e prisões.",
    species: [],
    pointsPercent: 100,
    weights: { strength: 3, defense: 3, perception: 2, magic: 0, magicalDefense: 0, stealth: 0 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Golpe de Escudo", "Empurra o escudo contra o inimigo.", "2d6", ["blunt"], "strength", 6), always: true },
      buff("Postura Defensiva", "Fecha a guarda atrás do escudo.", "self", [effect("defense", 4, 2)], 8),
      buff("Imobilizar", "Agarra e prende o braço do alvo.", "targeted", [effect("dexterity", -3, 2, { conditionId: "slow" })], 10),
      narrative("Dar o Alarme", "Chama reforços: outros guardas chegam em algumas rodadas.")
    ],
    items: [weapon("Lança", "1d8", ["piercing"], "strength"), gear("Escudo", 70, "icons/svg/shield.svg"), gear("Tocha", 40, "icons/svg/fire.svg")]
  },

  /* ------------------------------------------------ Fantasia */
  {
    id: "ladrao",
    label: "Ladrão",
    group: "fantasia",
    img: "icons/svg/cowled.svg",
    description: "Furtivo, rápido e sempre com a mão no bolso de alguém.",
    species: ["humano", "anao", "elfo", "halfling", "goblin"],
    pointsPercent: 100,
    weights: { strength: 0, defense: 1, magic: 0, magicalDefense: 0, dexterity: 3, stealth: 3, perception: 2, precision: 2 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Golpe Furtivo", "Ataque pelas costas, onde dói.", "3d6", ["piercing"], "dexterity", 10), always: true },
      buff("Esquiva Ágil", "Fica difícil de acertar por um tempo.", "self", [effect("dexterity", 4, 3)], 8),
      buff("Bomba de Fumaça", "Uma nuvem que cega quem está perto.", "emission", [effect("perception", -3, 2, { conditionId: "blindness" })], 15, area("circle", 3)),
      narrative("Bater Carteira", "Tira algo do bolso de alguém sem ser visto."),
      narrative("Arrombar", "Abre fechaduras e cadeados.")
    ],
    items: [weapon("Adaga", "1d6", ["piercing"], "dexterity"), gear("Gazua", 70), weapon("Besta de Mão", "1d8", ["piercing"], "precision", 30), potion("Poção de Cura", "heal", 50)]
  },
  {
    id: "mago",
    label: "Mago",
    group: "fantasia",
    img: "icons/svg/lightning.svg",
    description: "Estudioso das artes arcanas. Frágil de perto, perigoso de longe.",
    species: ["humano", "elfo", "halfling"],
    pointsPercent: 100,
    weights: { strength: 0, defense: 1, magic: 3, magicalDefense: 3, dexterity: 1, stealth: 0, perception: 1, precision: 1 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Míssil Arcano", "Um dardo de energia pura que nunca erra o caminho.", "2d6", [], "magic", 10, { isMagicDamage: true }), always: true },
      damage("Bola de Fogo", "Uma explosão de chamas num ponto à escolha.", "4d6", ["fire"], "magic", 25, { isMagicDamage: true, ...area("circle", 4) }),
      damage("Raio Congelante", "Um feixe de gelo que queima de frio.", "3d6", ["ice"], "magic", 15, { isMagicDamage: true }),
      buff("Escudo Arcano", "Uma película de força ao redor do corpo.", "self", [effect("shield", 30, 0)], 12),
      buff("Lentidão", "O alvo se move como se andasse na água.", "targeted", [effect("dexterity", -4, 3, { conditionId: "slow" })], 12)
    ],
    items: [weapon("Cajado", "1d6", ["blunt"], "magic", 100, { magic: true }), gear("Grimório", 100, "icons/svg/book.svg"), potion("Poção de Mana", "restoreEnergy", 50)]
  },
  {
    id: "clerigo",
    label: "Clérigo",
    group: "fantasia",
    img: "icons/svg/holy-shield.svg",
    description: "Servo de uma divindade: cura os seus e castiga os outros.",
    species: [...FANTASY_FOLK],
    pointsPercent: 100,
    weights: { strength: 1, defense: 2, magic: 2, magicalDefense: 3, dexterity: 1, stealth: 0, perception: 1, precision: 1 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...buff("Cura", "Fecha feridas com uma prece.", "targeted", [effect("heal", 30, 0)], 12), always: true },
      buff("Bênção", "Fortalece o braço de um aliado.", "targeted", [effect("strength", 3, 3)], 10),
      damage("Luz Sagrada", "Uma luz que fere quem vive nas trevas.", "3d6", ["holy"], "magic", 15, { isMagicDamage: true }),
      buff("Proteção Divina", "Um escudo de luz sobre um aliado.", "targeted", [effect("shield", 25, 0)], 12)
    ],
    items: [weapon("Maça", "1d8", ["blunt"], "strength"), gear("Símbolo Sagrado", 100), potion("Poção de Cura", "heal", 40)]
  },
  {
    id: "cavaleiro",
    label: "Cavaleiro",
    group: "fantasia",
    img: "icons/svg/sword.svg",
    description: "Guerreiro de armadura pesada, treinado para a linha de frente.",
    species: ["humano", "anao", "elfo"],
    pointsPercent: 100,
    weights: { strength: 3, defense: 3, magic: 0, magicalDefense: 1, dexterity: 1, stealth: 0, perception: 1, precision: 1 },
    luck: "low",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Investida", "Avança e golpeia com todo o peso.", "3d6", ["slashing"], "strength", 10), always: true },
      buff("Muralha de Aço", "Planta os pés e vira uma parede.", "self", [effect("defense", 5, 3)], 10),
      damage("Golpe Atordoante", "Um golpe de pomo que tonteia.", "2d8", ["blunt"], "strength", 12),
      narrative("Desafio", "Provoca um inimigo para lutar com ele, e não com os outros.")
    ],
    items: [weapon("Espada Longa", "1d10", ["slashing"], "strength"), gear("Escudo", 100, "icons/svg/shield.svg"), gear("Armadura de Placas", 100)]
  },
  {
    id: "bandido",
    label: "Bandido",
    group: "fantasia",
    img: "icons/svg/skull.svg",
    description: "Assaltante de estrada: ataca em bando e foge quando perde.",
    species: ["humano", "orc", "goblin", "anao"],
    pointsPercent: 100,
    weights: { strength: 2, defense: 1, magic: 0, magicalDefense: 0, dexterity: 2, stealth: 1, perception: 1, precision: 2 },
    luck: "high",
    skillsMin: 1,
    skillsMax: 2,
    skillLevel: "follow",
    skills: [
      damage("Emboscada", "Cai sobre a vítima de surpresa.", "3d6", ["slashing"], "dexterity", 10),
      damage("Golpe Sujo", "Um chute baixo, areia nos olhos.", "2d6", ["blunt"], "strength", 6),
      buff("Intimidar", "Ameaça até o alvo hesitar.", "targeted", [effect("strength", -2, 2, { conditionId: "fear" })], 8),
      buff("Fuga", "Corre como se a vida dependesse disso.", "self", [effect("movement", 50, 2)], 6)
    ],
    items: [weapon("Machadinha", "1d8", ["slashing"], "strength"), weapon("Arco Curto", "1d6", ["piercing"], "precision", 40), gear("Bolsa roubada", 50)]
  },
  {
    id: "cacador",
    label: "Caçador",
    group: "fantasia",
    img: "icons/svg/target.svg",
    description: "Rastreia e abate de longe. Conhece a mata melhor que ninguém.",
    species: ["humano", "elfo", "halfling", "anao"],
    pointsPercent: 100,
    weights: { strength: 1, defense: 1, magic: 0, magicalDefense: 0, dexterity: 2, stealth: 2, perception: 3, precision: 3 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Tiro Certeiro", "Uma flecha no ponto fraco.", "3d8", ["piercing"], "precision", 12), always: true },
      damage("Chuva de Flechas", "Várias flechas de uma vez sobre uma área.", "2d6", ["piercing"], "precision", 20, area("circle", 3)),
      buff("Olhos de Falcão", "Enxerga longe e não perde um movimento.", "self", [effect("perception", 4, 3)], 6),
      buff("Armadilha", "Um laço escondido que prende a perna.", "targeted", [effect("dexterity", -4, 2, { conditionId: "slow" })], 10)
    ],
    items: [weapon("Arco Longo", "1d10", ["piercing"], "precision"), weapon("Faca de Caça", "1d6", ["slashing"], "dexterity", 80), gear("Armadilha de urso", 50)]
  },

  /* ------------------------------------------------ Sci-Fi */
  {
    id: "engenheiro",
    label: "Engenheiro",
    group: "scifi",
    img: "icons/svg/clockwork.svg",
    description: "Conserta, improvisa e transforma sucata em vantagem.",
    species: [...SCIFI_FOLK],
    pointsPercent: 100,
    weights: { strength: 1, defense: 1, magic: 0, magicalDefense: 1, dexterity: 1, stealth: 1, perception: 2, precision: 2 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...buff("Escudo Portátil", "Projeta um campo de força num aliado.", "targeted", [effect("shield", 30, 0)], 12), always: true },
      damage("Drone de Combate", "Um drone que dispara contra o alvo.", "2d6", ["phaser"], "precision", 10),
      buff("Sobrecarga de Arma", "Mexe na arma até ela bater mais forte.", "self", [effect("weaponDamage", 3, 3)], 8),
      narrative("Sabotagem", "Desliga uma porta, câmera ou máquina por algumas rodadas.")
    ],
    items: [gear("Chave inteligente", 100), weapon("Pistola de Pregos", "1d6", ["piercing"], "precision", 60), gear("Kit de reparo", 50)]
  },
  {
    id: "policial",
    label: "Policial",
    group: "scifi",
    img: "icons/svg/eye.svg",
    description: "Agente da lei: prende, interroga e atira se precisar.",
    species: [...SCIFI_FOLK],
    pointsPercent: 100,
    weights: { strength: 2, defense: 2, magic: 0, magicalDefense: 1, dexterity: 2, stealth: 0, perception: 3, precision: 2 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Disparo Atordoante", "Um tiro de baixa potência para derrubar sem matar.", "2d6", ["blunt"], "precision", 6), always: true },
      buff("Algemar", "Prende os pulsos do alvo.", "targeted", [effect("dexterity", -6, 2, { conditionId: "slow" })], 5),
      buff("Ordem de Parar", "\"Parado!\" — o alvo hesita.", "targeted", [effect("strength", -2, 1, { conditionId: "fear" })], 6),
      buff("Cobertura", "Se abriga atrás do que encontrar.", "self", [effect("defense", 4, 2)], 6)
    ],
    items: [weapon("Pistola", "1d8", ["kinetic"], "precision"), weapon("Cassetete", "1d6", ["blunt"], "strength", 80), gear("Distintivo", 100), gear("Algemas", 70)]
  },
  {
    id: "soldado",
    label: "Soldado",
    group: "scifi",
    img: "icons/svg/combat.svg",
    description: "Infantaria treinada: atira em grupo e segura a posição.",
    species: [...SCIFI_FOLK],
    pointsPercent: 100,
    weights: { strength: 2, defense: 3, magic: 0, magicalDefense: 1, dexterity: 2, stealth: 1, perception: 1, precision: 3 },
    luck: "low",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...damage("Rajada", "Esvazia meio carregador num cone à frente.", "3d6", ["kinetic"], "precision", 15, area("cone", 6)), always: true },
      damage("Tiro Preciso", "Mira com calma e acerta onde quer.", "3d8", ["kinetic"], "precision", 12),
      buff("Fogo de Supressão", "Ninguém levanta a cabeça debaixo desses tiros.", "emission", [effect("dexterity", -3, 2, { conditionId: "slow" })], 10, area("cone", 6)),
      buff("Entrincheirar", "Firma posição atrás de cobertura.", "self", [effect("defense", 5, 3)], 8)
    ],
    items: [weapon("Rifle de Assalto", "1d10", ["kinetic"], "precision"), weapon("Faca de Combate", "1d6", ["slashing"], "dexterity", 80), grenade("Granada", "3d6", ["kinetic"], 60), potion("Stimpack", "heal", 50)]
  },
  {
    id: "medico",
    label: "Médico",
    group: "scifi",
    img: "icons/svg/heal.svg",
    description: "Mantém os outros vivos. Evita a linha de frente.",
    species: [...SCIFI_FOLK],
    pointsPercent: 100,
    weights: { strength: 0, defense: 1, magic: 0, magicalDefense: 1, dexterity: 2, stealth: 1, perception: 2, precision: 2 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...buff("Primeiros Socorros", "Estanca o sangramento e fecha a ferida.", "targeted", [effect("heal", 30, 0)], 10), always: true },
      buff("Estimulante", "Uma injeção que deixa o aliado mais rápido.", "targeted", [effect("dexterity", 3, 3)], 8),
      buff("Sedativo", "Um dardo que derruba o alvo por um instante.", "targeted", [effect("dexterity", -4, 1, { conditionId: "stun" })], 12),
      narrative("Antídoto", "Neutraliza um veneno: o Mestre tira a Condição.")
    ],
    items: [potion("Kit Médico", "heal", 100, { targetType: "targeted", charges: 3 }), weapon("Pistola Leve", "1d6", ["kinetic"], "precision", 60), potion("Stimpack", "heal", 50)]
  },
  {
    id: "hacker",
    label: "Hacker",
    group: "scifi",
    img: "icons/svg/padlock.svg",
    description: "Entra em qualquer sistema. Prefere não estar na sala.",
    species: [...SCIFI_FOLK],
    pointsPercent: 100,
    weights: { strength: 0, defense: 0, magic: 0, magicalDefense: 1, dexterity: 2, stealth: 2, perception: 3, precision: 2 },
    luck: "medium",
    skillsMin: 2,
    skillsMax: 3,
    skillLevel: "follow",
    skills: [
      { ...narrative("Invadir Sistema", "Abre portas, apaga registros, controla câmeras."), always: true },
      damage("Pulso de Interferência", "Uma descarga que frita eletrônicos e quem estiver perto.", "2d6", ["lightning"], "precision", 12, area("circle", 3)),
      buff("Camuflagem Óptica", "Some da vista por algumas rodadas.", "self", [effect("stealth", 5, 3)], 10),
      buff("Cegar Câmeras", "Sobrecarrega os implantes visuais do alvo.", "targeted", [effect("perception", -4, 2, { conditionId: "blindness" })], 10)
    ],
    items: [gear("Deck de invasão", 100), weapon("Pistola Leve", "1d6", ["kinetic"], "precision", 60)]
  }
];

/** Nomes para o gerador ("Sorteados"), por cultura. */
export const NPC_NAME_TABLES = {
  fantasia: {
    first: ["Aldric", "Bran", "Cedric", "Doran", "Elara", "Fenna", "Garrick", "Helga", "Isolde", "Joran", "Kael", "Lyra", "Mira", "Nessa", "Orin", "Petra", "Quill", "Rowan", "Sef", "Tobias", "Ulric", "Vera", "Wren", "Ysolde", "Zora", "Bertram", "Edda", "Hugo", "Ilsa", "Mattias"],
    last: ["Ferro", "Vesk", "da Ponte", "Corvo-Negro", "Pedra-Funda", "Valemar", "Brasa", "do Moinho", "Ventura", "Salgueiro", "Martelo", "Cinza", "Torrealta", "Espinho", "Rocha", "Mão-Leve", "de Arvel", "Fonte-Fria"]
  },
  scifi: {
    first: ["Ana", "Bex", "Cass", "Dax", "Eko", "Finn", "Gia", "Hal", "Iris", "Jax", "Kira", "Leo", "Mara", "Nico", "Oz", "Pia", "Rho", "Sol", "Tess", "Vik", "Wen", "Yuri", "Zed", "Ravi", "Noor", "Lena", "Kenji", "Dara"],
    last: ["Okafor", "Vance", "Reyes", "Nakamura", "Kowalski", "Hale", "Duarte", "Ibarra", "Sato", "Volkov", "Mbeki", "Castell", "Orlov", "Ferreira", "Lindqvist", "Kade", "Tanaka", "Moreau"]
  }
};

/** Grupos do editor e do gerador, na ordem. Um grupo desconhecido vai para "Outros". */
export const NPC_ARCHETYPE_GROUP_LABELS = { comum: "Comum", fantasia: "Fantasia", scifi: "Sci-Fi" };
