import { getStarshipEnergyLabel } from "../config.js";

const fields = foundry.data.fields;

/**
 * Nave Espacial: casco, escudos, manobra e o Grid de Energia (EPS).
 * O Grid de Energia é derivado a partir do Reator, dos Capacitores/Baterias
 * e do consumo somado dos módulos (Items type "starship_module") instalados e online.
 */
export class StarshipDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      hull: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 })
      }),
      shields: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
        regenRate: new fields.NumberField({ required: true, integer: true, initial: 5, min: 0 })
      }),
      maneuverability: new fields.NumberField({ required: true, integer: true, initial: 0 }),

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

      crew: new fields.NumberField({ required: false, integer: true, initial: 1, min: 0 }),
      biography: new fields.HTMLField({ required: false, initial: "" })
    };
  }

  /** Rótulo de energia atual (setting específica de Naves Espaciais). */
  get energyLabel() {
    return getStarshipEnergyLabel();
  }

  /** Módulos instalados (Items type "starship_module"). */
  get modules() {
    return this.parent.items.filter(i => i.type === "starship_module");
  }

  /**
   * Habilidades Especiais da Nave (Items type "skill"), sempre concedidas por
   * Módulos online — sem economia de pontos nem fusão, só exibição.
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

  prepareDerivedData() {
    this.hull.value = Math.clamp(this.hull.value, 0, this.hull.max);
    this.shields.value = Math.clamp(this.shields.value, 0, this.shields.max);
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
 * Veículo terrestre (carro, moto...): integridade, velocidade e combustível/bateria.
 * Não possui Grid de Energia completo — usa um único reservatório de combustível/energia.
 */
export class VehicleDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      integrity: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 })
      }),
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

  /** Peças/módulos instalados (Items type "item" ou "starship_module" reaproveitado como peça). */
  get parts() {
    return this.parent.items.filter(i => i.type === "item" || i.type === "starship_module");
  }

  prepareDerivedData() {
    this.integrity.value = Math.clamp(this.integrity.value, 0, this.integrity.max);
    this.fuel.value = Math.clamp(this.fuel.value, 0, this.fuel.max);
  }
}
