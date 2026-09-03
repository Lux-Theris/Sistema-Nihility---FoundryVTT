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
 * Campos de uso compartilhados por `SkillDataModel` e `subSkillSchema()`, além da mecânica em
 * si (effectType/damageFormula/effects/etc.):
 *  - `hasUpkeep`/`upkeepCost`: cobrem uma Skill "Ativa". O `cost` (campo separado, já existente
 *    em cada schema) é gasto UMA VEZ ao ligar, e passa a drenar `upkeepCost` a CADA rodada (via
 *    `tickActorUpkeepSkills` em skill-effects.js, chamada do mesmo hook `updateCombat` que já
 *    tica Veneno/cura) até ser desativada de novo pelo botão "Usar" ou até a Energia zerar
 *    sozinha. `active` é estado de EXECUÇÃO, não configuração — nunca copiado ao clonar/fundir
 *    uma Skill (skill-snapshot.js), sempre nasce `false`.
 *  - `animationPath`: caminho opcional de vídeo/imagem/som tocado ao usar, via o módulo
 *    opcional Sequencer (ver module/vfx.js) — "" = sem animação, e sem o Sequencer instalado
 *    o campo simplesmente não faz nada (nunca quebra o uso da Skill).
 */
function usageFields() {
  return {
    hasUpkeep: new fields.BooleanField({ required: false, initial: false }),
    upkeepCost: new fields.NumberField({ required: false, integer: true, initial: 0, min: 0 }),
    active: new fields.BooleanField({ required: false, initial: false }),
    animationPath: new fields.StringField({ required: false, initial: "" })
  };
}

/**
 * Uma entrada de `effects[]` (Efeito Temporário de uma Skill/Sub-Skill) — reaproveitada por
 * `subSkillSchema()` e `SkillDataModel.effects`.
 *  - `conditionId`: "" = sem Condição nomeada (debuff/buff numérico genérico, como sempre foi).
 *    Qualquer outro valor = id de getActiveStatusConditions() (config.js) — dá nome/ícone
 *    reconhecível (ícone de status no token, via `ActiveEffect.statuses`) só pra flavor/UI;
 *    não bloqueia nenhuma ação sozinho (ver skill-effects.js).
 *  - `periodic`: quando true, `amount` é aplicado A CADA TICK (não uma vez só) — só faz
 *    sentido pra target "hp"/"energy" (veneno/cura contínua); `durationRounds` vira "quantos
 *    ticks restam" nesse caso, em vez de "quantos rounds até expirar".
 *  - `tickUnit`: só relevante quando `periodic`. "combatRound" tica sozinho a cada turno do
 *    Ator dono do efeito; "manual" espera um clique no botão "Aplicar Tick" da ficha (cobre
 *    cura/dano de longo prazo fora de combate).
 *  - `damageElements`: só relevante quando `periodic` E `amount` negativo (tick de dano, tipo
 *    Veneno) — 0+ ids de getActiveDamageElements(), usados só pra Resistência Elemental reduzir
 *    o tick (ver `tickPeriodicEffect` em skill-effects.js). Cura periódica (`amount` positivo)
 *    ignora esse campo e sempre aplica o valor cheio — não existe conceito de "resistir à
 *    própria cura" neste sistema. Diferente do dano "normal" (`rollSkillDamage`), um tick nunca
 *    passa por Defesa Mágica — só Resistência Geral/Elemental reduzem (decisão de balanceamento
 *    deliberada: Veneno Mágico ignora Defesa Mágica de propósito), por isso não existe um
 *    `isMagicDamage` aqui.
 *  Reaplicar a MESMA Condição (mesmo `conditionId`, não vazio) em quem já está afetado por ela
 *  NÃO cria um segundo Active Effect — soma `durationRounds`/ticks restantes no existente (ver
 *  `applyEffectsToActor` em skill-effects.js).
 */
function effectEntrySchema() {
  return new fields.SchemaField({
    target: new fields.StringField({ required: true, choices: MEU_SISTEMA.EFFECT_TARGETS }),
    amount: new fields.NumberField({ required: true, integer: true, initial: 1 }),
    /**
     * Só relevante pros EFFECT_TARGETS "de Nave" (MEU_SISTEMA.SHIP_EFFECT_TARGETS): "flat" soma
     * `amount` direto no resultado (ADD); "multiplier" multiplica (MULTIPLY) — `amount` nesse
     * caso é lido como percentual (ex: 20 = ×1.20), ver `applyEffectsToActor` em skill-effects.js.
     */
    modifierType: new fields.StringField({
      required: false,
      initial: "flat",
      blank: true,
      choices: MEU_SISTEMA.EFFECT_MODIFIER_TYPES
    }),
    durationRounds: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
    conditionId: new fields.StringField({ required: false, initial: "", blank: true }),
    periodic: new fields.BooleanField({ required: false, initial: false }),
    tickUnit: new fields.StringField({
      required: false,
      initial: "combatRound",
      blank: true,
      choices: MEU_SISTEMA.PERIODIC_TICK_UNITS
    }),
    damageElements: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] })
  });
}

/**
 * Snapshot mecânico completo de UM componente consumido numa Fusão — os mesmos campos de
 * mecânica que uma Skill de verdade tem (Tier/Nível/Custo/Descrição/Resistência/Mecânica ao
 * Usar/Dano/Efeitos/Alcance), só que congelados no momento da Fusão: editar a Sub-Skill aqui
 * não muda a Skill original (se ainda existir em algum Compêndio) nem vice-versa. "Usar
 * Habilidade" numa Skill com Sub-Skills deixa escolher qual componente disparar — cada um
 * rola/aplica com os próprios campos daqui (ver `useSkillEffect` em skill-effects.js), igual
 * as Skills Únicas do Tensura, que têm várias sub-habilidades nomeadas dentro de uma só Skill
 * "guarda-chuva". Nunca aninha: se um componente já era ele mesmo uma Fusão, os Sub-Skills
 * DELE entram achatados aqui direto (ver `buildGenericFusionData` em skill-economy.js) — a lista
 * final é sempre plana, nunca uma árvore.
 */
function subSkillSchema() {
  return new fields.SchemaField({
    name: new fields.StringField({ required: true, initial: "" }),
    tier: new fields.StringField({ required: false, initial: "normal", choices: MEU_SISTEMA.SKILL_TIERS }),
    level: new fields.NumberField({ required: false, integer: true, initial: 1, min: 1 }),
    cost: new fields.NumberField({ required: false, integer: true, initial: 0, min: 0 }),
    ...usageFields(),
    description: new fields.HTMLField({ required: false, initial: "" }),
    resistanceTarget: new fields.StringField({ required: false, initial: "" }),
    effectType: new fields.StringField({ required: false, initial: "none", choices: MEU_SISTEMA.SKILL_EFFECT_TYPES }),
    damageFormula: new fields.StringField({ required: false, initial: "" }),
    isMagicDamage: new fields.BooleanField({ required: false, initial: false }),
    damageElements: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),
    effects: new fields.ArrayField(effectEntrySchema(), { required: false, initial: [] }),
    targetType: new fields.StringField({ required: false, initial: "targeted", choices: ["targeted", "emission"] }),
    // `blank: true` é obrigatório aqui: um StringField com `choices` some com o `blank: true`
    // implícito que todo StringField normal tem — sem isso, o próprio "" inicial falha a
    // validação ("may not be a blank string") assim que o campo não é setado explicitamente.
    areaShape: new fields.StringField({ required: false, initial: "", blank: true, choices: ["", "circle", "cone", "ray"] }),
    areaDistance: new fields.NumberField({ required: false, integer: true, initial: 0, min: 0 }),
    areaAngle: new fields.NumberField({ required: false, integer: true, initial: 53, min: 1, max: 360 })
  });
}

/**
 * Habilidade (Skill). Suporta Tiers, Sub-Skills (só existem em Skills Fundidas — snapshot dos
 * componentes consumidos, ver `subSkillSchema`) e a linhagem de fusão (só os NOMES, pra
 * auditoria/exibição — quem quiser o efeito de um componente usa o snapshot em `subSkills`,
 * não `fusionSources`), usada pelo AI Helper e pela regra geral de consumo por tier (uma
 * skill só funde fontes de tier ≤ o dela).
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
      /** Custo de Energia pra "Usar" a skill (não confundir com o Ponto de Habilidade gasto pra criá-la — esse é fixo em 1, ver skill-economy.js). */
      cost: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      ...usageFields(),
      description: new fields.HTMLField({ required: false, initial: "" }),

      /** Sub-Skills — só existem em Skills Fundidas, ver `subSkillSchema()` acima. */
      subSkills: new fields.ArrayField(subSkillSchema(), { required: false, initial: [] }),

      /** Nomes/uuids das skills consumidas em uma fusão (linhagem), para auditoria e regras de consumo. */
      fusionSources: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),

      /**
       * Nome da Skill que esta substituiu ao Evoluir — diferente de Fusão (2+ fontes viram
       * Sub-Skills usáveis dentro do resultado), Evolução é 1-pra-1: a Skill antiga não
       * sobrevive como componente algum, só fica esse registro histórico. "" = nunca evoluiu.
       */
      evolvedFrom: new fields.StringField({ required: false, initial: "" }),

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
       * chat público, com elemento(s) opcional(is)) ou "temporary" (aplica cada
       * entrada de `effects` — buffs/debuffs/drawbacks somam nos 7 Atributos ou em
       * HP/Mana via Active Effect com duração; "shield" é somado direto, sem duração).
       */
      effectType: new fields.StringField({
        required: true,
        initial: "none",
        choices: MEU_SISTEMA.SKILL_EFFECT_TYPES
      }),

      damageFormula: new fields.StringField({ required: false, initial: "" }),

      /**
       * Independente dos elementos abaixo: só essa flag decide se o dano é reduzido pela
       * Defesa Mágica do alvo (ver `rollSkillDamage` em skill-effects.js). Uma skill pode ser
       * mágica sem elemento (ex: força arcana pura), elemental sem ser mágica (ex: espada em
       * chamas — dano físico com flavor de fogo, não reduzido), ou os dois ao mesmo tempo.
       */
      isMagicDamage: new fields.BooleanField({ required: false, initial: false }),

      /** 0+ ids de MEU_SISTEMA/getActiveDamageElements() — só flavor no chat (pode ter vários ao mesmo tempo). */
      damageElements: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),

      /** [{ target, amount, durationRounds, conditionId, periodic, tickUnit }] — ver effectEntrySchema() acima. */
      effects: new fields.ArrayField(effectEntrySchema(), { required: false, initial: [] }),

      /**
       * "targeted" (padrão — pede 1 Ator via dropdown, como sempre foi) ou "emission" (sem
       * alvo manual — o usuário posiciona uma forma no canvas e a Skill afeta quem estiver
       * dentro dela, ver module/area-effects.js).
       */
      targetType: new fields.StringField({
        required: true,
        initial: "targeted",
        choices: ["targeted", "emission"]
      }),

      /** Só relevante quando targetType === "emission". "" = ainda não configurada. */
      // `blank: true` é obrigatório aqui: um StringField com `choices` some com o `blank: true`
    // implícito que todo StringField normal tem — sem isso, o próprio "" inicial falha a
    // validação ("may not be a blank string") assim que o campo não é setado explicitamente.
    areaShape: new fields.StringField({ required: false, initial: "", blank: true, choices: ["", "circle", "cone", "ray"] }),

      /** Raio (circle) ou distância (cone/ray), na unidade de grid da cena. */
      areaDistance: new fields.NumberField({ required: false, integer: true, initial: 0, min: 0 }),

      /** Só relevante pra areaShape "cone" — ângulo em graus. */
      areaAngle: new fields.NumberField({ required: false, integer: true, initial: 53, min: 1, max: 360 }),

      /** Modificador PERMANENTE de HP/Mana, sempre ativo enquanto a skill estiver na ficha. */
      statModifiers: statModifiersSchema(),

      /**
       * "" = não é Skill de Resistência (a maioria das skills). "general" = reduz qualquer
       * dano recebido. Qualquer outro valor = um id de getActiveDamageElements() (já inclui
       * "physical" — cortes/contusões/etc.) = resistência só a esse elemento específico.
       * Sem `choices` fixo porque a lista de elementos é configurável em runtime pela setting
       * `damageElementsData`, não dá pra travar em tempo de definição de schema.
       * Progressão: 10%/nível (ver `computeResistancePercent` em skill-effects.js). Resistência
       * Geral tem teto no nível 5 (50%, nunca vira Imunidade — seria OP demais); Resistência a
       * um Elemento específico tem teto no nível 10 (100% = Imunidade, e o nome muda sozinho).
       */
      resistanceTarget: new fields.StringField({ required: false, initial: "" })
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
      ),

      /**
       * Resistência a dano concedida permanentemente pelo Título: [{ target, amount }].
       * `target` = "general" (reduz qualquer dano) ou um id de getActiveDamageElements().
       * `amount` é um percentual fixo (0-100) digitado pelo Mestre — Títulos não têm nível,
       * então não seguem a progressão por nível das Skills de Resistência; soma com a
       * Resistência de Skill que o Ator já tiver pro mesmo alvo (ver skill-effects.js).
       */
      resistances: new fields.ArrayField(
        new fields.SchemaField({
          target: new fields.StringField({ required: true, initial: "general" }),
          amount: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 100 })
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
        choices: MEU_SISTEMA.STARSHIP_MODULE_CATEGORIES
      }),
      description: new fields.HTMLField({ required: false, initial: "" }),
      powerConsumption: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      status: new fields.StringField({
        required: true,
        initial: "online",
        choices: ["online", "offline", "damaged"]
      }),
      slot: new fields.StringField({ required: false, initial: "" }),

      /**
       * Porte do Módulo (Compacto..Colossal, ver MEU_SISTEMA.MODULE_SIZES) — Arma reaproveita
       * este MESMO campo pro seu próprio Porte, não é uma escala separada. Checado contra o
       * Porte da Nave/Veículo (MEU_SISTEMA.SHIP_SIZE_RANK) na instalação: um Módulo maior que
       * o Porte do casco não cabe.
       */
      moduleSize: new fields.StringField({
        required: true,
        initial: "standard",
        choices: MEU_SISTEMA.MODULE_SIZES
      }),

      /**
       * Vida estrutural do Módulo em si — todo Módulo tem (não só Casco). Alvo do dano por
       * sobrecarga (Porte overhaul, Fase 3) e do ajuste manual do Mestre (Fase 6); ao chegar a
       * 0 o Módulo desliga sozinho e só religa depois de reparado a 15%+ do máximo.
       */
      hp: new fields.SchemaField({
        value: new fields.NumberField({ required: true, integer: true, initial: 20, min: 0 }),
        max: new fields.NumberField({ required: true, integer: true, initial: 20, min: 0 })
      }),

      /**
       * Só relevante pra category "armor" (Casco) — percentual fixo de redução de dano
       * recebido pela Nave, igual Resistência a Dano de Título/Skill de Personagem, mas
       * comprado/trocado como Módulo (mais fácil de reequipar num estaleiro do que
       * "comprar" resistência via Skill). Slot único: ver ShipSystemsDataModel.armorModule.
       */
      armorReduction: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 100 }),

      /**
       * Throttle de energia do Módulo (Overhaul de Naves, Fase 3) — sem teto de propósito.
       * Escala linearmente o consumo (Demanda Total do Distribuidor, ver `totalConsumption` em
       * starship-model.js) e as capacidades da categoria (Vida/Regen de Escudo, Aceleração/
       * Rotação de Motor, Fator de Dobra de FTL — `effectiveModuleStat` no mesmo arquivo; Dano/
       * Penetração/Recarga de Arma entram na Fase 5). Reator reaproveita o MESMO campo como seu
       * próprio clock, mas com limiar de sobrecarga diferente (ver
       * MEU_SISTEMA.OVERLOAD_THRESHOLD_REACTOR); Distribuidor/Bateria não usam este campo.
       */
      powerAllocationPercent: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),

      /**
       * Prioridade de energia do Distribuidor (menor = atendido primeiro) — só importa quando a
       * Demanda Total da Nave/Veículo passa da Capacidade de Transferência e nem a Reserva da
       * Bateria cobre o déficit (ver `powerShortfall` em starship-model.js). Editável, sem
       * tabela fixa por categoria: quem decide a ordem é o jogador/Mestre.
       */
      powerPriority: new fields.NumberField({ required: true, integer: true, initial: 50, min: 0 }),

      /**
       * Só relevante pra category "shield" — Vida Máxima e Regen do Escudo a 100% de throttle,
       * mais quantas rodadas o Escudo fica em Recarga (0% de proteção) depois de zerar, antes
       * de religar e voltar a regenerar (ver `shields.rechargeRemaining` em starship-model.js).
       */
      shieldCapacity: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      shieldRegen: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      shieldRechargeRounds: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /** Só relevante pra category "engine" — Aceleração/Rotação a 100% de throttle. */
      acceleration: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      rotation: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /** Só relevante pra category "reactor" — Output a 100% de clock (antes do throttle acima). */
      reactorOutput: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /**
       * Só relevante pra category "distributor" — multiplicador aplicado ao baseline de Porte
       * pra achar a Capacidade de Transferência (ver `transferCapacity` em starship-model.js).
       */
      transferFactor: new fields.NumberField({ required: true, initial: 1, min: 0 }),

      /**
       * Só relevante pra category "ftl". Sub-tipo Dobra ("warp", padrão): propulsão contínua,
       * usa `warpFactor`. Sub-tipo Salto ("jump", raro): usa `jumpRange` + `chargeTime`/
       * `chargeRemaining` (mesmo padrão de cooldownRounds/cooldownRemaining de Arma, Fase 5,
       * decrementado por rodada). Os dois sub-tipos competem pelo MESMO slot único — nunca os
       * dois instalados ao mesmo tempo.
       */
      ftlType: new fields.StringField({ required: true, initial: "warp", choices: ["warp", "jump"] }),
      warpFactor: new fields.NumberField({ required: true, initial: 1, min: 0 }),
      jumpRange: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      chargeTime: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      chargeRemaining: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /**
       * Só relevante pra category "weapon" (Overhaul de Naves, Fase 5) — dano/penetração/recarga
       * NA PRÓPRIA Módulo, disparado pela action `fireWeapon` (ver `fireStarshipWeapon` em
       * skill-effects.js), independente de qualquer Habilidade que ela conceda. `penetration` é
       * 0-100 (%), igual `armorReduction`. `cooldownRounds` 0 = sempre disponível pra disparar;
       * `cooldownRemaining` é estado (setado ao disparar, decrementado por rodada em
       * starship-power.js), não editável à mão aqui — só pelo popover do Mestre (Fase 6).
       * Arma usa o MESMO `powerAllocationPercent` genérico, mas com regra própria: throttle
       * acima de 100% NÃO dana o Módulo (diferente da regra geral de sobrecarga) — em vez disso
       * escala `damageFormula`/`penetration` pra cima E escala `cooldownRounds` na mesma
       * proporção (arredondado pra cima, mínimo 1): sobrecarregar bate mais forte/penetra mais,
       * mas demora mais pra disparar de novo.
       */
      damageFormula: new fields.StringField({ required: false, initial: "" }),
      penetration: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 100 }),
      cooldownRounds: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
      cooldownRemaining: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

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
