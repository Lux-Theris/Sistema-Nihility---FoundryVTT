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
      points: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      /** Alvo de Active Effects de Skills "temporary" (buff/debuff). NUNCA conta pra HP/Mana. */
      buffDelta: new fields.NumberField({ required: true, integer: true, initial: 0 })
    });
  }

  return {
    attributes: new fields.SchemaField({
      hp: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 10, min: 0 }),
        /** Alvo de Active Effects de Skills "temporary" que afetam HP diretamente. */
        buffDelta: new fields.NumberField({ required: true, integer: true, initial: 0 })
      }),
      energy: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        buffDelta: new fields.NumberField({ required: true, integer: true, initial: 0 })
      }),
      /**
       * Escudo: HP extra temporário concedido por Skills. Diferente de HP/Mana,
       * NÃO usa Active Effect/duração — é somado direto e gasto na mão pelo
       * jogador conforme absorve dano (mesma lógica manual do resto do combate).
       */
      shield: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 })
      }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      xp: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /**
       * Atributos de combate: `points` é editável (pontos investidos na criação/level-up).
       * `total` (points + bônus permanentes de Títulos) é o que entra na fórmula de HP/Mana.
       * `effectiveTotal` (total + buffDelta temporário) e `bonus` (floor(effectiveTotal/3))
       * são o que entra nas rolagens — buffs temporários mudam a rolagem, nunca o HP/Mana.
       * Tudo calculado em prepareDerivedData() — não faz parte do schema salvo.
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

/** Soma os bônus permanentes de Títulos (sempre ativos) para um alvo (atributo, "hp" ou "energy"). */
function sumTitleBonuses(actor, target) {
  let sum = 0;
  for (const item of actor.items) {
    if (item.type !== "title") continue;
    for (const entry of item.system.bonuses ?? []) {
      if (entry.attribute === target) sum += Number(entry.amount) || 0;
    }
  }
  return sum;
}

/**
 * Soma bônus PERMANENTES de Atributo concedidos por Itens equipados e Modificações
 * instaladas (attributeBonuses). Ao contrário do bônus de Título, isso NUNCA entra
 * em `attr.total` (a base que alimenta HP/Mana) — só em `effectiveTotal`, junto com
 * buffDelta, ou seja, afeta a rolagem mas nunca o HP/Mana Máximo.
 */
function sumItemAttributeBonus(actor, key) {
  let sum = 0;
  for (const item of actor.items) {
    if (item.type === "item" && item.system.equipped) {
      for (const entry of item.system.attributeBonuses ?? []) {
        if (entry.attribute === key) sum += Number(entry.amount) || 0;
      }
    } else if (item.type === "body_part") {
      for (const mod of item.system.installedMods ?? []) {
        for (const entry of mod.attributeBonuses ?? []) {
          if (entry.attribute === key) sum += Number(entry.amount) || 0;
        }
      }
    }
  }
  return sum;
}

/**
 * Soma modificadores PERMANENTES de HP/Mana (não os temporários de buff): Títulos,
 * Skills (statModifiers, sempre ativo enquanto possuída), Item Geral (statModifiers,
 * só enquanto equipado) e Modificações de Parte do Corpo (statModifiers, sempre
 * ativo enquanto instalada).
 * @param {Actor} actor
 * @param {"hp"|"energy"} stat
 */
function sumPermanentStatModifier(actor, stat) {
  let sum = sumTitleBonuses(actor, stat);
  for (const item of actor.items) {
    if (item.type === "skill") {
      sum += Number(item.system.statModifiers?.[stat]) || 0;
    } else if (item.type === "item" && item.system.equipped) {
      sum += Number(item.system.statModifiers?.[stat]) || 0;
    } else if (item.type === "body_part") {
      for (const mod of item.system.installedMods ?? []) {
        sum += Number(mod.statModifiers?.[stat]) || 0;
      }
    }
  }
  return sum;
}

/**
 * Calcula `total`/`effectiveTotal`/`bonus` de cada atributo de combate. `total`
 * (pontos + Título) é a base permanente usada pra fórmula de HP/Mana — Itens
 * equipados/Modificações instaladas NUNCA entram aqui, só Título conta como bônus
 * permanente "de verdade". `effectiveTotal` soma por cima só `buffDelta` (Active
 * Effects temporários de Skill) e vira `bonus`, que decide o Pool de d20 (ver
 * dice.js: a cada +10 de Bônus, +1d20). `itemBonus` (Itens equipados/Modificações)
 * fica DE FORA tanto do HP/Mana quanto do Pool de dados — some por fora, na hora
 * da rolagem, como número fixo (ver `rollAttribute`/`extraFlat` em dice.js).
 */
function deriveCombatAttributes(dataModel) {
  const combat = dataModel.attributes.combat;
  let spent = 0;
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    const attr = combat[key];
    const titleBonus = sumTitleBonuses(dataModel.parent, key);
    attr.total = attr.points + titleBonus;
    attr.itemBonus = sumItemAttributeBonus(dataModel.parent, key);
    attr.effectiveTotal = attr.total + (attr.buffDelta || 0);
    attr.bonus = Math.floor(attr.effectiveTotal / 3);
    spent += attr.points;
  }

  // Pool informativo (não bloqueia edição): quanto o Mestre concede vs. quanto já foi
  // investido nos 7 atributos. Título não conta como "gasto" (é bônus, não escolha do jogador).
  const level = dataModel.attributes.level;
  const total = getAttributePointsStarting() + Math.max(0, level - 1) * getAttributePointsPerLevel();
  dataModel.attributePointsPool = { total, spent, remaining: total - spent };
}

/**
 * HP Máximo = Força.Total × Defesa.Total × 10; Mana Máxima = Magia.Total × Defesa
 * Mágica.Total × 10 — usando só a base PERMANENTE dos atributos (buffs temporários
 * de atributo nunca entram aqui). Modificadores permanentes (Título/Skill/Item/
 * Modificação) e o buffDelta temporário de HP/Mana somam por cima do resultado.
 * Precisa rodar DEPOIS de deriveCombatAttributes (usa combat.X.total já calculado).
 */
function deriveVitalStats(dataModel) {
  const actor = dataModel.parent;
  const combat = dataModel.attributes.combat;
  const hp = dataModel.attributes.hp;
  const energy = dataModel.attributes.energy;

  const baseHpMax = Math.round(combat.strength.total * combat.defense.total * 10);
  const baseEnergyMax = Math.round(combat.magic.total * combat.magicalDefense.total * 10);

  hp.max = Math.max(1, baseHpMax + sumPermanentStatModifier(actor, "hp") + (hp.buffDelta || 0));
  energy.max = Math.max(0, baseEnergyMax + sumPermanentStatModifier(actor, "energy") + (energy.buffDelta || 0));

  hp.value = Math.clamp(hp.value, 0, hp.max);
  energy.value = Math.clamp(energy.value, 0, energy.max);
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
    deriveCombatAttributes(this);
    deriveVitalStats(this);
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
    deriveCombatAttributes(this);
    deriveVitalStats(this);
  }
}
