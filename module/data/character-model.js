import {
  getCharacterEnergyLabel,
  MEU_SISTEMA,
  getAttributePointsStarting,
  getAttributePointsPerLevel,
  getVitalFormula,
  getXpForNextLevel,
  movementAllowance,
  getMovementConfig,
  speciesCarry,
  inventoryLoad,
  currencyWeight,
  carryCapacity,
  encumbrancePenalty,
  getActiveSpeciesPresets,
  getActiveCurrencies,
  getFeatureOption,
  getActiveBodyFunctions,
  isBodyInjuryEnabled,
  isInventoryEnabled,
  isEncumbranceEnabled
} from "../core/config.js";
import { collectConditionalModifiers, buildModifierContext } from "../combat/conditional-context.js";
import { actorOriginLayers } from "../species/origin.js";
import { bodyFunctionState, injuredMovement, legacyFunctionsFor, resolvePartVitals } from "../species/anatomy-rules.js";
import { originAttributeRows, originStatRows, originMovement, originScale } from "../species/species-rules.js";
import { sumConditionalModifiers } from "../combat/conditional-modifiers.js";
import { sourceSuppressed, suppressionLevel } from "../core/suppression.js";

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
      /**
       * Pontos alocados nesta sessão de edição mas ainda NÃO confirmados — mostrados como
       * prévia (ficha) mas NUNCA somados em `total`/`bonus`/HP/Mana até "Confirmar" mover isso
       * pra `points` de verdade (ver actor-sheet.js: incrementAttributePoint/confirmAttributePoints).
       * "Resetar" só zera isso — nunca mexe em `points` já confirmado.
       */
      pendingPoints: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
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
        value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
        /**
         * Pools: cada Skill que deu Escudo tem o seu, com Vida própria. `value` acima é o TOTAL (o
         * que a ficha mostra); o que passar da soma dos pools é o "avulso" (Escudo digitado à mão,
         * ou de antes dos pools). O golpe gasta do mais recente (`order` maior) pro mais antigo, e
         * o avulso por último — ver consumeShieldPools em damage-rules.js.
         */
        pools: new fields.ArrayField(
          new fields.SchemaField({
            id: new fields.StringField({ required: true, initial: "" }),
            label: new fields.StringField({ required: false, initial: "" }),
            value: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),
            order: new fields.NumberField({ required: false, initial: 0 }),
            holderUuid: new fields.StringField({ required: false, initial: "" }),
            skillId: new fields.StringField({ required: false, initial: "" }),
            subSkillIndex: new fields.NumberField({ required: false, nullable: true, initial: null, integer: true }),
            elements: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] })
          }),
          { required: false, initial: [] }
        )
      }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1, min: 0 }),
      /**
       * XP acumulado rumo ao próximo nível. É SEMPRE limitado ao teto do nível atual
       * (`getXpForNextLevel`, ver deriveExperience) — nunca acumula excedente: um personagem que
       * bate o teto para de ganhar XP até o Mestre subir o nível dele. Sem esse limite, quem
       * farmasse XP chegaria ao nível seguinte já com vários níveis "pagos" adiantados.
       */
      xp: new fields.NumberField({ required: true, integer: true, initial: 0, min: 0 }),

      /**
       * Soma dos efeitos temporários sobre o Deslocamento, em % (Lentidão −50). Mesmo papel do
       * `buffDelta` dos atributos: só Active Effect escreve aqui. Ver `movementAllowance`.
       */
      movementPercent: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /**
       * Pontos de Atributo extras concedidos pelo Mestre a este personagem, somados ao orçamento
       * do nível (`attributePointsPool.total`). Só o Mestre edita (ver a ficha); pode ser negativo
       * para retirar pontos.
       */
      bonusAttributePoints: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /** Slots e carga (kg) extras dados pelo Mestre a este personagem (podem ser negativos). */
      bonusSlots: new fields.NumberField({ required: false, integer: true, initial: 0 }),
      bonusCarry: new fields.NumberField({ required: false, initial: 0 }),

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

    /**
     * Espécie ativa. Usada para aplicar automaticamente o preset de Partes do Corpo e Skills
     * Raciais. Começa em branco de propósito (nunca "humano" por padrão) — o seletor mostra
     * "—" até o jogador escolher de verdade, obrigando uma escolha explícita na criação.
     */
    species: new fields.StringField({ required: true, initial: "", blank: true }),

    /** Linhagem escolhida dentro da Espécie (id de `lineages[]` do catálogo); "" = nenhuma. */
    lineage: new fields.StringField({ required: false, initial: "", blank: true }),

    /** Heranças (catálogo próprio), na ordem em que foram ganhas — a mais nova vence nas substituições. */
    heritages: new fields.ArrayField(
      new fields.SchemaField({
        id: new fields.StringField({ required: true, initial: "" }),
        acquiredAt: new fields.NumberField({ required: false, initial: null, nullable: true }),
        source: new fields.StringField({ required: false, initial: "", blank: true })
      }),
      { required: false, initial: [] }
    ),

    /**
     * Estado da origem (ver species.js): versão da Espécie aplicada (o selo "a Espécie mudou" compara
     * com o catálogo), trava do jogador (`lockedAt` no primeiro "Confirmar" de pontos; o Mestre
     * destrava com `unlocked`) e histórico de trocas/evoluções/Heranças.
     */
    speciesState: new fields.SchemaField({
      appliedVersion: new fields.NumberField({ required: false, initial: 0, integer: true, min: 0 }),
      lockedAt: new fields.NumberField({ required: false, initial: null, nullable: true }),
      unlocked: new fields.BooleanField({ required: false, initial: false }),
      history: new fields.ArrayField(new fields.ObjectField(), { required: false, initial: [] })
    }),

    /**
     * Traços acrescentados à mão (além dos que a Espécie dá) e Traços da Espécie retirados à mão.
     * Os efetivos saem de `actorTraits` em config.js.
     */
    traits: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),
    traitsRemoved: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),

    /** Escala do Ator (id de getScaleConfig().scales); vazio = a primeira (Pessoal). Um dragão pode ser "Veículo". */
    scale: new fields.StringField({ required: false, initial: "", blank: true }),

    /**
     * Aprimoramento das armas EQUIPADAS vindo de Skills (alvos "weapon*" de Efeito Temporário).
     * Nunca editado à mão — só por Active Effect. Multiplicador começa em 1 (MULTIPLY multiplica
     * o valor atual); Mágico/Absoluto são contadores (várias fontes somam, desligar uma não apaga
     * as outras): maior que 0 = ligado. Ver useWeaponAttack em damage-roll.js.
     */
    weaponBonuses: new fields.SchemaField({
      damageFlat: new fields.NumberField({ required: true, initial: 0 }),
      damageMultiplier: new fields.NumberField({ required: true, initial: 1, min: 0 }),
      elementOverride: new fields.StringField({ required: false, initial: "", blank: true }),
      forceMagic: new fields.NumberField({ required: true, initial: 0 }),
      absolute: new fields.NumberField({ required: true, initial: 0 })
    }),

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

/**
 * As funções `*Sources` abaixo devolvem cada parcela com a fonte (`{label, value, uuid, kind}`) e
 * as somas da preparação são a soma dessas listas — assim a janela "De onde vem" (apps/
 * stat-breakdown.js) mostra exatamente o que a ficha somou, sem uma segunda cópia da regra.
 */
const sumSources = list => list.reduce((sum, source) => sum + source.value, 0);

/** Bônus permanentes de Títulos (sempre ativos) para um alvo (atributo, "hp" ou "energy"). */
export function titleBonusSources(actor, target) {
  const list = [];
  for (const item of actor.items) {
    if (item.type !== "title") continue;
    for (const entry of item.system.bonuses ?? []) {
      const value = Number(entry.amount) || 0;
      if (entry.attribute === target && value) list.push({ label: item.name, value, uuid: item.uuid, kind: "title" });
    }
  }
  return list;
}

function sumTitleBonuses(actor, target) {
  return sumSources(titleBonusSources(actor, target));
}

/** Camadas de origem já resolvidas nesta preparação (ver deriveCombatAttributes), ou lidas agora. */
function layersOf(actor) {
  return actor?.system?.originLayers ?? actorOriginLayers(actor);
}

/**
 * Bônus de atributo da Espécie/Linhagem/Heranças: entram no Total como um Título (decisão do
 * rework de Espécies) — e por isso na Vida/Mana máxima.
 */
export function originBonusSources(actor, target) {
  return originAttributeRows(layersOf(actor), target);
}

/**
 * Soma bônus PERMANENTES de Atributo concedidos por Itens equipados e Modificações
 * instaladas (attributeBonuses). Ao contrário do bônus de Título, isso NUNCA entra
 * em `attr.total` (a base que alimenta HP/Mana) — só em `effectiveTotal`, junto com
 * buffDelta, ou seja, afeta a rolagem mas nunca o HP/Mana Máximo.
 */
export function itemAttributeSources(actor, key) {
  const list = [];
  const add = (entries, label, uuid, kind) => {
    for (const entry of entries ?? []) {
      const value = Number(entry.amount) || 0;
      if (entry.attribute === key && value) list.push({ label, value, uuid, kind });
    }
  };
  // Antimagia: fonte mágica suprimida não conta (ver core/suppression.js).
  const suppression = suppressionLevel(actor);
  for (const item of actor.items) {
    if (item.type === "skill" && !sourceSuppressed(actor, item, null, suppression)) add(item.system.attributeBonuses, item.name, item.uuid, "skill");
    else if (item.type === "item" && item.system.equipped && !sourceSuppressed(actor, item, null, suppression)) add(item.system.attributeBonuses, item.name, item.uuid, "item");
    else if (item.type === "body_part") {
      for (const mod of item.system.installedMods ?? []) if (!sourceSuppressed(actor, item, mod, suppression)) add(mod.attributeBonuses, `${item.name} › ${mod.name || "Modificação"}`, item.uuid, "mod");
    }
  }
  return list;
}

function sumItemAttributeBonus(actor, key) {
  return sumSources(itemAttributeSources(actor, key));
}

/**
 * Soma modificadores PERMANENTES de HP/Mana (não os temporários de buff): Títulos,
 * Skills (statModifiers, sempre ativo enquanto possuída), Item Geral (statModifiers,
 * só enquanto equipado) e Modificações de Parte do Corpo (statModifiers, sempre
 * ativo enquanto instalada).
 * @param {Actor} actor
 * @param {"hp"|"energy"} stat
 */
export function statModifierSources(actor, stat) {
  const list = [...titleBonusSources(actor, stat), ...originStatRows(layersOf(actor), stat)];
  const add = (modifiers, label, uuid, kind) => {
    const value = Number(modifiers?.[stat]) || 0;
    if (value) list.push({ label, value, uuid, kind });
  };
  const suppression = suppressionLevel(actor);
  for (const item of actor.items) {
    if (item.type === "skill" && !sourceSuppressed(actor, item, null, suppression)) add(item.system.statModifiers, item.name, item.uuid, "skill");
    else if (item.type === "item" && item.system.equipped && !sourceSuppressed(actor, item, null, suppression)) add(item.system.statModifiers, item.name, item.uuid, "item");
    else if (item.type === "body_part") {
      for (const mod of item.system.installedMods ?? []) if (!sourceSuppressed(actor, item, mod, suppression)) add(mod.statModifiers, `${item.name} › ${mod.name || "Modificação"}`, item.uuid, "mod");
    }
  }
  return list;
}

function sumPermanentStatModifier(actor, stat) {
  return sumSources(statModifierSources(actor, stat));
}

/**
 * Deslocamento por rodada, derivado da Destreza — só o número (nada é salvo). A parte permanente
 * usa `total` (pontos + Título) e a de Skills usa `buffDelta`, exatamente a separação que
 * `deriveCombatAttributes` já faz; ver `movementAllowance` em config.js. Precisa rodar depois dela.
 */
function deriveMovement(dataModel) {
  const dexterity = dataModel.attributes.combat.dexterity;
  // Excesso de peso (bloco "Peso limita o Deslocamento") entra como mais um −%.
  const encumbrance = dataModel.inventory?.penalty ?? 0;
  // A Espécie pode trocar a base (harpia) e somar % (Elfo da Floresta +10%).
  const origin = originMovement(dataModel.originLayers ?? []);
  const config = getMovementConfig();
  dataModel.movement = movementAllowance(
    { permanentDexterity: dexterity.total, skillDexterity: dexterity.buffDelta || 0, percent: (dataModel.attributes.movementPercent || 0) - encumbrance + origin.percent },
    origin.base === null ? config : { ...config, base: origin.base }
  );
}

/**
 * Vida das Partes do Corpo em % (board 5, revisão): o máximo de cada parte com `hpPercent` é esse %
 * da Vida máxima do personagem — já com buffs, senão um buff grande deixaria as partes em 0% com o
 * personagem cheio de Vida — e o valor sai da proporção salva (`integrity`). Parte Perdida vale 0.
 * Precisa rodar depois de deriveVitalStats e antes de deriveBodyState. Nada é salvo.
 */
function derivePartVitals(dataModel) {
  const actorMax = dataModel.attributes.hp.max ?? 0;
  for (const item of dataModel.parent.items) {
    if (item.type !== "body_part") continue;
    const sys = item.system;
    const vitals = resolvePartVitals(
      { hpPercent: sys.hpPercent, integrity: sys.integrity, hpValue: sys.hp.value, hpMax: sys.hp.max, lost: sys.lost, isProsthetic: sys.isProsthetic },
      actorMax
    );
    sys.hp.max = vitals.max;
    sys.hp.value = vitals.value;
    sys.status = vitals.state;
  }
}

/**
 * Ferimentos por parte (board 5): o estado do corpo a partir das Funções das partes — Condições
 * que as partes perdidas causam (aplicadas pelo Mestre designado, ver species/anatomy.js),
 * Deslocamento proporcional às partes que andam (mínimo de arrastar) e Traços perdidos (voo).
 * Precisa rodar depois de deriveMovement (ajusta o total). Nada é salvo.
 */
function deriveBodyState(dataModel) {
  if (!isBodyInjuryEnabled()) {
    dataModel.bodyState = null;
    return;
  }
  const known = getActiveBodyFunctions().map(f => f.id);
  const parts = dataModel.parent.items
    .filter(i => i.type === "body_part")
    .map(i => {
      const slot = i.system.slot;
      // Parte de antes do rework (sem Funções salvas): as do slot (braço manipula, perna anda…).
      const fallback = legacyFunctionsFor(["torso", "core", "head"].includes(slot) ? ["vital", "limb"] : ["limb"], slot, known);
      return {
        id: i.id,
        name: i.name,
        slot,
        hpValue: i.system.hp.value,
        hpMax: i.system.hp.max,
        lost: i.system.status === "lost",
        functions: i.system.functions?.length ? i.system.functions : fallback,
        isProsthetic: Boolean(i.system.isProsthetic),
        mods: (i.system.installedMods ?? []).map(m => ({ kind: m.kind || "implant", functions: m.functions ?? [] }))
      };
    });
  dataModel.bodyState = bodyFunctionState(parts, getActiveBodyFunctions());
  if (dataModel.movement) {
    const before = dataModel.movement.total;
    dataModel.movement.total = injuredMovement(before, dataModel.bodyState.movement);
    if (dataModel.movement.total !== before) dataModel.movement.injuredFrom = before;
  }
}

/**
 * Inventário (só o número, nada é salvo): slots da Espécie + bônus do Mestre, o que as pilhas
 * soltas ocupam, peso (com a redução dos contêineres e as moedas) e a carga que Força e Defesa
 * sustentam. Precisa rodar depois de deriveCombatAttributes (usa `total`) e antes de deriveMovement.
 */
function deriveInventory(dataModel) {
  const actor = dataModel.parent;
  const attributes = dataModel.attributes;
  const base = speciesCarry(getActiveSpeciesPresets()?.[dataModel.species], dataModel.species);
  const items = actor.items.filter(i => i.type === "item");
  const containers = [
    ...items.filter(i => i.system.container?.enabled).map(i => ({
      id: i.id, label: i.name, isSkill: false, unlimited: false,
      slots: i.system.container.slots, weightReduction: i.system.container.weightReduction
    })),
    ...actor.items.filter(i => i.type === "skill" && i.system.grantsContainer?.enabled).map(i => ({
      id: i.id, label: i.name, isSkill: true, unlimited: Boolean(i.system.grantsContainer.unlimited),
      slots: i.system.grantsContainer.slots, weightReduction: i.system.grantsContainer.weightReduction
    }))
  ];
  const load = inventoryLoad(
    items.map(i => ({
      id: i.id, quantity: i.system.quantity, stackSize: i.system.stackSize, weight: i.system.weight,
      containerId: i.system.containerId, isContainer: Boolean(i.system.container?.enabled)
    })),
    containers
  );
  const weight = Math.round((load.weight + currencyWeight(dataModel.currencies, getActiveCurrencies())) * 100) / 100;
  const capacity = carryCapacity(
    { base: base.carry, strength: attributes.combat.strength.total, defense: attributes.combat.defense.total, bonus: attributes.bonusCarry },
    { perStrength: getFeatureOption("inventory", "carryPerStrength"), perDefense: getFeatureOption("inventory", "carryPerDefense") }
  );
  const enabled = isInventoryEnabled();
  dataModel.inventory = {
    slots: Math.max(0, base.slots + (attributes.bonusSlots || 0)),
    usedSlots: load.looseSlots,
    weight,
    capacity,
    over: weight > capacity,
    penalty: enabled && isEncumbranceEnabled() ? encumbrancePenalty(weight, capacity) : 0,
    containers,
    byContainer: load.byContainer
  };
}

/**
 * Modificadores Condicionais contínuos ("+N num atributo enquanto minha Vida < 30%"): entram como
 * um buff temporário — só em `effectiveTotal`/`bonus` (rolagem), nunca em `total`, então nunca
 * mexem na Vida/Mana máxima. Roda DEPOIS de deriveVitalStats porque a condição de Vida precisa
 * do máximo já calculado; e é justamente por não voltar pro máximo que não existe o círculo
 * "Força ↔ Vida". Ver conditional-modifiers.js.
 */
function deriveConditionalAttributes(dataModel) {
  const actor = dataModel.parent;
  const mods = collectConditionalModifiers(actor);
  if (!mods.length) return;
  const hp = dataModel.attributes.hp;
  const ctx = buildModifierContext(actor, null, { hpPercent: hp.max > 0 ? (hp.value / hp.max) * 100 : 0 });
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    const attr = dataModel.attributes.combat[key];
    const bonus = sumConditionalModifiers(mods, "attributeFlat", ctx, { attribute: key });
    attr.conditionalBonus = bonus;
    if (!bonus) continue;
    attr.effectiveTotal += bonus;
    attr.bonus = Math.floor(attr.effectiveTotal / 3);
  }
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
  // Origem (Espécie → Linhagem → Heranças), lida uma vez por preparação; nada disto é salvo.
  dataModel.originLayers = actorOriginLayers(dataModel);
  dataModel.effectiveScale = dataModel.scale || originScale(dataModel.originLayers);
  let spent = 0;
  for (const key of MEU_SISTEMA.COMBAT_ATTRIBUTES) {
    const attr = combat[key];
    const titleBonus = sumTitleBonuses(dataModel.parent, key) + sumSources(originAttributeRows(dataModel.originLayers, key));
    attr.total = attr.points + titleBonus;
    attr.itemBonus = sumItemAttributeBonus(dataModel.parent, key);
    attr.effectiveTotal = attr.total + (attr.buffDelta || 0);
    attr.bonus = Math.floor(attr.effectiveTotal / 3);
    // Prévia de "e se eu confirmar os pontos pendentes agora": NUNCA usada em HP/Mana/rolagem
    // de verdade (só ilustrativo na ficha) — `pendingPoints` só vira `bonus` de verdade quando
    // "Confirmar" move ele pra `points` (ver actor-sheet.js).
    attr.previewBonus = Math.floor((attr.effectiveTotal + (attr.pendingPoints || 0)) / 3);
    spent += attr.points + attr.pendingPoints;
  }

  // Quanto o Mestre concede vs. quanto já foi investido (confirmado + pendente) nos
  // atributos — os botões +/- da ficha usam `remaining` pra travar a alocação (ver
  // incrementAttributePoint em actor-sheet.js). Título não conta como "gasto" (é bônus,
  // não escolha do jogador).
  const level = dataModel.attributes.level;
  const bonus = dataModel.attributes.bonusAttributePoints || 0;
  const total = getAttributePointsStarting() + Math.max(0, level - 1) * getAttributePointsPerLevel() + bonus;
  dataModel.attributePointsPool = { total, spent, remaining: total - spent, bonus };
}

/**
 * HP Máximo = (Atributo A).Total × (Atributo B).Total × Multiplicador; Mana Máxima segue a
 * mesma forma com o outro par de atributos — usando só a base PERMANENTE dos atributos (buffs
 * temporários de atributo nunca entram aqui). A fórmula em si nunca fica abaixo do Piso (mesmo
 * com todos os atributos zerados); modificadores permanentes (Título/Skill/Item/Modificação) e o
 * buffDelta temporário de HP/Mana somam por cima desse piso, sem limite próprio.
 *
 * QUAIS atributos entram, o multiplicador e o piso vêm de `getVitalFormula()` (settings do
 * Mestre) — o padrão continua sendo Força×Defesa e Magia×Defesa Mágica ×10, piso 50, que é
 * exatamente o comportamento anterior. É isso que permite uma campanha sem magia: apontar a
 * Mana pra outros dois atributos, ou desligar o pool inteiro (`energyEnabled: false`), caso em
 * que o Máximo vira 0 e a barra some da ficha — nenhum Custo de Habilidade é cobrado nesse modo
 * (ver `useSkillEffect` em skill-effects.js).
 *
 * Precisa rodar DEPOIS de deriveCombatAttributes (usa combat.X.total já calculado).
 */
/**
 * Deriva o teto de XP do nível atual e trava `xp` nele. O clamp acontece na PREPARAÇÃO (e não só
 * em quem escreve) porque o XP entra por vários caminhos — macro do Mestre, uso de Skill, edição
 * direta na ficha — e todos precisam obedecer ao mesmo teto sem cada um lembrar de checar.
 * `xpReady` é o que a ficha e a Voz do Mundo usam pra avisar que dá pra subir de nível.
 */
function deriveExperience(dataModel) {
  const attributes = dataModel.attributes;
  const max = getXpForNextLevel(attributes.level);

  attributes.xpMax = max;
  attributes.xp = Math.clamp(attributes.xp, 0, max);
  attributes.xpReady = attributes.xp >= max;
  attributes.xpPercent = max > 0 ? Math.round((attributes.xp / max) * 100) : 0;
}

function deriveVitalStats(dataModel) {
  const actor = dataModel.parent;
  const combat = dataModel.attributes.combat;
  const hp = dataModel.attributes.hp;
  const energy = dataModel.attributes.energy;
  const formula = getVitalFormula();

  const product = ([first, second]) => (combat[first]?.total ?? 0) * (combat[second]?.total ?? 0);
  const baseHpMax = Math.max(formula.floor, Math.round(product(formula.hp) * formula.multiplier));

  hp.max = Math.max(1, baseHpMax + sumPermanentStatModifier(actor, "hp") + (hp.buffDelta || 0));
  hp.value = Math.clamp(hp.value, 0, hp.max);

  if (!formula.energyEnabled) {
    // Campanha sem pool de Mana/Energia: zera em vez de esconder só visualmente, pra nenhuma
    // regra (Custo, upkeep, tick periódico com alvo "energy") ler um valor que a mesa não usa.
    energy.max = 0;
    energy.value = 0;
    return;
  }

  const baseEnergyMax = Math.max(formula.floor, Math.round(product(formula.energy) * formula.multiplier));
  energy.max = Math.max(0, baseEnergyMax + sumPermanentStatModifier(actor, "energy") + (energy.buffDelta || 0));
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
    deriveInventory(this);
    deriveMovement(this);
    deriveVitalStats(this);
    derivePartVitals(this);
    deriveBodyState(this);
    deriveConditionalAttributes(this);
    deriveExperience(this);
  }
}
