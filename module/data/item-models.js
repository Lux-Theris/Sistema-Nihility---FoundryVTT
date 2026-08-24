import { MEU_SISTEMA } from "../config.js";

const fields = foundry.data.fields;

/**
 * Schema reaproveitado por Item Geral, Modificação de Parte do Corpo e Módulo de
 * Nave: uma Habilidade opcional concedida enquanto equipado/instalado/online.
 * Tier travado em MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS (nunca Único/Ultimate —
 * essas só nascem de fusão/narrativa, nunca de um item). Presença = `name` não vazio.
 */
function grantedSkillSchema() {
  return new fields.SchemaField({
    name: new fields.StringField({ required: false, initial: "" }),
    description: new fields.HTMLField({ required: false, initial: "" }),
    cost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
    tier: new fields.StringField({
      required: true,
      initial: "normal",
      choices: MEU_SISTEMA.ITEM_GRANTABLE_SKILL_TIERS
    })
  });
}

/**
 * Modificador PERMANENTE de HP/Mana (não usa duração/Active Effect — soma direto
 * na fórmula sempre que a fonte estiver ativa: Skill possuída, Item equipado,
 * Modificação instalada). Reaproveitado por SkillDataModel, GenericItemDataModel
 * e cada entrada de installedMods do BodyPartDataModel.
 */
function statModifiersSchema() {
  return new fields.SchemaField({
    hp: new fields.NumberField({ required: true, integer: true, initial: 0 }),
    energy: new fields.NumberField({ required: true, integer: true, initial: 0 })
  });
}

/**
 * Bônus PERMANENTE em Atributos de Combate concedido por um Item equipado ou uma
 * Modificação instalada: [{ attribute, amount }]. Ao contrário do bônus de Título,
 * NUNCA entra no cálculo de HP/Mana Máximo (que usa só `points` do jogador + Título)
 * — soma apenas em `effectiveTotal`/rolagem, junto com buffs temporários de Skill.
 * Reaproveitado por GenericItemDataModel e cada entrada de installedMods do BodyPart.
 */
function attributeBonusesSchema() {
  return new fields.ArrayField(
    new fields.SchemaField({
      attribute: new fields.StringField({ required: true, choices: MEU_SISTEMA.COMBAT_ATTRIBUTES }),
      amount: new fields.NumberField({ required: true, integer: true, initial: 0 })
    }),
    { required: false, initial: [] }
  );
}

/**
 * Habilidade (Skill). Suporta Tiers, sub-skills dinâmicas e a linhagem de fusão
 * (quais skills foram consumidas para gerá-la), usada pelo AI Helper e pela
 * regra geral de consumo por tier (uma skill só funde fontes de tier ≤ o dela).
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
      isFused: new fields.BooleanField({ required: false, initial: false }),

      /**
       * true quando esta skill foi concedida automaticamente por um Item/Modificação/
       * Módulo (equipar/instalar/ligar). Nunca pode ser selecionada pra fusão, e some
       * sozinha quando a fonte é desequipada/removida/desligada.
       */
      isItemGranted: new fields.BooleanField({ required: false, initial: false }),

      /**
       * Texto livre e puramente narrativo: um item que a skill "precisa" pra funcionar
       * (ex: uma Skill Ultimate que transforma balas exige uma arma pra dispará-las).
       * Não é um vínculo mecânico — só um lembrete de RP.
       */
      requiredItem: new fields.StringField({ required: false, initial: "" }),

      /**
       * Mecânica ao "Usar" a skill — ver MEU_SISTEMA.SKILL_EFFECT_TYPES:
       * "none" (padrão, só descritiva), "damage" (rola damageFormula e posta no
       * chat público, com elemento opcional) ou "temporary" (aplica cada entrada
       * de `effects` — buffs/debuffs/drawbacks somam nos 7 Atributos ou em HP/Mana
       * via Active Effect com duração; "shield" é somado direto, sem duração).
       */
      effectType: new fields.StringField({
        required: true,
        initial: "none",
        choices: MEU_SISTEMA.SKILL_EFFECT_TYPES
      }),

      damageFormula: new fields.StringField({ required: false, initial: "" }),
      isElementalDamage: new fields.BooleanField({ required: false, initial: false }),
      damageElement: new fields.StringField({ required: false, initial: "" }),

      /** [{ target, amount, durationRounds }] — target em MEU_SISTEMA.EFFECT_TARGETS. */
      effects: new fields.ArrayField(
        new fields.SchemaField({
          target: new fields.StringField({ required: true, choices: MEU_SISTEMA.EFFECT_TARGETS }),
          amount: new fields.NumberField({ required: true, integer: true, initial: 1 }),
          durationRounds: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 })
        }),
        { required: false, initial: [] }
      ),

      /** Modificador PERMANENTE de HP/Mana, sempre ativo enquanto a skill estiver na ficha. */
      statModifiers: statModifiersSchema()
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

      /**
       * Modificações/próteses instaladas nesta parte: [{ name, description, grantsSkill }].
       * `grantsSkill` é opcional — quando preenchida e "concedida" (botão na ficha), gera
       * uma Skill de verdade na ficha do Ator, travada em tier Normal por padrão.
       */
      installedMods: new fields.ArrayField(
        new fields.SchemaField({
          name: new fields.StringField({ required: true, initial: "" }),
          description: new fields.HTMLField({ required: false, initial: "" }),
          grantsSkill: grantedSkillSchema(),
          skillGranted: new fields.BooleanField({ required: false, initial: false }),
          /** Modificador PERMANENTE de HP/Mana enquanto esta modificação estiver instalada. */
          statModifiers: statModifiersSchema(),
          /** Bônus PERMANENTE de Atributo (rolagem) enquanto esta modificação estiver instalada — nunca entra no HP/Mana. */
          attributeBonuses: attributeBonusesSchema()
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

      /** Bônus permanentes concedidos: [{ attribute, amount }], attribute em MEU_SISTEMA.TITLE_BONUS_TARGETS (os 7 atributos + hp/energy diretos). */
      bonuses: new fields.ArrayField(
        new fields.SchemaField({
          attribute: new fields.StringField({ required: true, choices: MEU_SISTEMA.TITLE_BONUS_TARGETS }),
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
      slot: new fields.StringField({ required: false, initial: "" }),

      /** Habilidade opcional concedida à Nave enquanto o módulo estiver "online" (ver grantedSkillSchema). */
      grantsSkill: grantedSkillSchema()
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
      }),

      /** Habilidade opcional concedida ao dono enquanto o item estiver "equipado" (ver grantedSkillSchema). */
      grantsSkill: grantedSkillSchema(),

      /** Modificador PERMANENTE de HP/Mana enquanto o item estiver "equipado". */
      statModifiers: statModifiersSchema(),

      /** Bônus PERMANENTE de Atributo (rolagem) enquanto o item estiver "equipado" — nunca entra no HP/Mana. */
      attributeBonuses: attributeBonusesSchema()
    };
  }
}
