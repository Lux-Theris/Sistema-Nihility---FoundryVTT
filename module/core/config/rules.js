/**
 * Regras puras (sem `game`), testadas em test/rules.test.mjs: inventário, Grid de Energia, deslocamento, Antimagia…
 * (Parte de core/config.js, dividido em 1.68.0 sem mudar nenhuma função; importe de
 * `core/config.js`, que reexporta tudo.)
 */
import { MEU_SISTEMA } from "./constants.js";

/**
 * Traços efetivos de um Ator: os da Espécie, mais os acrescentados na ficha, menos os retirados
 * na ficha. Nave/Veículo só têm os da ficha. Pura sobre os dados que recebe.
 * @param {{species?:string, traits?:string[], traitsRemoved?:string[]}} system
 * @param {Record<string, {traits?:string[]}>} speciesPresets
 * @returns {string[]}
 */
export function resolveActorTraits(system, speciesPresets = {}, originTraitIds = null) {
  // Com as camadas de origem (Espécie → Linhagem → Heranças), os Traços vêm delas; sem elas, só da Espécie.
  const fromSpecies = originTraitIds ?? speciesPresets?.[system?.species]?.traits ?? [];
  const removed = new Set(system?.traitsRemoved ?? []);
  return [...new Set([...fromSpecies, ...(system?.traits ?? [])])].filter(t => !removed.has(t));
}

/** Traços da origem a partir das camadas já preparadas (mesma regra de originTraits, sem importar species-rules). */
export function originTraitIdsOf(layers) {
  const traits = new Set();
  const removed = new Set();
  for (const layer of layers ?? []) {
    for (const t of layer.traits ?? []) traits.add(t);
    for (const t of layer.removesTraits ?? []) removed.add(t);
  }
  return [...traits].filter(t => !removed.has(t));
}

/** Slots e carga base (kg) de uma Espécie: os campos do preset, senão a tabela padrão. Pura. */
export function speciesCarry(preset, speciesKey) {
  const fallback = MEU_SISTEMA.SPECIES_CARRY_DEFAULTS[speciesKey] ?? MEU_SISTEMA.DEFAULT_CARRY;
  const read = (value, fb) => {
    if (value === undefined || value === null || value === "") return fb;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  };
  return { slots: Math.round(read(preset?.inventorySlots, fallback.slots)), carry: read(preset?.carryBase, fallback.carry) };
}

/** Quantos slots uma quantidade ocupa em pilhas de `stackSize` (0 itens = 0 slots). Pura. */
export function stackCount(quantity, stackSize) {
  const q = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!q) return 0;
  const size = Math.max(1, Math.floor(Number(stackSize) || MEU_SISTEMA.ITEM_STACK_DEFAULT));
  return Math.ceil(q / size);
}

/**
 * Carga de um inventário. `entries`: Itens ({id, quantity, stackSize, weight, containerId,
 * isContainer}); `containers`: contêineres disponíveis ({id, slots, unlimited, weightReduction}),
 * de Item ou de Skill. Um contêiner ocupa sempre 1 slot de quem o carrega; o que está dentro
 * ocupa os slots dele e pesa menos pela redução. Id de contêiner que não existe = solto. Pura.
 * @returns {{looseSlots: number, weight: number, byContainer: Object<string, {used: number, slots: number, unlimited: boolean}>}}
 */
export function inventoryLoad(entries, containers = []) {
  const byId = new Map((containers ?? []).map(c => [c.id, c]));
  const byContainer = {};
  for (const c of containers ?? []) byContainer[c.id] = { used: 0, slots: Math.max(0, Number(c.slots) || 0), unlimited: Boolean(c.unlimited) };
  let looseSlots = 0;
  let weight = 0;
  for (const e of entries ?? []) {
    const slots = e.isContainer ? 1 : stackCount(e.quantity, e.stackSize);
    const ownWeight = Math.max(0, Number(e.weight) || 0) * Math.max(0, Number(e.quantity) || 0);
    const holder = e.containerId && e.containerId !== e.id ? byId.get(e.containerId) : null;
    if (holder) {
      byContainer[holder.id].used += slots;
      weight += ownWeight * (1 - Math.min(100, Math.max(0, Number(holder.weightReduction) || 0)) / 100);
    } else {
      looseSlots += slots;
      weight += ownWeight;
    }
  }
  return { looseSlots, weight: Math.round(weight * 100) / 100, byContainer };
}

/** Peso das moedas (quantidade × peso de cada moeda do catálogo). Pura. */
export function currencyWeight(balances, catalog) {
  return (catalog ?? []).reduce((sum, c) => sum + (Number(balances?.[c.id]) || 0) * (Number(c.weight) || 0), 0);
}

/** Carga máxima: base da Espécie + Força × a + Defesa × b + bônus do Mestre (nunca negativa). Pura. */
export function carryCapacity({ base = 0, strength = 0, defense = 0, bonus = 0 } = {}, { perStrength = 1, perDefense = 0.5 } = {}) {
  return Math.max(0, Math.round(((Number(base) || 0) + (Number(strength) || 0) * perStrength + (Number(defense) || 0) * perDefense + (Number(bonus) || 0)) * 100) / 100);
}

/** −% de Deslocamento pelo excesso de peso: 20% acima = 20; o dobro ou mais = 100. Pura. */
export function encumbrancePenalty(weight, capacity) {
  const w = Math.max(0, Number(weight) || 0);
  const cap = Math.max(0, Number(capacity) || 0);
  if (w <= cap) return 0;
  if (!cap) return 100;
  return Math.min(100, Math.round((w / cap - 1) * 100));
}

/** Slots de um Módulo de Porão: tabela do Porte × multiplicador do Módulo. Pura. */
export function cargoSlotsFor(moduleSize, multiplier = 1) {
  return Math.floor((MEU_SISTEMA.CARGO_SLOTS_BY_MODULE_SIZE[moduleSize] ?? 0) * Math.max(0, Number(multiplier ?? 1) || 0));
}

/** Fator de massa da carga no Motor: 1 + peso ÷ carga de referência do Porte. Pura. */
export function cargoMassFactor(weight, reference) {
  const ref = Number(reference) || 0;
  return ref > 0 ? 1 + Math.max(0, Number(weight) || 0) / ref : 1;
}

/**
 * A Munição (`item.system.ammo`) serve neste lançador (`module.system`)? Mesmo tipo, lançador que
 * usa munição e Porte mínimo atendido. Pura.
 */
export function ammoFitsLauncher(ammo, launcher) {
  if (!ammo?.enabled || !launcher?.usesAmmo || !ammo.type) return false;
  if (!(launcher.ammoTypes ?? []).includes(ammo.type)) return false;
  if (!ammo.minLauncherSize) return true;
  return (MEU_SISTEMA.MODULE_SIZE_RANK[launcher.moduleSize] ?? 0) >= (MEU_SISTEMA.MODULE_SIZE_RANK[ammo.minLauncherSize] ?? 0);
}

/**
 * O Porte `sizeId` cabe na faixa da Classe? `sizes` = a lista de Portes do tipo, em ordem.
 * Porte ou limite que não está na lista não restringe nada. Pura.
 */
export function sizeFitsClass(sizeId, vesselClass, sizes) {
  if (!vesselClass) return true;
  const ids = (sizes ?? []).map(s => s.id);
  const index = ids.indexOf(sizeId);
  if (index < 0) return true;
  const min = vesselClass.minSize ? ids.indexOf(vesselClass.minSize) : -1;
  const max = vesselClass.maxSize ? ids.indexOf(vesselClass.maxSize) : -1;
  if (min >= 0 && index < min) return false;
  if (max >= 0 && index > max) return false;
  return true;
}

/** "até Pequeno", "a partir de Grande", "de Médio a Grande" ou "" (sem limite). Pura. */
export function describeClassSizeRange(vesselClass, sizes) {
  const label = id => (sizes ?? []).find(s => s.id === id)?.label ?? "";
  const min = vesselClass?.minSize ? label(vesselClass.minSize) : "";
  const max = vesselClass?.maxSize ? label(vesselClass.maxSize) : "";
  if (min && max) return min === max ? `só ${min}` : `de ${min} a ${max}`;
  if (max) return `até ${max}`;
  if (min) return `a partir de ${min}`;
  return "";
}

/**
 * Quantas vagas uma Categoria tem nesta Nave: a da Classe, se a Classe disser; senão a da
 * Categoria. Distribuição é sempre 1 (somar dois dobraria o teto). Pura.
 * @returns {number} 0 = sem limite de contagem
 */
export function categorySlotLimit(category, vesselClass) {
  if (!category) return 0;
  if (category.role === "distribution") return 1;
  const override = vesselClass?.slots?.[category.id];
  if (override !== undefined && override !== null && override !== "") return Math.max(0, Math.round(Number(override) || 0));
  return category.slots ?? 0;
}

/**
 * A Skill/arma é mágica? Marca explícita manda; no Automático, é mágica quando custa a energia do
 * personagem (Custo ou Custo por rodada) ou tem Dano Mágico. Nave/Veículo nunca (paga com a
 * Bateria). Pura (só lê os campos).
 */
export function isMagicUse(mech, actor) {
  if (!mech) return false;
  if (mech.magicTag === "magic") return true;
  if (mech.magicTag === "mundane") return false;
  if (["starship", "vehicle"].includes(actor?.type)) return false;
  return (Number(mech.cost) || 0) > 0 || (Boolean(mech.hasUpkeep) && (Number(mech.upkeepCost) || 0) > 0) || Boolean(mech.isMagicDamage);
}

/**
 * Custo extra de uma magia sob antimagia de nível `level`: `(custo + base) × (crescimento^nível − 1)`,
 * arredondado pra cima. Nível 0 = 0. Com os padrões (base 10, ×2): uma magia de custo 20 paga +30
 * no nível 1, +90 no 2, +210 no 3. Pura.
 */
export function antimagicSurcharge(cost, level, { base = 10, growth = 2 } = {}) {
  const lvl = Math.max(0, Math.round(Number(level) || 0));
  if (!lvl) return 0;
  const g = Math.max(1, Number(growth) || 1);
  return Math.ceil((Math.max(0, Number(cost) || 0) + Math.max(0, Number(base) || 0)) * (g ** lvl - 1));
}

/**
 * Luz de uma Estrutura ou de um Escudo pessoal, como guardada no catálogo/Efeito: `null` quando
 * não emite luz. `dim`/`bright` em unidades da cena (0 = automático: quem usa decide o raio);
 * `alpha` é a intensidade da cor (0–1); `animation` é uma chave de CONFIG.Canvas.lightAnimations
 * ("" = sem animação), com velocidade e intensidade 1–10 como no editor de luz do Foundry.
 */
export function normalizeLightConfig(raw) {
  if (!raw || typeof raw !== "object" || !raw.enabled) return null;
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const dim = num(raw.dim, 0, 0, 1000);
  const bright = num(raw.bright, 0, 0, 1000);
  return {
    enabled: true,
    color: /^#[0-9a-f]{6}$/i.test(raw.color ?? "") ? raw.color : "#6ee7ff",
    alpha: num(raw.alpha, 0.5, 0, 1),
    dim,
    // Luz forte maior que a fraca não existe no Foundry (a fraca é o limite de fora).
    bright: dim > 0 ? Math.min(bright, dim) : bright,
    animation: typeof raw.animation === "string" ? raw.animation : "",
    speed: Math.round(num(raw.speed, 5, 1, 10)),
    intensity: Math.round(num(raw.intensity, 5, 1, 10))
  };
}

/**
 * Força de uma Skill que aceita variar a Mana, dado `r` = Mana investida ÷ Custo. Abaixo do Custo
 * é proporcional (metade da Mana, metade da força); acima, `r^k` com 0 < k ≤ 1 — sem teto (o
 * personagem "tudo numa explosão" é recompensado), mas cada Mana a mais rende menos que a
 * anterior: o ganho de uma Mana extra tende a zero, e o golpe gigante é ineficiente por Mana.
 */
export function manaInvestmentPower(ratio, exponent = 0.75) {
  const r = Math.max(0, Number(ratio) || 0);
  const k = Math.min(1, Math.max(0.05, Number(exponent) || 0.75));
  return r < 1 ? r : Math.pow(r, k);
}

/**
 * Quanto um Raio Trator segura um alvo (0-1 do deslocamento dele tirado), pela diferença entre o
 * Porte do alvo e o Porte do Módulo (os dois na mesma régua 0-4): mesmo Porte ou menor 100%, um
 * acima 50%, dois 25%, mais que isso nada. O throttle multiplica (sobrecarregar segura mais, até
 * 100%). Pura.
 */
export function tractorHold(moduleRank, targetRank, throttleRatio = 1) {
  const diff = Math.round(Number(targetRank) || 0) - Math.round(Number(moduleRank) || 0);
  const base = diff <= 0 ? 1 : diff === 1 ? 0.5 : diff === 2 ? 0.25 : 0;
  return Math.min(1, Math.max(0, base * Math.max(0, Number(throttleRatio) || 0)));
}

/**
 * Grupo de prioridade de energia (1 = recebe primeiro … 5 = por último), no modelo do Elite
 * Dangerous: cada Módulo tem um grupo, e a tripulação ajusta no chip "P1…P5" da grade de
 * Módulos da Nave. Substituiu a lista ordenada com setas, que crescia uma linha por Módulo e
 * pedia um clique por posição. Valores antigos fora de 1–5 (o padrão 50, ou a numeração
 * 10/20/30 da lista) caem no grupo do meio; 0 vira 1.
 */
export function powerPriorityGroup(value) {
  const n = Math.round(Number(value));
  if (n >= 1 && n <= MEU_SISTEMA.POWER_PRIORITY_GROUPS) return n;
  if (n === 0) return 1;
  return Math.ceil(MEU_SISTEMA.POWER_PRIORITY_GROUPS / 2);
}

/**
 * Fila de prioridade de energia de UMA Nave/Veículo: a lista salva em `system.powerGroups`, em
 * ordem (a primeira recebe energia primeiro), ou os cinco grupos padrão quando a Nave nunca mexeu
 * nela. Os ids padrão são `p1…p5` de propósito: é o que faz um Módulo salvo antes da fila
 * dinâmica (só com o número 1–5 em `powerPriority`) continuar no mesmo lugar. Ids repetidos ou
 * vazios são descartados; nome vazio vira "Prioridade N".
 * @param {Array<{id: string, label: string}>} stored
 * @returns {Array<{id: string, label: string}>}
 */
export function resolvePowerGroups(stored) {
  const seen = new Set();
  const groups = [];
  for (const entry of Array.isArray(stored) ? stored : []) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, label: String(entry.label ?? "").trim() });
  }
  const list = groups.length ? groups : MEU_SISTEMA.DEFAULT_POWER_GROUPS.map(g => ({ ...g }));
  return list.map((g, i) => ({ id: g.id, label: g.label || `Prioridade ${i + 1}` }));
}

/**
 * Posição (0 = primeiro) do grupo de um Módulo na fila. Ordem de busca: o grupo escolhido
 * (`powerGroup`); o grupo padrão do número antigo (`powerPriority` 1–5 → `p1…p5`), se a fila
 * ainda o tiver; e, sem nenhum dos dois, o grupo do meio — mesmo lugar onde caía um Módulo novo
 * antes da fila dinâmica. Um Módulo trazido de outra Nave, com um grupo que não existe aqui, cai
 * no meio também.
 */
export function powerGroupIndex(groups, groupId, legacyPriority) {
  if (!groups.length) return 0;
  const chosen = groupId ? groups.findIndex(g => g.id === groupId) : -1;
  if (chosen >= 0) return chosen;
  const legacy = groups.findIndex(g => g.id === `p${powerPriorityGroup(legacyPriority)}`);
  if (legacy >= 0) return legacy;
  return Math.floor((groups.length - 1) / 2);
}

/** A fila com o grupo `id` trocado de lugar com o vizinho (`step` −1 sobe, +1 desce). Pura. */
export function movePowerGroup(groups, id, step) {
  const list = groups.map(g => ({ ...g }));
  const from = list.findIndex(g => g.id === id);
  const to = from + Math.sign(step);
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}

/**
 * A fila sem o grupo `id`, e para onde vão os Módulos dele: o grupo seguinte, ou o anterior
 * quando era o último. A fila nunca fica vazia — apagar o único grupo não muda nada
 * (`fallbackId: null`).
 * @returns {{groups: Array<{id: string, label: string}>, fallbackId: string|null}}
 */
export function removePowerGroup(groups, id) {
  const index = groups.findIndex(g => g.id === id);
  if (index < 0 || groups.length <= 1) return { groups: groups.map(g => ({ ...g })), fallbackId: null };
  const fallback = groups[index + 1] ?? groups[index - 1];
  return { groups: groups.filter(g => g.id !== id).map(g => ({ ...g })), fallbackId: fallback.id };
}

/**
 * Foco de energia (Escudos/Armas/Motores) com a fila dinâmica: os Módulos da Função em foco vão
 * pro primeiro grupo, e o grupo de onde saíram fica guardado (`moved`) pra voltarem quando o foco
 * mudar — sem isso, focar Escudos e depois Armas deixava os dois no topo pra sempre. Os Módulos
 * das outras Funções voltam ao grupo guardado (se tinham sido movidos) ou ficam onde estão.
 * @param {Array<{id: string, role: string, groupId: string}>} modules  Módulos das três Funções do foco
 * @param {string|null} focusRole  Função em foco, ou null (Equilibrado)
 * @param {string} firstGroupId
 * @param {Record<string, string>} previousMoved  o `moved` do foco anterior
 * @returns {{assign: Record<string, string>, moved: Record<string, string>}}
 */
export function focusGroupAssignments(modules, focusRole, firstGroupId, previousMoved = {}) {
  const assign = {};
  const moved = {};
  for (const module of modules) {
    const home = previousMoved[module.id] ?? module.groupId;
    if (focusRole && module.role === focusRole) {
      assign[module.id] = firstGroupId;
      if (home !== firstGroupId) moved[module.id] = home;
    } else {
      assign[module.id] = home;
    }
  }
  return { assign, moved };
}

/**
 * Estado de um grupo na aba Prioridade: `empty` (ninguém ali pede energia), `full` (recebe tudo),
 * `partial` (recebe parte) ou `none` (não recebe nada — os Módulos dele ficam sem energia).
 */
export function powerGroupState(demand, delivered) {
  if (!(demand > 0)) return "empty";
  if (delivered >= demand) return "full";
  return delivered > 0 ? "partial" : "none";
}

/**
 * O que o card do Grid de Energia mostra desta rodada, a partir de quatro números: quanto os
 * Módulos pedem (`demand`), quanto passa do Reator pelo Distribuidor (`generation` = o menor dos
 * dois), e a reserva (`capacitor` de `capacitorMax`).
 *
 * Com sobra: `slack` vai pra reserva, e `roundsToFull` diz em quantas rodadas ela enche. Com falta:
 * a reserva cobre o que puder (`fromReserve`), o resto é `missing`, e `roundsLeft` diz quantas
 * rodadas inteiras ela aguenta neste ritmo (0 = acaba nesta). `afterReservePercent` é o que a Nave
 * entrega quando a reserva acabar. Mesma conta do tick (`applyPowerGridTick`), só que prevista.
 */
export function powerBudget({ demand, generation, capacitor, capacitorMax }) {
  const d = Math.max(0, Math.round(Number(demand) || 0));
  const g = Math.max(0, Math.round(Number(generation) || 0));
  const c = Math.max(0, Math.round(Number(capacitor) || 0));
  const max = Math.max(0, Math.round(Number(capacitorMax) || 0));
  const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 100);

  if (d <= g) {
    const slack = g - d;
    const room = Math.max(0, max - c);
    return {
      shortage: false, demand: d, generation: g, delivered: d, percent: 100,
      fromReactor: d, fromReserve: 0, missing: 0, slack,
      roundsToFull: room === 0 ? 0 : slack > 0 ? Math.ceil(room / slack) : null,
      roundsLeft: null, afterReservePercent: 100
    };
  }
  const deficit = d - g;
  const fromReserve = Math.min(c, deficit);
  const delivered = g + fromReserve;
  return {
    shortage: true, demand: d, generation: g, delivered, percent: percentOf(delivered, d),
    fromReactor: g, fromReserve, missing: d - delivered, slack: 0,
    roundsToFull: null,
    roundsLeft: c > 0 ? Math.floor(c / deficit) : 0,
    afterReservePercent: percentOf(g, d)
  };
}

/**
 * Divide a energia disponível entre os Módulos por grupo de prioridade: o primeiro grupo inteiro,
 * depois o seguinte… Quando o que sobra não cobre um grupo inteiro, todos os Módulos DESSE grupo
 * recebem a mesma fração (ninguém do mesmo grupo passa na frente do outro), e os grupos seguintes
 * ficam sem nada. Módulo sem demanda recebe 1. `priority` é a POSIÇÃO do grupo na fila (menor
 * recebe primeiro) — quem chama resolve a fila da Nave (ver powerGroupIndex).
 * @param {{id: string, demand: number, priority: number}[]} entries
 * @param {number} available
 * @returns {Map<string, number>} id → fração (0-1)
 */
export function fundByPriority(entries, available) {
  const ratios = new Map();
  const groups = new Map();
  for (const entry of entries) {
    if (!(entry.demand > 0)) {
      ratios.set(entry.id, 1);
      continue;
    }
    const rank = Number(entry.priority);
    const group = Number.isFinite(rank) ? rank : Number.MAX_SAFE_INTEGER;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  let left = Math.max(0, Number(available) || 0);
  for (const group of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(group);
    const need = list.reduce((sum, e) => sum + e.demand, 0);
    const ratio = left >= need ? 1 : left / need;
    for (const e of list) ratios.set(e.id, ratio);
    left = Math.max(0, left - need);
  }
  return ratios;
}

/**
 * A Skill (ou Sub-Skill, ou Habilidade Concedida) ergue uma Estrutura ao ser usada? Aceita as
 * duas formas: a atual (`effectType: "structure"`) e a de 1.37, quando Estrutura era um Tipo de
 * Alvo (`targetType: "structure"`) — uma Skill guardada assim continua funcionando.
 */
export function isStructureMechanic(mech) {
  return mech?.effectType === "structure" || mech?.targetType === "structure";
}

/**
 * Converte a forma de 1.37 (Estrutura como Tipo de Alvo) na atual, no próprio objeto. Usado no
 * `migrateData` das Skills e dos moldes de Habilidade Concedida.
 */
export function migrateStructureTarget(mech) {
  if (mech && typeof mech === "object" && mech.targetType === "structure") {
    mech.effectType = "structure";
    mech.targetType = "targeted";
  }
  return mech;
}

/**
 * Deslocamento por rodada, em metros. Duas partes, de propósito:
 *  - a PERMANENTE (`permanentDexterity` = pontos + Título) sobe 1 m por `step` pontos e para no
 *    `cap`, senão o valor cruzaria o mapa em poucos níveis;
 *  - a de SKILLS (`skillDexterity` = buffDelta temporário) soma por cima, sem teto, e é negativa
 *    quando a Skill reduz Destreza (Lentidão desacelera sem regra nova).
 * Bônus de Item não entra, igual ao resto do sistema. Recebe a configuração por parâmetro para
 * poder ser testada sem Foundry.
 * @returns {{base:number, fromDexterity:number, fromSkills:number, total:number, capped:boolean}}
 */
export function movementAllowance({ permanentDexterity = 0, skillDexterity = 0, percent = 0 } = {}, { base = 6, step = 10, cap = 18 } = {}) {
  const safeBase = Math.max(0, Number(base) || 0);
  const safeStep = Math.max(1, Number(step) || 1);
  // Teto abaixo da base não faz sentido: a base é o piso da parte permanente.
  const ceiling = Math.max(safeBase, Number(cap) || 0);

  const raw = safeBase + Math.floor(Math.max(0, permanentDexterity) / safeStep);
  const permanent = Math.min(raw, ceiling);
  const fromSkills = Math.trunc(skillDexterity / safeStep) || 0;

  // Efeitos percentuais (Lentidão −50%) valem sobre o total, depois da Destreza.
  const factor = Math.max(0, 1 + (Number(percent) || 0) / 100);
  const beforePercent = Math.max(0, permanent + fromSkills);

  return {
    base: safeBase,
    fromDexterity: permanent - safeBase,
    fromSkills,
    percent: Number(percent) || 0,
    total: Math.floor(beforePercent * factor + 1e-9),
    capped: raw >= ceiling
  };
}

/**
 * Quão perto do desempenho de referência do Porte o Motor da nave está (1 = Motor do tamanho
 * esperado, a 100% de throttle, com energia e sem dano). Motor menor, throttle baixo, falta de
 * energia ou dano baixam; overclock sobe. Nave sem Motor (referência ou efetivo zerado) dá 0.
 *
 * Existe porque a Aceleração/Rotação crua dobra a cada Porte de Motor (20 → 320): usada direto,
 * a nave Capital andaria dezesseis vezes mais que a Mini, o oposto do que se quer.
 */
export function engineRatio(effectiveStat, referenceStat) {
  if (!(referenceStat > 0) || !(effectiveStat > 0)) return 0;
  return effectiveStat / referenceStat;
}

/** Casas por rodada de uma nave: base do Porte × razão do Motor, arredondado para baixo. */
export function shipMovementCells(baseCells, ratio) {
  return Math.max(0, Math.floor(baseCells * ratio + 1e-9));
}

/** Evasão de uma nave como fração 0-1 (base do Porte × razão da Rotação), limitada ao teto em %. */
export function shipEvasionFraction(basePercent, ratio, capPercent) {
  return Math.min(Math.max(0, basePercent * ratio), Math.max(0, capPercent)) / 100;
}

/** Texto da ficha para um resultado de `movementAllowance`: o total e de onde ele vem. */
export function describeMovement(movement) {
  if (!movement) return null;
  let text = `${movement.base} base`;
  if (movement.fromDexterity) text += ` + ${movement.fromDexterity} de Destreza${movement.capped ? " (no teto)" : ""}`;
  if (movement.fromSkills) text += ` ${movement.fromSkills > 0 ? "+" : "−"} ${Math.abs(movement.fromSkills)} de Skills`;
  return { total: movement.total, title: `Deslocamento por rodada: ${text}` };
}
