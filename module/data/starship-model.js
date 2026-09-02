import { MEU_SISTEMA, getStarshipEnergyLabel } from "../config.js";

const fields = foundry.data.fields;

/**
 * Campos compartilhados por Nave Espacial E Veículo (overhaul de Porte — Veículo ganha o
 * sistema COMPLETO, só travado em Porte mini/pequeno via `sizeChoices`): Estrutura (`hull`,
 * ainda rotulado "Casco" na UI por enquanto — vira "Estrutura" quando a cascata de dano de 3
 * camadas entrar), Escudos, o slot de Casco propriamente dito (`casco`, ainda não derivado de
 * um Módulo — isso é ligado quando a cascata Escudo→Casco→Estrutura for implementada), o Grid
 * de Energia e os bônus de combate de Skills de aprimoramento.
 */
function shipSystemsSchema({ sizeChoices }) {
  return {
    /** Porte da Nave/Veículo — só o Mestre edita (mesmo padrão de Nível). */
    shipSize: new fields.StringField({ required: true, initial: sizeChoices[0], choices: sizeChoices }),

    hull: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 })
    }),
    shields: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
      regenRate: new fields.NumberField({ required: true, integer: true, initial: 5, min: 0 })
    }),

    /**
     * Vida do Casco propriamente dito — ainda não derivada do Módulo "armor" instalado (isso é
     * ligado junto da cascata de dano Escudo→Casco→Estrutura); por enquanto só reserva o campo.
     */
    casco: new fields.SchemaField({
      value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      max: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    }),

    powerGrid: new fields.SchemaField({
      /** Geração contínua do reator principal. */
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
 * Base compartilhada por Nave Espacial e Veículo (overhaul de Porte, Fase 2) — os dois tipos
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

  /** Soma do consumo de todos os módulos atualmente online. */
  get totalConsumption() {
    return this.modules
      .filter(m => m.system.status === "online")
      .reduce((sum, m) => sum + (m.system.powerConsumption ?? 0), 0);
  }

  /** Energia Disponível = Reator + Baterias - Consumo Total. */
  get availableEnergy() {
    return this.powerGrid.reactorOutput + this.powerGrid.capacitor.value - this.totalConsumption;
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

  prepareDerivedData() {
    this.hull.value = Math.clamp(this.hull.value, 0, this.hull.max);
    this.shields.value = Math.clamp(this.shields.value, 0, this.shields.max);
    this.casco.value = Math.clamp(this.casco.value, 0, this.casco.max);
    this.powerGrid.capacitor.value = Math.clamp(this.powerGrid.capacitor.value, 0, this.powerGrid.capacitor.max);
    this.powerGrid.isOverloaded = this.availableEnergy < 0;
  }

  /**
   * Aplica um "tick" do grid de energia: excedente do reator recarrega os capacitores;
   * déficit é descontado dos capacitores. Se os capacitores não bastarem, o grid entra
   * em sobrecarga (isOverloaded = true) e o chamador deve tratar as consequências
   * (queda de módulos, dano ao casco, etc).
   * @returns {{available:number, overloaded:boolean}}
   */
  async applyPowerGridTick() {
    const consumption = this.totalConsumption;
    const surplus = this.powerGrid.reactorOutput - consumption;
    const cap = this.powerGrid.capacitor;
    let newValue = cap.value + surplus;
    const overloaded = newValue < 0;
    newValue = Math.clamp(newValue, 0, cap.max);

    await this.parent.update({
      "system.powerGrid.capacitor.value": newValue,
      "system.powerGrid.isOverloaded": overloaded
    });

    return { available: this.powerGrid.reactorOutput + newValue - consumption, overloaded };
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
      maneuverability: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      crew: new fields.NumberField({ required: false, integer: true, initial: 1, min: 0 }),
      biography: new fields.HTMLField({ required: false, initial: "" })
    };
  }
}

/**
 * Veículo terrestre (carro, moto...): overhaul de Porte deu a ele o MESMO sistema completo de
 * Nave Espacial (Estrutura/Escudos/Casco/Grid de Energia/bônus de combate/Módulos de slot único
 * — `ShipSystemsDataModel`), travado em Porte mini/pequeno (`MEU_SISTEMA.VEHICLE_SIZES`), mais
 * Velocidade, Combustível/Bateria e Peças (Items type "item"), que não têm equivalente em Nave.
 */
export class VehicleDataModel extends ShipSystemsDataModel {
  static defineSchema() {
    return {
      ...shipSystemsSchema({ sizeChoices: MEU_SISTEMA.VEHICLE_SIZES }),
      speed: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
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

  prepareDerivedData() {
    super.prepareDerivedData();
    this.fuel.value = Math.clamp(this.fuel.value, 0, this.fuel.max);
  }
}
