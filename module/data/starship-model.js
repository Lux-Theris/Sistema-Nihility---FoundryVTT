import { MEU_SISTEMA, getStarshipEnergyLabel } from "../config.js";

const fields = foundry.data.fields;

/**
 * Campos compartilhados por Nave Espacial E Veículo (overhaul de Porte — Veículo ganha o
 * sistema COMPLETO, só travado em Porte mini/pequeno via `sizeChoices`): Estrutura (`hull` —
 * o "HP base", nunca vem de Módulo), Escudos (com Recarga — ver `rechargeRemaining` abaixo),
 * o Casco propriamente dito (`casco`, com `max` derivado do Módulo "armor" instalado — ver
 * `prepareDerivedData`), o Grid de Energia e os bônus de combate de Skills de aprimoramento.
 * A cascata de dano de 3 camadas (Escudo→Casco→Estrutura, Fase 4) mora em skill-effects.js —
 * `applyStarshipDamageCascade`.
 */
function shipSystemsSchema({ sizeChoices }) {
  return {
    /** Porte da Nave/Veículo — só o Mestre edita (mesmo padrão de Nível). */
    shipSize: new fields.StringField({ required: true, initial: sizeChoices[0], choices: sizeChoices }),

    /** Estrutura/Integridade Estrutural — última camada da cascata de dano, nunca reduzida por nada própria. */
    hull: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 })
    }),
    shields: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
      regenRate: new fields.NumberField({ required: true, integer: true, initial: 5, min: 0 }),
      /**
       * Rodadas restantes de Recarga (0% de proteção) depois do Escudo zerar — enquanto > 0 não
       * regenera nem absorve dano; ao chegar a 0, volta a regenerar normalmente (ver tick de
       * Escudo em starship-power.js). Setado pela cascata de dano quando `shields.value` zera.
       */
      rechargeRemaining: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    }),

    /**
     * Vida do Casco propriamente dito — camada intermediária da cascata de dano (Escudo→Casco→
     * Estrutura, Fase 4). `max` é derivado do Módulo "armor" instalado (`armorModule.system.hp.max`,
     * ver `prepareDerivedData`) enquanto houver um; sem Módulo, fica editável à mão em 0.
     */
    casco: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    }),

    powerGrid: new fields.SchemaField({
      /**
       * Geração contínua do Reator. Manualmente editável enquanto não houver Módulo "reactor"
       * instalado; a partir do momento que houver, vira derivada dele (`reactorOutput` do
       * Módulo × throttle, ver `prepareDerivedData`) e este valor passa a ser só um espelho.
       */
      reactorOutput: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
      /** Baterias/Capacitores: armazenam excedente e descarregam quando o consumo supera o reator. */
      capacitor: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 })
      }),
      /** true quando o consumo excedeu Reator + Capacitores no último recálculo. */
      isOverloaded: new fields.BooleanField({ required: false, initial: false })
    }),

    /**
     * Bônus de arma dados por Skills de aprimoramento "Efeito Temporário" (ver
     * EFFECT_TARGETS "shipWeaponDamage"/"shipWeaponPenetration" em config.js) — Multiplicador
     * começa em 1 (não 0) porque `CONST.ACTIVE_EFFECT_MODES.MULTIPLY` multiplica o valor
     * atual do campo; Flat soma por cima do resultado já multiplicado (ver rollSkillDamage
     * em skill-effects.js). Nunca editado à mão — só por Active Effect de Skill.
     */
    combatBonuses: new fields.SchemaField({
      weaponDamageFlat: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      weaponDamageMultiplier: new fields.NumberField({ required: true, initial: 1, min: 0 }),
      weaponPenetrationFlat: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      weaponPenetrationMultiplier: new fields.NumberField({ required: true, initial: 1, min: 0 })
    })
  };
}

/**
 * Base compartilhada por Nave Espacial e Veículo (overhaul de Porte, Fase 2-3) — os dois tipos
 * usam o MESMO Grid de Energia e o mesmo conceito de Módulos de slot único (Reator/Bateria/
 * Distribuidor/Escudo/Motor/Casco/FTL, ver MEU_SISTEMA.STARSHIP_SINGLE_SLOT_CATEGORIES) em vez
 * de cada um reimplementar os mesmos getters. `armorModule` substitui o antigo campo solto
 * `armorModuleId`: como só pode existir UM Módulo "armor" por vez (garantido pelo hook de
 * compatibilidade em nihility-rpg-system.js), basta procurar pela categoria — nada de manter
 * um id sincronizado à mão.
 */
class ShipSystemsDataModel extends foundry.abstract.TypeDataModel {
  /** Rótulo de energia atual (setting compartilhada entre Nave e Veículo). */
  get energyLabel() {
    return getStarshipEnergyLabel();
  }

  /** Módulos instalados (Items type "starship_module"). */
  get modules() {
    return this.parent.items.filter(i => i.type === "starship_module");
  }

  /**
   * Habilidades concedidas por Módulos "online" — sem economia de pontos nem fusão, mas
   * "Usáveis" (dano/efeito/Ativa) igual Skill de Personagem.
   */
  get skills() {
    return this.parent.items.filter(i => i.type === "skill");
  }

  /** Soma do consumo de todos os módulos atualmente online, já escalado pelo throttle de cada um (Fase 3). */
  get totalConsumption() {
    return this.modules
      .filter(m => m.system.status === "online")
      .reduce((sum, m) => sum + Math.round((m.system.powerConsumption ?? 0) * ((m.system.powerAllocationPercent ?? 100) / 100)), 0);
  }

  /** Energia Disponível = min(Reator, Capacidade de Transferência) + Baterias - Consumo Total. */
  get availableEnergy() {
    return Math.min(this.powerGrid.reactorOutput, this.transferCapacity) + this.powerGrid.capacitor.value - this.totalConsumption;
  }

  /** Único Módulo instalado de uma categoria de slot único, ou `null` se vazio. */
  singleSlotModule(category) {
    return this.modules.find(m => m.system.category === category) ?? null;
  }

  get reactorModule() { return this.singleSlotModule("reactor"); }
  get batteryModule() { return this.singleSlotModule("battery"); }
  get distributorModule() { return this.singleSlotModule("distributor"); }
  get shieldModule() { return this.singleSlotModule("shield"); }
  get engineModule() { return this.singleSlotModule("engine"); }
  get ftlModule() { return this.singleSlotModule("ftl"); }

  /** O único Módulo "armor" instalado (Casco), ou `null` se o slot estiver vazio. */
  get armorModule() { return this.singleSlotModule("armor"); }

  /** Redução de dano do Casco instalado, em fração (0-1) — 0 se o slot estiver vazio. */
  get armorReductionPercent() {
    return Math.clamp((this.armorModule?.system.armorReduction ?? 0) / 100, 0, 1);
  }

  /** Armas instaladas (category "weapon") — múltiplas, ao contrário dos slots únicos acima. */
  get weaponModules() {
    return this.modules.filter(m => m.system.category === "weapon");
  }

  /**
   * Orçamento de espaço de Arma pro Porte desta Nave/Veículo. Placeholder `Infinity`
   * (sem limite) até `MEU_SISTEMA.WEAPON_SLOT_BUDGET_BY_SHIP_SIZE` ser preenchido — valores a
   * fechar com o Mestre (Fase 8 do overhaul de Naves); a partir do momento que a tabela
   * existir, o orçamento passa a valer sozinho, sem mudar mais nada neste getter.
   */
  get weaponSlotBudget() {
    return MEU_SISTEMA.WEAPON_SLOT_BUDGET_BY_SHIP_SIZE?.[this.shipSize] ?? Infinity;
  }

  /** Espaço de Arma já ocupado — cada Arma consome (rank do seu Porte + 1) unidades (Compacto = 1). */
  get weaponSpaceUsed() {
    return this.weaponModules.reduce((sum, m) => sum + MEU_SISTEMA.MODULE_SIZE_RANK[m.system.moduleSize] + 1, 0);
  }

  /**
   * Capacidade de Transferência do Distribuidor — o teto de energia que a Nave/Veículo INTEIRA
   * consegue rotear por rodada (não por módulo), inspirado no Distribuidor de Energia de Elite
   * Dangerous. Sem Distribuidor instalado é 0, não "sem limite" — sem ele a Nave não consegue
   * rotear energia nenhuma, precisa do Módulo de verdade pra funcionar.
   */
  get transferCapacity() {
    const distributor = this.distributorModule;
    if (!distributor) return 0;
    const baseline = MEU_SISTEMA.DISTRIBUTOR_BASELINE_BY_SHIP_SIZE[this.shipSize] ?? 0;
    return Math.round(baseline * (distributor.system.transferFactor ?? 1));
  }

  /**
   * Estado ao vivo do Distribuidor (Overhaul de Naves, Fase 3) — recalculado a cada leitura,
   * nunca armazenado: quanto cada Módulo "online" está pedindo agora, quanto a Capacidade de
   * Transferência + a Reserva da Bateria conseguem cobrir, e — se nem isso bastar — a fração
   * (0-1) que cada Módulo de fato recebe nesta rodada, financiando em ordem de `powerPriority`
   * (menor primeiro). Isso é FOME DE ENERGIA, não dano: não persiste entre recálculos, não
   * desliga o Módulo sozinho, só reduz o que ele entrega enquanto a demanda continuar acima do
   * que a Nave/Veículo consegue entregar — se resolve sozinho assim que a demanda cair.
   */
  get powerShortfall() {
    const online = this.modules.filter(m => m.system.status === "online");
    const sorted = [...online].sort((a, b) => a.system.powerPriority - b.system.powerPriority);
    let available = Math.min(this.powerGrid.reactorOutput, this.transferCapacity) + this.powerGrid.capacitor.value;

    const ratios = new Map();
    for (const module of sorted) {
      const demand = (module.system.powerConsumption ?? 0) * ((module.system.powerAllocationPercent ?? 100) / 100);
      if (demand <= 0) {
        ratios.set(module.id, 1);
        continue;
      }
      if (available >= demand) {
        available -= demand;
        ratios.set(module.id, 1);
      } else {
        ratios.set(module.id, Math.max(0, available / demand));
        available = 0;
      }
    }

    return { ratios, totalDemand: this.totalConsumption, capacity: this.transferCapacity };
  }

  /** Fração (0-1) de capacidade que este Módulo de fato recebe agora — 1 se não houver déficit de energia. */
  powerRatioFor(module) {
    if (!module) return 1;
    return this.powerShortfall.ratios.get(module.id) ?? 1;
  }

  /**
   * Valor de um campo do Módulo já escalado pelo throttle (`powerAllocationPercent`) E pela
   * fome de energia do momento (`powerRatioFor`) — base pra toda capacidade derivada de Módulo
   * (Vida/Regen de Escudo, Aceleração/Rotação de Motor, Fator de Dobra de FTL, e futuramente
   * Dano/Penetração de Arma na Fase 5). `null`/sem Módulo instalado retorna 0.
   */
  effectiveModuleStat(module, field) {
    if (!module) return 0;
    const throttleRatio = (module.system.powerAllocationPercent ?? 100) / 100;
    const powerRatio = this.powerRatioFor(module);
    return Math.round((module.system[field] ?? 0) * throttleRatio * powerRatio);
  }

  prepareDerivedData() {
    // Reator/Bateria/Escudo/Casco são 100% derivados do Módulo instalado — sem o Módulo
    // correspondente o valor é 0, não um fallback editável à mão (instalar o Módulo é a única
    // forma de configurar isso agora). `effectiveModuleStat`/`?? 0` já cobrem o caso "sem Módulo".
    this.powerGrid.reactorOutput = this.effectiveModuleStat(this.reactorModule, "reactorOutput");
    this.powerGrid.capacitor.max = this.effectiveModuleStat(this.batteryModule, "batteryCapacity");
    this.shields.max = this.effectiveModuleStat(this.shieldModule, "shieldCapacity");
    this.shields.regenRate = this.effectiveModuleStat(this.shieldModule, "shieldRegen");
    this.casco.max = this.armorModule?.system.hp.max ?? 0;

    this.hull.value = Math.clamp(this.hull.value, 0, this.hull.max);
    this.shields.value = Math.clamp(this.shields.value, 0, this.shields.max);
    this.casco.value = Math.clamp(this.casco.value, 0, this.casco.max);
    this.powerGrid.capacitor.value = Math.clamp(this.powerGrid.capacitor.value, 0, this.powerGrid.capacitor.max);
    this.powerGrid.isOverloaded = this.availableEnergy < 0;
  }

  /**
   * Aplica um "tick" do grid de energia: excedente do reator (já limitado pela Capacidade de
   * Transferência do Distribuidor) recarrega os capacitores; déficit é descontado dos
   * capacitores. Se os capacitores não bastarem, o grid entra em sobrecarga (isOverloaded =
   * true) e o chamador deve tratar as consequências (queda de módulos, dano ao casco, etc).
   * @returns {{available:number, overloaded:boolean}}
   */
  async applyPowerGridTick() {
    const generation = Math.min(this.powerGrid.reactorOutput, this.transferCapacity);
    const consumption = this.totalConsumption;
    const surplus = generation - consumption;
    const cap = this.powerGrid.capacitor;
    let newValue = cap.value + surplus;
    const overloaded = newValue < 0;
    newValue = Math.clamp(newValue, 0, cap.max);

    await this.parent.update({
      "system.powerGrid.capacitor.value": newValue,
      "system.powerGrid.isOverloaded": overloaded
    });

    return { available: generation + newValue - consumption, overloaded };
  }
}

/**
 * Nave Espacial: casco, escudos, manobra e o Grid de Energia (EPS) — ver `ShipSystemsDataModel`
 * pros getters/métodos compartilhados com Veículo.
 */
export class StarshipDataModel extends ShipSystemsDataModel {
  static defineSchema() {
    return {
      ...shipSystemsSchema({ sizeChoices: MEU_SISTEMA.SHIP_SIZES }),
      crew: new fields.NumberField({ required: false, integer: true, initial: 1, min: 0 }),
      biography: new fields.HTMLField({ required: false, initial: "" })
    };
  }

  /** Manobra = Rotação do Motor instalado, já escalada por throttle e fome de energia (Fase 3) — 0 sem Motor. */
  get maneuverability() {
    return this.effectiveModuleStat(this.engineModule, "rotation");
  }
}

/**
 * Veículo terrestre (carro, moto...): overhaul de Porte deu a ele o MESMO sistema completo de
 * Nave Espacial (Estrutura/Escudos/Casco/Grid de Energia/bônus de combate/Módulos de slot único
 * — `ShipSystemsDataModel`), travado em Porte mini/pequeno (`MEU_SISTEMA.VEHICLE_SIZES`), mais
 * Combustível/Bateria e Peças (Items type "item"), que não têm equivalente em Nave.
 */
export class VehicleDataModel extends ShipSystemsDataModel {
  static defineSchema() {
    return {
      ...shipSystemsSchema({ sizeChoices: MEU_SISTEMA.VEHICLE_SIZES }),
      fuel: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
        type: new fields.StringField({ required: true, initial: "fuel", choices: ["fuel", "battery"] })
      }),
      crew: new fields.NumberField({ required: false, integer: true, initial: 1, min: 0 }),
      biography: new fields.HTMLField({ required: false, initial: "" })
    };
  }

  /** Peças/módulos genéricos instalados (Items type "item") — conceito exclusivo de Veículo. */
  get parts() {
    return this.parent.items.filter(i => i.type === "item");
  }

  /** Velocidade = Aceleração do Motor instalado, já escalada por throttle e fome de energia (Fase 3) — 0 sem Motor. */
  get speed() {
    return this.effectiveModuleStat(this.engineModule, "acceleration");
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.fuel.value = Math.clamp(this.fuel.value, 0, this.fuel.max);
  }
}
