import {
  MEU_SISTEMA,
  getStarshipEnergyLabel,
  effectiveSkillCost,
  isShipManeuverEnabled,
  getShipManeuverConfig,
  engineRatio,
  shipMovementCells,
  shipEvasionFraction,
  moduleRole,
  getVesselClasses,
  fundByPriority
} from "../config.js";

const fields = foundry.data.fields;

/**
 * Fração (0-1) do desempenho que um Módulo ainda entrega, dada a Vida dele — a regra de que
 * Módulo danificado faz menos: um Escudo de capacidade 100 com 5 de 100 de Vida segura 5, e um
 * Regen de 100 passa a regenerar 5.
 *
 * Fica FORA da classe de propósito: não usa `this`, e como função pura dá pra testar a regra
 * sem precisar de um Actor do Foundry montado (ver test/rules.test.mjs).
 *
 * `hp.max` zerado devolve 1 (integridade plena) em vez de dividir por zero — sem máximo não há
 * como medir dano, e zerar o desempenho de um Módulo mal configurado seria pior que ignorar.
 */
/**
 * Categorias que NÃO entram na soma da Integridade Estrutural. Casco e Escudo têm pool próprio
 * (são as duas primeiras camadas da cascata), e Arma é equipamento pendurado no casco, não
 * estrutura — derrubar todas as armas não deveria partir a nave ao meio.
 */
const NON_STRUCTURAL_ROLES = ["armor", "shield", "weapon"];

/**
 * Categorias que não recebem dano espalhado pela Integridade. **Só o Casco** — ele já absorveu
 * a parte dele no estágio anterior da cascata, e levar de novo no estágio seguinte seria contar
 * duas vezes. Escudo e Arma, apesar de ficarem FORA da soma, recebem esse dano na própria Vida:
 * um tiro que atravessa o casco pode muito bem acertar o emissor de escudo ou uma torre.
 */
const SPREAD_IMMUNE_ROLES = ["armor"];

export function moduleIntegrityRatio(module) {
  const max = module?.system?.hp?.max ?? 0;
  if (max <= 0) return 1;
  return Math.clamp((module.system.hp.value ?? 0) / max, 0, 1);
}

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

    /** Classe (Encouraçado, Cargueiro… / Tanque, Carro…) — id do catálogo; vazio = sem Classe. */
    shipClass: new fields.StringField({ required: false, initial: "", blank: true }),

    /** Traços da Nave/Veículo, marcados à mão (Mecânico, Orgânico numa nave viva…). */
    traits: new fields.ArrayField(new fields.StringField(), { required: false, initial: [] }),

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
       * Geração contínua LÍQUIDA do Reator — sempre derivada (ver `prepareDerivedData`), nunca
       * editável à mão: `reactorOutput` do Módulo × throttle × fome de energia, MENOS o Custo
       * por Rodada de toda Habilidade Ativa ligada (`activeUpkeepDrain`). É de propósito que o
       * upkeep entre aqui em vez de virar um desconto salvo em algum lugar: uma Skill Ativa
       * compete com a geração bruta do Reator (não com a reserva da Bateria), e desligá-la
       * devolve a energia sozinha, sem estado nenhum pra vazar ou precisar de limpeza.
       * `powerGrid.reactorBaseOutput` (também derivado) guarda a geração ANTES desse desconto —
       * é o teto que `tickActorUpkeepSkills` usa pra decidir o que a Nave ainda consegue manter
       * ligado.
       */
      reactorOutput: new fields.NumberField({ required: true, integer: true, initial: 100, min: 0 }),
      /**
       * Baterias/Capacitores: armazenam excedente e descarregam quando o consumo supera o
       * reator. É também o pool de onde sai o Custo ÚNICO (pago ao usar/ligar) de uma
       * Habilidade de Nave — ver `energyValuePath` em skill-effects.js.
       *
       * `max` é sempre derivado (ver `prepareDerivedData`): sem Módulo de Bateria vale o mínimo
       * dos conduítes do casco (`MEU_SISTEMA.CONDUIT_CAPACITOR_BY_SHIP_SIZE`, pequeno mas nunca
       * zero); com Bateria instalada, a capacidade dela SUBSTITUI esse mínimo.
       */
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
      weaponPenetrationMultiplier: new fields.NumberField({ required: true, initial: 1, min: 0 }),
      // Aprimoramento das Armas da Nave (mesmos alvos "weapon*" da arma pessoal).
      weaponElementOverride: new fields.StringField({ required: false, initial: "", blank: true }),
      weaponAbsolute: new fields.NumberField({ required: true, initial: 0 }),
      // Melhorias temporárias de sistema, em % somado (várias Skills empilham): +20 = ×1.2.
      // Podem vir de uma Skill da própria Nave OU de um tripulante mirando a Nave.
      shieldCapacityPercent: new fields.NumberField({ required: true, initial: 0 }),
      shieldRegenPercent: new fields.NumberField({ required: true, initial: 0 }),
      reactorOutputPercent: new fields.NumberField({ required: true, initial: 0 }),
      propulsionPercent: new fields.NumberField({ required: true, initial: 0 })
    }),

    /**
     * Tripulação (PAD, Fase 1): Personagens (Actor type "character", PJ ou NPC) atualmente
     * designados a esta Nave/Veículo. Só o Mestre gerencia (mesma filosofia de Level Up — mudança
     * de estado do mundo, não algo que o jogador ativa sozinho), pela aba "Tripulação" da própria
     * ficha. Guarda por UUID (não embutido) porque o Ator tripulante continua existindo e sendo
     * editável independente da Nave — só a ASSOCIAÇÃO mora aqui. `role` é rótulo livre (ex:
     * "Piloto"), opcional. NÃO confundir com `crew` (NumberField logo acima nas Data Models
     * concretas — capacidade numérica pré-existente, nomes deliberadamente diferentes).
     */
    crewMembers: new fields.ArrayField(
      new fields.SchemaField({
        actorUuid: new fields.StringField({ required: true, blank: false }),
        role: new fields.StringField({ required: false, initial: "", blank: true })
      }),
      { required: false, initial: [] }
    )
  };
}

/**
 * Base compartilhada por Nave Espacial e Veículo — os dois tipos usam o MESMO Grid de Energia e
 * leem os Módulos pela FUNÇÃO da Categoria (MEU_SISTEMA.MODULE_ROLES: `modulesByRole`,
 * `sumRoleStat`), não por um id de categoria fixo: dois Núcleos de Dobra somam Geração, impulso +
 * manobradores somam Propulsão. Os getters `reactorModule`/`shieldModule`/… devolvem o primeiro
 * Módulo da Função, pra ficha mostrar o nome.
 */
class ShipSystemsDataModel extends foundry.abstract.TypeDataModel {
  /** Rótulo de energia atual (setting compartilhada entre Nave e Veículo). */
  get energyLabel() {
    return getStarshipEnergyLabel();
  }

  /**
   * Resultado memorizado de `powerShortfall` dentro de UM ciclo de preparação de dados. Sem
   * isso, `effectiveModuleStat` refaz a ordenação de todos os Módulos uma vez POR CAMPO lido —
   * renderizar a ficha de uma Nave com uma dúzia de Módulos repetia a mesma conta dezenas de
   * vezes. Invalidado em `prepareDerivedData` (ver lá os dois pontos de invalidação e por que
   * são dois).
   * @type {{ratios: Map<string, number>, totalDemand: number, capacity: number}|null}
   */
  #shortfallCache = null;

  /** Descarta o valor memorizado de fome de energia — chamado sempre que um insumo dele muda. */
  #invalidatePowerCache() {
    this.#shortfallCache = null;
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

  /**
   * Tripulantes resolvidos (Actor documents), na mesma ordem de `crewMembers`. Usa `fromUuidSync`
   * (não `fromUuid`) porque um getter de Data Model não pode ser async — entradas cujo Ator foi
   * apagado (`fromUuidSync` retorna null) são filtradas, não quebram o getter nem deixam
   * "fantasmas" na lista, mas também não são auto-removidas de `crewMembers` (isso é
   * responsabilidade da UI de edição do Mestre, não deste getter — leitura nunca deve mutar dados).
   */
  get crewActors() {
    return this.crewMembers
      .map(entry => ({ ...entry, actor: fromUuidSync(entry.actorUuid) }))
      .filter(entry => entry.actor !== null);
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

  /** Primeiro Módulo instalado de uma categoria, ou `null` — pra quem ainda pensa em "o" Módulo. */
  singleSlotModule(category) {
    return this.modules.find(m => m.system.category === category) ?? null;
  }

  /**
   * Módulos de uma Função mecânica (MEU_SISTEMA.MODULE_ROLES), de qualquer Categoria: "Motor de
   * Impulso" e "Manobradores" são os dois Propulsão. É o que as capacidades derivadas leem — dois
   * Núcleos de Dobra somam Geração, dois Escudos somam capacidade.
   */
  modulesByRole(role) {
    return this.modules.filter(m => moduleRole(m.system.category) === role);
  }

  /** Primeiro Módulo de uma Função (o que a ficha mostra pelo nome), ou `null`. */
  firstModuleOfRole(role) {
    return this.modulesByRole(role)[0] ?? null;
  }

  /** Soma de um campo efetivo (throttle, energia e Vida já aplicados) de todos os Módulos de uma Função. */
  sumRoleStat(role, field) {
    return this.modulesByRole(role).reduce((sum, m) => sum + this.effectiveModuleStat(m, field), 0);
  }

  /** Classe desta Nave/Veículo (catálogo), ou `null`. */
  get vesselClass() {
    if (!this.shipClass) return null;
    const kind = this.parent?.type === "vehicle" ? "vehicle" : "ship";
    return getVesselClasses(kind).find(c => c.id === this.shipClass) ?? null;
  }

  /**
   * Razão do Motor para `field` ("acceleration" | "rotation"): o valor EFETIVO do Motor instalado
   * (throttle, energia e Vida já aplicados) dividido pelo do Motor que o Porte da nave pede — a
   * posição do Porte na escala de Módulos (Mini → Compacto … Capital → Colossal). Ver `engineRatio`.
   */
  engineRatioFor(field) {
    // Todos os Módulos de Propulsão somam: impulso dá Aceleração, manobradores dão Rotação.
    const propulsion = this.modulesByRole("propulsion");
    if (!propulsion.length) return 0;
    const moduleSize = MEU_SISTEMA.MODULE_SIZES[MEU_SISTEMA.SHIP_SIZE_RANK[this.shipSize]];
    const reference = MEU_SISTEMA.MODULE_SIZE_PRESETS.engine?.[moduleSize]?.[field] ?? 0;
    return engineRatio(this.sumRoleStat("propulsion", field) * this.bonusFactor("propulsionPercent"), reference);
  }

  /** Fator de uma melhoria temporária em % (`combatBonuses.*Percent`): +20 → 1.2; nunca negativo. */
  bonusFactor(field) {
    return Math.max(0, 1 + (Number(this.combatBonuses?.[field]) || 0) / 100);
  }

  /** Casas por rodada em combate: base do Porte × razão da Aceleração. 0 sem Motor. */
  get movementCells() {
    const base = getShipManeuverConfig().movement[this.shipSize] ?? 0;
    return shipMovementCells(base * (this.vesselClass?.movementMultiplier ?? 1), this.engineRatioFor("acceleration"));
  }

  /**
   * Evasão (fração 0-1 do dano dos tiros evitada antes do Escudo): base do Porte × razão da
   * Rotação, com teto. É 0 com o bloco "Movimento e Evasão de naves" desligado — a Manobra volta a
   * ser só o número de sempre e a cascata de dano não muda.
   */
  get evasion() {
    if (!isShipManeuverEnabled()) return 0;
    const config = getShipManeuverConfig();
    const base = (config.evasion[this.shipSize] ?? 0) * (this.vesselClass?.evasionMultiplier ?? 1);
    return shipEvasionFraction(base, this.engineRatioFor("rotation"), config.evasionCap);
  }

  // "O" Módulo de cada Função — o primeiro instalado. A ficha mostra o nome dele; as contas usam
  // a Função inteira (modulesByRole/sumRoleStat), então dois Reatores somam mesmo assim.
  get reactorModule() { return this.firstModuleOfRole("power"); }
  get batteryModule() { return this.firstModuleOfRole("storage"); }
  get shieldModule() { return this.firstModuleOfRole("shield"); }
  get engineModule() { return this.firstModuleOfRole("propulsion"); }
  get ftlModule() { return this.firstModuleOfRole("ftl"); }

  /**
   * O Distribuidor ativo: só um vale (somar dois dobraria o teto de transferência) — o primeiro
   * online; sem nenhum online, o primeiro instalado.
   */
  get distributorModule() {
    const all = this.modulesByRole("distribution");
    return all.find(m => m.system.status === "online") ?? all[0] ?? null;
  }

  /**
   * O Módulo de Blindagem que absorve AGORA: com duas ou mais, uma de cada vez, a mais
   * danificada primeiro (a mais inteira fica por último). Blindagem já zerada não absorve.
   */
  get armorModule() {
    const armors = this.modulesByRole("armor");
    const standing = armors.filter(m => (m.system.hp?.value ?? 0) > 0);
    const pool = standing.length ? standing : armors;
    return [...pool].sort((a, b) => this.integrityRatioFor(a) - this.integrityRatioFor(b))[0] ?? null;
  }

  /**
   * Redução de dano da Blindagem que está absorvendo, em fração (0-1) — 0 sem Blindagem.
   * Degrada com a Vida do Módulo, como todo o resto: placa amassada protege menos.
   */
  get armorReductionPercent() {
    const armor = this.armorModule;
    if (!armor) return 0;
    const base = (armor.system.armorReduction ?? 0) / 100;
    return Math.clamp(base * this.integrityRatioFor(armor), 0, 1);
  }

  /**
   * Módulos que compõem a Integridade Estrutural: tudo menos Casco, Escudo e Arma
   * (NON_STRUCTURAL_CATEGORIES). A Integridade não é um número próprio da Nave — é a soma da
   * Vida desses Módulos, então "a nave está inteira" e "os sistemas dela estão inteiros" passam
   * a ser a mesma frase.
   */
  get structuralModules() {
    return this.modules.filter(m => !NON_STRUCTURAL_ROLES.includes(moduleRole(m.system.category)));
  }

  /**
   * Módulos que podem receber o dano espalhado pela Integridade — todos menos o Casco
   * (SPREAD_IMMUNE_CATEGORIES). Inclui Escudo e Armas de propósito, mesmo eles ficando fora da
   * SOMA da Integridade.
   */
  get spreadDamageTargets() {
    return this.modules.filter(m => !SPREAD_IMMUNE_ROLES.includes(moduleRole(m.system.category)));
  }

  /** Armas instaladas (category "weapon") — múltiplas, ao contrário dos slots únicos acima. */
  get weaponModules() {
    return this.modulesByRole("weapon");
  }

  /**
   * Orçamento de espaço de Arma pro Porte desta Nave/Veículo, de
   * `MEU_SISTEMA.WEAPON_SLOT_BUDGET_BY_SHIP_SIZE` (Mini = 1 Arma Compacta, dobrando por Porte).
   * O `?? Infinity` é só a rede de segurança pra um Porte fora da tabela: nesse caso o
   * orçamento não bloqueia nada, em vez de zerar e impedir qualquer Arma.
   */
  get weaponSlotBudget() {
    const base = MEU_SISTEMA.WEAPON_SLOT_BUDGET_BY_SHIP_SIZE?.[this.shipSize] ?? Infinity;
    // A Classe muda o espaço: Cruzador ×1.5, Cargueiro ×0.25 — arredondado pra baixo.
    return Number.isFinite(base) ? Math.floor(base * (this.vesselClass?.weaponBudgetMultiplier ?? 1)) : base;
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
    // Distribuidor danificado roteia menos — mesma regra de integridade dos outros Módulos.
    return Math.round(baseline * (distributor.system.transferFactor ?? 1) * this.integrityRatioFor(distributor));
  }

  /**
   * Estado ao vivo do Distribuidor (Overhaul de Naves, Fase 3) — recalculado a cada leitura,
   * nunca armazenado: quanto cada Módulo "online" está pedindo agora, quanto a Capacidade de
   * Transferência + a Reserva da Bateria conseguem cobrir, e — se nem isso bastar — a fração
   * (0-1) que cada Módulo de fato recebe nesta rodada, financiando por grupo de `powerPriority`
   * (P1 primeiro; dentro do grupo, todos recebem a mesma fração — ver fundByPriority). Isso é FOME DE ENERGIA, não dano: não persiste entre recálculos, não
   * desliga o Módulo sozinho, só reduz o que ele entrega enquanto a demanda continuar acima do
   * que a Nave/Veículo consegue entregar — se resolve sozinho assim que a demanda cair.
   */
  get powerShortfall() {
    if (this.#shortfallCache) return this.#shortfallCache;

    const online = this.modules.filter(m => m.system.status === "online");
    const available = Math.min(this.powerGrid.reactorOutput, this.transferCapacity) + this.powerGrid.capacitor.value;
    const ratios = fundByPriority(
      online.map(module => ({
        id: module.id,
        demand: (module.system.powerConsumption ?? 0) * ((module.system.powerAllocationPercent ?? 100) / 100),
        priority: module.system.powerPriority
      })),
      available
    );

    this.#shortfallCache = { ratios, totalDemand: this.totalConsumption, capacity: this.transferCapacity };
    return this.#shortfallCache;
  }

  /** Fração (0-1) de capacidade que este Módulo de fato recebe agora — 1 se não houver déficit de energia. */
  powerRatioFor(module) {
    if (!module) return 1;
    return this.powerShortfall.ratios.get(module.id) ?? 1;
  }

  /**
   * Fração (0-1) do desempenho que um Módulo ainda entrega, dada a Vida dele. Um Módulo meio
   * destruído faz meio serviço: um Escudo de capacidade 100 com 5 de 100 de Vida segura 5, e se
   * regenera 100 por rodada, passa a regenerar 5.
   *
   * `hp.max` zerado devolve 1 (integridade plena) em vez de dividir por zero — sem máximo não há
   * como medir dano, e zerar o desempenho de um Módulo mal configurado seria pior que ignorar.
   */
  integrityRatioFor(module) {
    return moduleIntegrityRatio(module);
  }

  /**
   * Valor de um campo do Módulo já escalado pelos TRÊS fatores que limitam o que ele entrega:
   * o throttle escolhido (`powerAllocationPercent`), a fome de energia do momento
   * (`powerRatioFor`) e a Vida restante do próprio Módulo (`integrityRatioFor`).
   *
   * É a base de toda capacidade derivada de Módulo — Geração do Reator, Vida/Regen de Escudo,
   * Aceleração/Rotação de Motor, Fator de Dobra, Dano/Penetração de Arma. `null`/sem Módulo
   * instalado retorna 0.
   *
   * Repare que o CONSUMO não passa por aqui (ver `totalConsumption`): um Módulo danificado
   * continua puxando a mesma energia e entregando menos — é o que torna o dano realmente caro,
   * em vez de dar um desconto de energia como prêmio por estar quebrado.
   */
  effectiveModuleStat(module, field) {
    if (!module) return 0;
    const throttleRatio = (module.system.powerAllocationPercent ?? 100) / 100;
    const powerRatio = this.powerRatioFor(module);
    const integrityRatio = this.integrityRatioFor(module);
    return Math.round((module.system[field] ?? 0) * throttleRatio * powerRatio * integrityRatio);
  }

  /**
   * Soma do Custo por Rodada de toda Habilidade Ativa ligada nesta Nave/Veículo — top-level e
   * cada Sub-Skill de uma Skill Fundida (várias podem estar ligadas ao mesmo tempo). Vira um
   * desconto direto na geração do Reator (ver `prepareDerivedData`), e não um `update()` que
   * precisaria ser desfeito ao desligar: o estado `active` da Skill JÁ é a persistência disso.
   */
  get activeUpkeepDrain() {
    let sum = 0;
    for (const skill of this.parent.items) {
      if (skill.type !== "skill") continue;
      // Mesmo desconto por nível que `tickActorUpkeepSkills` aplica (ver effectiveSkillCost) —
      // os dois precisam concordar, senão o Reator reservaria um valor e o tick cobraria outro.
      if (skill.system.hasUpkeep && skill.system.active) {
        sum += effectiveSkillCost(skill.system.upkeepCost, skill.system.level);
      }
      for (const sub of skill.system.subSkills ?? []) {
        if (sub.hasUpkeep && sub.active) sum += effectiveSkillCost(sub.upkeepCost, sub.level);
      }
    }
    return sum;
  }

  prepareDerivedData() {
    // 1ª invalidação: os dados podem ter mudado desde a última preparação.
    this.#invalidatePowerCache();

    // FASE A — os INSUMOS do cálculo de fome de energia (Reator e Capacitor). Tudo aqui é 100%
    // derivado do Módulo instalado; sem o Módulo correspondente o valor é 0 (ou o mínimo de
    // conduíte, no caso do Capacitor), nunca um fallback editável à mão.
    // `reactorBaseOutput` é a geração ANTES do desconto de Habilidades Ativas (não faz parte do
    // schema salvo, mesmo padrão de `attributePointsPool` em character-model.js); `reactorOutput`
    // é o que sobra de fato pros Módulos depois que as Skills Ativas reservam a parte delas.
    this.powerGrid.reactorBaseOutput = Math.round(this.sumRoleStat("power", "reactorOutput") * this.bonusFactor("reactorOutputPercent"));
    this.powerGrid.reactorOutput = Math.max(0, this.powerGrid.reactorBaseOutput - this.activeUpkeepDrain);
    // Capacitor: o mínimo dos conduítes do casco é o piso natural de toda Nave/Veículo; o
    // Módulo de Bateria SUBSTITUI esse valor (não soma) quando instalado. A tabela de conduíte
    // fica toda abaixo da menor Bateria instalável, então trocar nunca piora — ver
    // MEU_SISTEMA.CONDUIT_CAPACITOR_BY_SHIP_SIZE.
    this.powerGrid.capacitor.max = this.modulesByRole("storage").length
      ? this.sumRoleStat("storage", "batteryCapacity")
      : MEU_SISTEMA.CONDUIT_CAPACITOR_BY_SHIP_SIZE[this.shipSize] ?? 0;
    // Clampar a reserva AQUI (e não junto dos outros clamps lá embaixo) é deliberado:
    // `powerShortfall` soma `capacitor.value` na energia disponível, e financiar Módulo com
    // reserva acima do próprio máximo — situação real logo depois de trocar por uma Bateria
    // menor — inflaria Escudo/Motor por um instante.
    this.powerGrid.capacitor.value = Math.clamp(this.powerGrid.capacitor.value, 0, this.powerGrid.capacitor.max);

    // 2ª invalidação: os insumos acima acabaram de mudar. A partir daqui eles estão finalizados,
    // então o valor memorizado passa a ser o definitivo desta preparação — é este ponto que
    // torna o cache seguro, em vez de congelar um estado intermediário da Fase A.
    this.#invalidatePowerCache();

    // FASE B — capacidades derivadas, todas lendo a fome de energia já resolvida e estável.
    this.shields.max = Math.round(this.sumRoleStat("shield", "shieldCapacity") * this.bonusFactor("shieldCapacityPercent"));
    this.shields.regenRate = Math.round(this.sumRoleStat("shield", "shieldRegen") * this.bonusFactor("shieldRegenPercent"));

    // Casco e Integridade não são mais números próprios da Nave: são VISÕES sobre a Vida dos
    // Módulos. O Casco é literalmente a Vida do Módulo de armadura (danificar o pool é danificar
    // o Módulo), e a Integridade é a soma da Vida dos Módulos estruturais. Os campos continuam
    // no schema por compatibilidade com mundos salvos antes desta regra, mas o valor guardado
    // deixou de ser consultado — quem manda é o Módulo.
    // Várias Blindagens somam no Casco (o dano entra numa de cada vez, ver `armorModule`).
    const armors = this.modulesByRole("armor");
    this.casco.value = armors.reduce((sum, m) => sum + (m.system.hp.value ?? 0), 0);
    this.casco.max = armors.reduce((sum, m) => sum + (m.system.hp.max ?? 0), 0);

    const structural = this.structuralModules;
    this.hull.value = structural.reduce((sum, m) => sum + (m.system.hp.value ?? 0), 0);
    this.hull.max = structural.reduce((sum, m) => sum + (m.system.hp.max ?? 0), 0);

    this.shields.value = Math.clamp(this.shields.value, 0, this.shields.max);
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
    return this.sumRoleStat("propulsion", "rotation");
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
    return this.sumRoleStat("propulsion", "acceleration");
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    this.fuel.value = Math.clamp(this.fuel.value, 0, this.fuel.max);
  }
}
