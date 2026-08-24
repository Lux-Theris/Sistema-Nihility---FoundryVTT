import { getEnergyLabel } from "../config.js";

const fields = foundry.data.fields;

/**
 * Schema base compartilhado entre Personagens (jogáveis) e Criaturas (NPCs/monstros).
 * Extraído em função para evitar duplicação entre as duas DataModels.
 */
function baseActorSchema() {
  return {
    attributes: new fields.SchemaField({
      hp: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 })
      }),
      energy: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
      }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      xp: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    }),

    /** Espécie ativa. Usada para aplicar automaticamente o preset de Partes do Corpo. */
    species: new fields.StringField({ required: true, initial: "humano", blank: false }),

    /** Guarda a última espécie para a qual um preset de anatomia já foi aplicado. */
    lastAppliedSpeciesPreset: new fields.StringField({ required: false, initial: "" }),

    /**
     * Saldo de moedas dinâmicas: { [currencyId]: quantidade }.
     * Sem schema fixo pois a lista de moedas é configurável em tempo de execução.
     */
    currencies: new fields.ObjectField({ required: true, initial: {} }),

    /** Id do Item (type "title") atualmente ativo/exibido, se o sistema de Títulos estiver ligado. */
    activeTitleId: new fields.StringField({ required: false, initial: "" }),

    biography: new fields.HTMLField({ required: false, initial: "" }),

    /** Usado como insumo para a geração de Unique/Ultimate Skills via IA. */
    personality: new fields.SchemaField({
      traits: new fields.StringField({ required: false, initial: "" }),
      desires: new fields.StringField({ required: false, initial: "" }),
      emotionalState: new fields.StringField({ required: false, initial: "" })
    })
  };
}

export class CharacterDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseActorSchema(),
      isPlayerCharacter: new fields.BooleanField({ required: true, initial: true })
    };
  }

  /** Rótulo de energia atual (respeita a Game Setting "energyLabel"). */
  get energyLabel() {
    return getEnergyLabel();
  }

  /** Partes do corpo pertencentes a este ator (Items embutidos do tipo body_part). */
  get bodyParts() {
    return this.parent.items.filter(i => i.type === "body_part");
  }

  /** Skills pertencentes a este ator, agrupadas por tier. */
  get skillsByTier() {
    const groups = {};
    for (const item of this.parent.items) {
      if (item.type !== "skill") continue;
      const tier = item.system.tier ?? "common";
      (groups[tier] ??= []).push(item);
    }
    return groups;
  }

  prepareDerivedData() {
    const hp = this.attributes.hp;
    hp.value = Math.clamp(hp.value, 0, hp.max);
    const en = this.attributes.energy;
    en.value = Math.clamp(en.value, 0, en.max);
  }
}

export class CreatureDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseActorSchema(),
      isPlayerCharacter: new fields.BooleanField({ required: true, initial: false }),
      challengeRating: new fields.NumberField({ required: false, initial: 1, min: 0 })
    };
  }

  get energyLabel() {
    return getEnergyLabel();
  }

  get bodyParts() {
    return this.parent.items.filter(i => i.type === "body_part");
  }

  prepareDerivedData() {
    const hp = this.attributes.hp;
    hp.value = Math.clamp(hp.value, 0, hp.max);
    const en = this.attributes.energy;
    en.value = Math.clamp(en.value, 0, en.max);
  }
}
