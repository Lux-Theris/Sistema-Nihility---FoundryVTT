import {
  getCharacterEnergyLabel,
  MEU_SISTEMA,
  getAttributePointsStarting,
  getAttributePointsPerLevel
} from "../config.js";

const fields = foundry.data.fields;

/**
 * Schema base compartilhado entre Personagens (jogáveis) e Criaturas (NPCs/monstros).
 * Extraído em função para evitar duplicação entre as duas DataModels.
 */
function baseActorSchema() {
  const combatAttributeFields = {};
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    combatAttributeFields[key] = new fields.SchemaField({
      points: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    });
  }

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
      xp: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /**
       * Atributos de combate: `points` é editável (pontos investidos na criação/level-up).
       * `total` (points + bônus permanentes de Títulos) e `bonus` (floor(total/3)) são
       * calculados em prepareDerivedData() — não fazem parte do schema salvo.
       */
      combat: new fields.SchemaField(combatAttributeFields)
    }),

    /**
     * Pontos de Habilidade disponíveis para criar novas skills (com aprovação do Mestre).
     * Racial e Ultimate ficam de fora dessa economia de propósito (ver SKILL_POINT_TIERS).
     */
    skillPoints: new fields.SchemaField({
      extra: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      normal: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      unique: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
    }),

    /** Espécie ativa. Usada para aplicar automaticamente o preset de Partes do Corpo e Skills Raciais. */
    species: new fields.StringField({ required: true, initial: "humano", blank: false }),

    /** Guarda a última espécie para a qual um preset de anatomia já foi aplicado. */
    lastAppliedSpeciesPreset: new fields.StringField({ required: false, initial: "" }),

    /**
     * Saldo de moedas dinâmicas: { [currencyId]: quantidade }.
     * Sem schema fixo pois a lista de moedas é configurável em tempo de execução.
     */
    currencies: new fields.ObjectField({ required: true, initial: {} }),

    biography: new fields.HTMLField({ required: false, initial: "" }),

    /** Usado como insumo para a geração de Unique/Ultimate Skills via IA. */
    personality: new fields.SchemaField({
      traits: new fields.StringField({ required: false, initial: "" }),
      desires: new fields.StringField({ required: false, initial: "" }),
      emotionalState: new fields.StringField({ required: false, initial: "" })
    })
  };
}

/** Soma os bônus permanentes de Títulos (sempre ativos) para um atributo específico. */
function sumTitleBonuses(actor, attributeKey) {
  let sum = 0;
  for (const item of actor.items) {
    if (item.type !== "title") continue;
    for (const entry of item.system.bonuses ?? []) {
      if (entry.attribute === attributeKey) sum += Number(entry.amount) || 0;
    }
  }
  return sum;
}

/** Calcula `total`/`bonus` de cada atributo de combate a partir dos pontos investidos + Títulos. */
function deriveCombatAttributes(dataModel) {
  const combat = dataModel.attributes.combat;
  let spent = 0;
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    const attr = combat[key];
    const titleBonus = sumTitleBonuses(dataModel.parent, key);
    attr.total = attr.points + titleBonus;
    attr.bonus = Math.floor(attr.total / 3);
    spent += attr.points;
  }

  // Pool informativo (não bloqueia edição): quanto o Mestre concede vs. quanto já foi
  // investido nos 7 atributos. Título não conta como "gasto" (é bônus, não escolha do jogador).
  const level = dataModel.attributes.level;
  const total = getAttributePointsStarting() + Math.max(0, level - 1) * getAttributePointsPerLevel();
  dataModel.attributePointsPool = { total, spent, remaining: total - spent };
}

export class CharacterDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...baseActorSchema(),
      isPlayerCharacter: new fields.BooleanField({ required: true, initial: true })
    };
  }

  /** Rótulo de energia atual (setting específica de Personagens/Criaturas). */
  get energyLabel() {
    return getCharacterEnergyLabel();
  }

  /** Partes do corpo pertencentes a este ator (Items embutidos do tipo body_part). */
  get bodyParts() {
    return this.parent.items.filter(i => i.type === "body_part");
  }

  /** Títulos pertencentes a este ator — todos sempre aplicam seu efeito (não existe "título ativo"). */
  get titles() {
    return this.parent.items.filter(i => i.type === "title");
  }

  /** Skills pertencentes a este ator, agrupadas por tier. */
  get skillsByTier() {
    const groups = {};
    for (const item of this.parent.items) {
      if (item.type !== "skill") continue;
      const tier = item.system.tier ?? "normal";
      (groups[tier] ??= []).push(item);
    }
    return groups;
  }

  /** true se o Ator já possuir alguma Skill tier "ultimate" — controla se a UI pode mencionar Ultimate. */
  get hasUltimateSkill() {
    return this.parent.items.some(i => i.type === "skill" && i.system.tier === "ultimate");
  }

  prepareDerivedData() {
    const hp = this.attributes.hp;
    hp.value = Math.clamp(hp.value, 0, hp.max);
    const en = this.attributes.energy;
    en.value = Math.clamp(en.value, 0, en.max);
    deriveCombatAttributes(this);
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
    return getCharacterEnergyLabel();
  }

  get bodyParts() {
    return this.parent.items.filter(i => i.type === "body_part");
  }

  get titles() {
    return this.parent.items.filter(i => i.type === "title");
  }

  get hasUltimateSkill() {
    return this.parent.items.some(i => i.type === "skill" && i.system.tier === "ultimate");
  }

  prepareDerivedData() {
    const hp = this.attributes.hp;
    hp.value = Math.clamp(hp.value, 0, hp.max);
    const en = this.attributes.energy;
    en.value = Math.clamp(en.value, 0, en.max);
    deriveCombatAttributes(this);
  }
}
