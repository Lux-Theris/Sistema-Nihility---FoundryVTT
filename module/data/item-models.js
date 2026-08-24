import { MEU_SISTEMA } from "../config.js";

const fields = foundry.data.fields;

/**
 * Habilidade (Skill). Suporta Tiers, sub-skills dinâmicas e a linhagem de fusão
 * (quais skills foram consumidas para gerá-la), usada pelo AI Helper e pela
 * regra de "Únicas não devoram Ultimates".
 */
export class SkillDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      tier: new fields.StringField({
        required: true,
        initial: "normal",
        choices: MEU_SISTEMA.SKILL_TIERS
      }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1, min: 1 }),
      cost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      description: new fields.HTMLField({ required: false, initial: "" }),

      /** Lista dinâmica de Sub-Skills: [{ name, description }] */
      subSkills: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, initial: "" }),
          description: new fields.HTMLField({ required: false, initial: "" })
        }),
        { required: false, initial: [] }
      ),

      /** Nomes/uuids das skills consumidas em uma fusão (linhagem), para auditoria e regras de consumo. */
      fusionSources: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),

      /** Gatilho emocional que originou uma Skill Única (preenchido manual ou via IA). */
      emotionTrigger: new fields.StringField({ required: false, initial: "" }),

      /** Marca se esta skill foi produzida por fusão (vs. concedida manualmente). */
      isFused: new fields.BooleanField({ required: false, initial: false })
    };
  }
}

/**
 * Parte do Corpo. HP próprio, estado de dano e slot de modificações/próteses instaladas.
 */
export class BodyPartDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      slot: new fields.StringField({ required: true, initial: "torso" }),
      speciesOrigin: new fields.StringField({ required: false, initial: "" }),
      hp: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 })
      }),
      status: new fields.StringField({
        required: true,
        initial: "intact",
        choices: MEU_SISTEMA.BODY_PART_STATUS
      }),
      isProsthetic: new fields.BooleanField({ required: false, initial: false }),

      /** Modificações/próteses instaladas nesta parte: [{ name, description }] */
      installedMods: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, initial: "" }),
          description: new fields.HTMLField({ required: false, initial: "" })
        }),
        { required: false, initial: [] }
      )
    };
  }

  prepareDerivedData() {
    this.hp.value = Math.clamp(this.hp.value, 0, this.hp.max);
    if (this.hp.value <= 0) this.status = "destroyed";
    else if (this.hp.value < this.hp.max) this.status = "damaged";
    else this.status = "intact";
  }
}

/**
 * Título concedido a um personagem. Não existe "título ativo": todo Título que o
 * Ator possuir aplica seus bônus permanentemente (somados nos atributos de combate).
 */
export class TitleDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, initial: "" }),
      grantedBy: new fields.StringField({ required: false, initial: "" }),
      rarity: new fields.StringField({ required: false, initial: "comum" }),

      /** Bônus permanentes concedidos: [{ attribute, amount }], attribute em MEU_SISTEMA.COMBAT_ATTRIBUTES. */
      bonuses: new fields.ArrayField(
        new fields.SchemaField({
          attribute: new fields.StringField({ required: true, choices: MEU_SISTEMA.COMBAT_ATTRIBUTES }),
          amount: new fields.NumberField({ required: true, integer: true, initial: 0 })
        }),
        { required: false, initial: [] }
      )
    };
  }
}

/** Módulo instalável em uma Nave Espacial (arma, escudo, motor, utilidade...). */
export class StarshipModuleDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      category: new fields.StringField({
        required: true,
        initial: "utility",
        choices: ["weapon", "shield", "engine", "utility"]
      }),
      description: new fields.HTMLField({ required: false, initial: "" }),
      powerConsumption: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      status: new fields.StringField({
        required: true,
        initial: "online",
        choices: ["online", "offline", "damaged"]
      }),
      slot: new fields.StringField({ required: false, initial: "" })
    };
  }
}

/** Item genérico (equipamento, consumível, tesouro...). */
export class GenericItemDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: false, initial: "" }),
      quantity: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      weight: new fields.NumberField({ required: true, initial: 0, min: 0 }),
      equipped: new fields.BooleanField({ required: false, initial: false }),
      value: new fields.SchemaField({
        amount: new fields.NumberField({ required: true, initial: 0, min: 0 }),
        currency: new fields.StringField({ required: false, initial: "gold" })
      })
    };
  }
}
