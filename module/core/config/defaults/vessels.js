/**
 * Naves e Veículos de fábrica: Portes, Classes, Funções e Categorias de Módulo, presets por Porte, postos de Tripulação.
 * Dados puros, referenciados por MEU_SISTEMA (core/config/constants.js); importe de
 * `core/config.js`. Separado em 1.68.0 sem mudar nenhum valor.
 */

/**
 * Portes de Nave e de Veículo — listas próprias, editáveis (Configurações Gerais › Naves), do
 * menor pro maior (a ordem é a régua da faixa de Porte das Classes). Cada linha guarda os números
 * do Porte:
 * - `rank` (0-4): maior Porte de Módulo aceito (0 = Compacto … 4 = Colossal) e o Motor de
 *   referência da razão do Motor; também é a régua do Raio Trator.
 * - `weaponBudget`: espaço de Arma (cada Arma ocupa rank do Porte dela + 1).
 * - `distributorBaseline`: teto do Distribuidor com Fator 1 (EPS/rodada).
 * - `conduitCapacitor`: reserva dos conduítes do casco sem Bateria. Instalar uma Bateria
 *   SUBSTITUI esse valor, então fica abaixo de 125 (a menor Bateria, Compacta) — trocar nunca
 *   piora; o teste de regras trava isso nos padrões.
 * - `move` / `evasion`: casas por rodada e Evasão (%) base, com o Motor do tamanho esperado.
 * - `massReference` (kg): carga do porão que corta o desempenho do Motor pela metade.
 * Os ids mini/pequeno/medio/grande/capital são os de sempre (Naves salvas não mudam); Veículo
 * mantém mini/pequeno com os mesmos números de antes e ganha Médio, Grande e Colossal.
 */
export const DEFAULT_SHIP_SIZES = [
  { id: "mini", label: "Mini", rank: 0, weaponBudget: 1, distributorBaseline: 80, conduitCapacitor: 10, move: 8, evasion: 30, massReference: 2000 },
  { id: "pequeno", label: "Pequeno", rank: 1, weaponBudget: 2, distributorBaseline: 160, conduitCapacitor: 20, move: 6, evasion: 22, massReference: 8000 },
  { id: "medio", label: "Médio", rank: 2, weaponBudget: 4, distributorBaseline: 320, conduitCapacitor: 40, move: 5, evasion: 15, massReference: 30000 },
  { id: "grande", label: "Grande", rank: 3, weaponBudget: 8, distributorBaseline: 640, conduitCapacitor: 80, move: 4, evasion: 8, massReference: 120000 },
  { id: "capital", label: "Capital", rank: 4, weaponBudget: 16, distributorBaseline: 1280, conduitCapacitor: 120, move: 3, evasion: 3, massReference: 500000 }
];

export const DEFAULT_VEHICLE_SIZES = [
  { id: "mini", label: "Mini", rank: 0, weaponBudget: 1, distributorBaseline: 80, conduitCapacitor: 10, move: 8, evasion: 30, massReference: 200 },
  { id: "pequeno", label: "Pequeno", rank: 1, weaponBudget: 2, distributorBaseline: 160, conduitCapacitor: 20, move: 6, evasion: 22, massReference: 1000 },
  { id: "medio", label: "Médio", rank: 2, weaponBudget: 4, distributorBaseline: 320, conduitCapacitor: 40, move: 5, evasion: 15, massReference: 4000 },
  { id: "grande", label: "Grande", rank: 3, weaponBudget: 8, distributorBaseline: 640, conduitCapacitor: 80, move: 4, evasion: 8, massReference: 15000 },
  { id: "colossal", label: "Colossal", rank: 4, weaponBudget: 16, distributorBaseline: 1280, conduitCapacitor: 120, move: 3, evasion: 3, massReference: 60000 }
];

/**
 * FUNÇÕES MECÂNICAS de Módulo — o que o código de fato entende. As Categorias (catálogo
 * editável, `moduleCategoriesData`) são nomes livres que apontam pra uma Função: "Motor de
 * Impulso" e "Manobradores" são as duas Propulsão; "Núcleo de Dobra" e "Contêiner da
 * Protoestrela" as duas Geração de Energia. Como várias da mesma Função se combinam é da
 * Função, não da Categoria (senão duas Categorias de Propulsão com regras diferentes brigariam):
 *  - sum: somam (Geração, Armazenamento, Escudo, Propulsão, Blindagem);
 *  - independent: cada uma é usada por si (FTL — dobra, transdobra —, Arma);
 *  - single: só uma ativa (Distribuição; somar dois dobraria o teto de transferência);
 *  - none: sem mecânica (Utilidade/Narrativo — Comunicações, Defletor… só Vida, consumo e
 *    Habilidade Concedida).
 * `presetKey` aponta pra linha de MODULE_SIZE_PRESETS (indexada pelos ids antigos).
 */
export const MODULE_ROLES = {
  power: { label: "Geração de Energia", combine: "sum", presetKey: "reactor", overload: 100 },
  storage: { label: "Armazenamento", combine: "sum", presetKey: "battery", overload: null },
  distribution: { label: "Distribuição", combine: "single", presetKey: "distributor", overload: null },
  shield: { label: "Escudo", combine: "sum", presetKey: "shield", overload: 500 },
  propulsion: { label: "Propulsão", combine: "sum", presetKey: "engine", overload: 200 },
  ftl: { label: "FTL", combine: "independent", presetKey: "ftl", overload: 200 },
  armor: { label: "Blindagem", combine: "sum", presetKey: "armor", overload: 200 },
  weapon: { label: "Arma", combine: "independent", presetKey: "weapon", overload: null },
  utility: { label: "Utilidade/Narrativo", combine: "none", presetKey: "utility", overload: 200 },
  // Raio trator: prende outra Nave (deslocamento dela cai conforme a diferença de Porte).
  tractor: { label: "Raio Trator", combine: "independent", presetKey: "tractor", overload: 200 },
  // Porão: slots de carga da Nave (dobram por Porte, × o multiplicador do Módulo).
  cargo: { label: "Porão de Carga", combine: "sum", presetKey: "cargo", overload: null }
};

/**
 * Catálogo padrão de Categorias — as 9 de sempre, com os MESMOS ids, então Naves salvas antes
 * das Categorias personalizáveis continuam funcionando sem migração. `slots`: quantas cabem por
 * padrão (a Classe pode mudar); 0 = sem limite de contagem (Arma usa o orçamento de espaço).
 */
export const DEFAULT_MODULE_CATEGORIES = [
  { id: "reactor", label: "Reator", role: "power", slots: 1 },
  { id: "battery", label: "Bateria", role: "storage", slots: 1 },
  { id: "distributor", label: "Distribuidor", role: "distribution", slots: 1 },
  { id: "shield", label: "Escudo", role: "shield", slots: 1 },
  { id: "engine", label: "Motor", role: "propulsion", slots: 1 },
  { id: "armor", label: "Casco (Armadura)", role: "armor", slots: 1 },
  { id: "ftl", label: "FTL", role: "ftl", slots: 1 },
  { id: "weapon", label: "Arma", role: "weapon", slots: 0 },
  { id: "utility", label: "Utilidade", role: "utility", slots: 0 },
  { id: "tractor", label: "Raio Trator", role: "tractor", slots: 0 },
  { id: "cargo", label: "Porão", role: "cargo", slots: 0 }
];

/** Categorias estilo Star Trek — carregadas pelo preset Sci-Fi (impulso + manobradores, dobra…). */
export const SCIFI_MODULE_CATEGORIES = [
  { id: "reactor", label: "Núcleo de Dobra", role: "power", slots: 1 },
  { id: "battery", label: "Bancos de Energia", role: "storage", slots: 1 },
  { id: "distributor", label: "Rede EPS", role: "distribution", slots: 1 },
  { id: "shield", label: "Escudos Defletores", role: "shield", slots: 1 },
  { id: "engine", label: "Motor de Impulso", role: "propulsion", slots: 1 },
  { id: "thrusters", label: "Manobradores (RCS)", role: "propulsion", slots: 1 },
  { id: "armor", label: "Blindagem Ablativa", role: "armor", slots: 1 },
  { id: "ftl", label: "Motor de Dobra", role: "ftl", slots: 1 },
  { id: "transwarp", label: "Transdobra", role: "ftl", slots: 0 },
  { id: "weapon", label: "Arma", role: "weapon", slots: 0 },
  { id: "utility", label: "Utilidade", role: "utility", slots: 0 },
  { id: "tractor", label: "Emissor de Raio Trator", role: "tractor", slots: 0 },
  { id: "cargo", label: "Compartimento de Carga", role: "cargo", slots: 0 }
];

/**
 * Classes de Nave (Porte = tamanho, Classe = papel). Multiplicadores sobre o que o Porte dá e
 * vagas por Categoria (`slots`: {categoriaId: n}, sobrescreve o padrão da Categoria). "Parrudo"
 * vem de mais vagas de Blindagem/Escudo. `maxWeaponSize`: id de MODULE_SIZES ("" = sem limite).
 */
export const DEFAULT_SHIP_CLASSES = [
  { id: "explorer", label: "Exploradora", description: "Equilibrada.", evasionMultiplier: 1, movementMultiplier: 1, weaponBudgetMultiplier: 1, maxWeaponSize: "", slots: {} },
  { id: "battleship", label: "Encouraçado", description: "Blindagem e escudos dobrados, lento e fácil de acertar.", evasionMultiplier: 0.6, movementMultiplier: 0.75, weaponBudgetMultiplier: 1.5, maxWeaponSize: "", slots: { armor: 2, shield: 2 }, shieldPenResist: 5, cascoPenResist: 10, hardening: 10 },
  { id: "cruiser", label: "Cruzador", description: "Mais armas que o normal para o Porte.", evasionMultiplier: 0.9, movementMultiplier: 1, weaponBudgetMultiplier: 1.5, maxWeaponSize: "", slots: {} },
  { id: "freighter", label: "Cargueiro", description: "Pouca arma, mais espaço de Utilidade.", evasionMultiplier: 0.8, movementMultiplier: 0.9, weaponBudgetMultiplier: 0.25, maxWeaponSize: "standard", slots: {} },
  { id: "interceptor", label: "Interceptador", description: "Rápido e difícil de acertar, frágil.", evasionMultiplier: 1.4, movementMultiplier: 1.3, weaponBudgetMultiplier: 0.75, maxWeaponSize: "", slots: {} }
];

export const DEFAULT_VEHICLE_CLASSES = [
  { id: "car", label: "Carro", description: "Leve e rápido.", evasionMultiplier: 1.2, movementMultiplier: 1.2, weaponBudgetMultiplier: 0.5, maxWeaponSize: "compact", slots: {} },
  { id: "tank", label: "Tanque", description: "Blindagem dobrada, lento, armado.", evasionMultiplier: 0.5, movementMultiplier: 0.6, weaponBudgetMultiplier: 2, maxWeaponSize: "", slots: { armor: 2 }, cascoPenResist: 15, hardening: 10 },
  { id: "bike", label: "Moto", description: "Muito rápida, quase sem proteção.", evasionMultiplier: 1.6, movementMultiplier: 1.5, weaponBudgetMultiplier: 0.5, maxWeaponSize: "compact", slots: {} }
];

export const DEFAULT_CREW_ROLES = [
  { id: "captain", label: "Capitão" },
  { id: "pilot", label: "Piloto" },
  { id: "engineer", label: "Engenheiro" },
  { id: "tactical", label: "Tático" },
  { id: "science", label: "Ciências" },
  { id: "medic", label: "Médico" }
];

/**
 * Presets de stat sugeridos por Categoria×Porte de Módulo (Fase 8), usados só pra
 * autopreenchimento no editor do Item (Fase 1) — nunca sobrescrevem um valor já editado à
 * mão. Campos de CAPACIDADE (Vida/Consumo/Output/Aceleração/Rotação/dado de Dano) escalam por
 * MODULE_SIZE_MULTIPLIER a partir do valor "a Compacto"; campos de PERCENTUAL (Penetração/
 * Redução) e de TEMPO (Recarga/Carga/Fator) NÃO seguem essa curva — dobrar Recarga a cada
 * Porte deixaria Módulos grandes inutilizáveis, então esses sobem bem mais devagar, num
 * incremento próprio por Porte.
 */
export const MODULE_SIZE_PRESETS = {
  tractor: {
    compact: { powerConsumption: 20 },
    standard: { powerConsumption: 40 },
    reinforced: { powerConsumption: 80 },
    industrial: { powerConsumption: 160 },
    colossal: { powerConsumption: 320 }
  },
  cargo: {
    compact: { powerConsumption: 0 },
    standard: { powerConsumption: 0 },
    reinforced: { powerConsumption: 0 },
    industrial: { powerConsumption: 0 },
    colossal: { powerConsumption: 0 }
  },
  shield: {
    compact: { powerConsumption: 30, shieldCapacity: 100, shieldRegen: 10, shieldRechargeRounds: 3, penetrationResist: 5 },
    standard: { powerConsumption: 60, shieldCapacity: 200, shieldRegen: 20, shieldRechargeRounds: 3, penetrationResist: 10 },
    reinforced: { powerConsumption: 120, shieldCapacity: 400, shieldRegen: 40, shieldRechargeRounds: 4, penetrationResist: 15 },
    industrial: { powerConsumption: 240, shieldCapacity: 800, shieldRegen: 80, shieldRechargeRounds: 4, penetrationResist: 20 },
    colossal: { powerConsumption: 480, shieldCapacity: 1600, shieldRegen: 160, shieldRechargeRounds: 5, penetrationResist: 25 }
  },
  engine: {
    compact: { powerConsumption: 20, acceleration: 20, rotation: 15 },
    standard: { powerConsumption: 40, acceleration: 40, rotation: 30 },
    reinforced: { powerConsumption: 80, acceleration: 80, rotation: 60 },
    industrial: { powerConsumption: 160, acceleration: 160, rotation: 120 },
    colossal: { powerConsumption: 320, acceleration: 320, rotation: 240 }
  },
  reactor: {
    compact: { powerConsumption: 0, reactorOutput: 250 },
    standard: { powerConsumption: 0, reactorOutput: 500 },
    reinforced: { powerConsumption: 0, reactorOutput: 1000 },
    industrial: { powerConsumption: 0, reactorOutput: 2000 },
    colossal: { powerConsumption: 0, reactorOutput: 4000 }
  },
  battery: {
    compact: { powerConsumption: 0, batteryCapacity: 125 },
    standard: { powerConsumption: 0, batteryCapacity: 250 },
    reinforced: { powerConsumption: 0, batteryCapacity: 500 },
    industrial: { powerConsumption: 0, batteryCapacity: 1000 },
    colossal: { powerConsumption: 0, batteryCapacity: 2000 }
  },
  distributor: {
    compact: { powerConsumption: 10, transferFactor: 0.5 },
    standard: { powerConsumption: 20, transferFactor: 1 },
    reinforced: { powerConsumption: 40, transferFactor: 1.5 },
    industrial: { powerConsumption: 80, transferFactor: 2.25 },
    colossal: { powerConsumption: 160, transferFactor: 3 }
  },
  armor: {
    compact: { armorReduction: 10, penetrationResist: 10 },
    standard: { armorReduction: 20, penetrationResist: 15 },
    reinforced: { armorReduction: 30, penetrationResist: 20 },
    industrial: { armorReduction: 45, penetrationResist: 25 },
    colossal: { armorReduction: 60, penetrationResist: 30 }
  },
  ftl: {
    compact: { powerConsumption: 15, warpFactor: 1, jumpRange: 10, chargeTime: 3 },
    standard: { powerConsumption: 30, warpFactor: 1.5, jumpRange: 20, chargeTime: 3 },
    reinforced: { powerConsumption: 60, warpFactor: 2, jumpRange: 40, chargeTime: 4 },
    industrial: { powerConsumption: 120, warpFactor: 3, jumpRange: 80, chargeTime: 4 },
    colossal: { powerConsumption: 240, warpFactor: 4, jumpRange: 160, chargeTime: 5 }
  },
  weapon: {
    compact: { powerConsumption: 15, damageFormula: "1d10", penetration: 10, cooldownRounds: 1 },
    standard: { powerConsumption: 30, damageFormula: "2d10", penetration: 20, cooldownRounds: 2 },
    reinforced: { powerConsumption: 60, damageFormula: "4d10", penetration: 30, cooldownRounds: 2 },
    industrial: { powerConsumption: 120, damageFormula: "8d10", penetration: 40, cooldownRounds: 3 },
    colossal: { powerConsumption: 240, damageFormula: "16d10", penetration: 50, cooldownRounds: 3 }
  },
  utility: {
    compact: { powerConsumption: 10 },
    standard: { powerConsumption: 20 },
    reinforced: { powerConsumption: 40 },
    industrial: { powerConsumption: 80 },
    colossal: { powerConsumption: 160 }
  }
};
