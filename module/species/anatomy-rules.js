/**
 * Anatomia com mecânica (board 5 do canvas "Rework de Espécies") — regras PURAS, testadas.
 *
 * Sem simular órgãos: a Parte da Espécie continua sendo o nível de detalhe, e o que um órgão FAZ é
 * uma Função da parte (visão, manipulação, locomoção…). Uma parte perdida desliga as Funções dela;
 * o catálogo de Funções diz o que isso causa (Condição, Deslocamento, Traço, aviso). Parte não
 * regenera sozinha: isso é das Skills/Condições de Regeneração (partHealing).
 * Implante soma Funções à parte natural (e para se ela for destruída); prótese substitui a parte
 * (a Vida e as Funções passam a ser as dela).
 */

/** Tags antigas das partes (texto livre de antes do rework) → Funções. Funções conhecidas passam direto. */
export function legacyFunctionsFor(tags = [], slot = "", known = []) {
  const knownSet = new Set(known);
  const out = new Set();
  for (const raw of tags ?? []) {
    const tag = String(raw || "").trim();
    if (!tag) continue;
    if (knownSet.has(tag)) out.add(tag);
    else if (tag === "vital") out.add("vital");
    else if (tag === "flight") out.add("voo");
    else if (tag === "sensory") out.add(slot === "head" ? "visao" : "audicao");
    else if (tag === "limb") {
      if (slot === "arm") out.add("manipulacao");
      else if (slot === "leg") out.add("locomocao");
      else if (slot === "tail") out.add("equilibrio");
      else if (slot === "wing") out.add("voo");
    }
  }
  // Toda cabeça vê e ouve, mesmo que o preset antigo só dissesse "vital".
  if (slot === "head") {
    out.add("visao");
    out.add("audicao");
  }
  return [...out];
}

/** O implante cabe neste slot? Lista vazia = cabe em qualquer parte. */
export function implantFits(implant, slot) {
  const slots = (implant?.fitsSlots ?? []).filter(Boolean);
  return !slots.length || slots.includes(slot);
}

/**
 * Funções efetivas de uma parte e quanto ela "vale" agora (0 = perdida).
 * @param {{hpValue:number, hpMax:number, functions:string[], isProsthetic:boolean, mods?:Array<{kind?:string, functions?:string[]}>}} part
 * @param {boolean} woundedByHp - parte ferida conta pela Vida
 */
export function partFunctions(part) {
  const mods = part?.mods ?? [];
  const prosthesis = mods.find(m => m.kind === "prosthesis");
  // Prótese com Funções declaradas manda; prótese antiga (só o interruptor) mantém as naturais.
  const base = part?.isProsthetic && prosthesis?.functions?.length ? prosthesis.functions : part?.functions ?? [];
  const implants = mods.filter(m => m.kind !== "prosthesis").flatMap(m => m.functions ?? []);
  return [...new Set([...base, ...implants])];
}

function partWeight(part, woundedByHp) {
  const max = Number(part?.hpMax) || 0;
  const value = Number(part?.hpValue) || 0;
  if (value <= 0) return 0;
  if (!woundedByHp || max <= 0) return 1;
  return Math.min(1, value / max);
}

/**
 * Estado do corpo a partir das partes e do catálogo de Funções.
 * @param {Array} parts - `{id, name, slot, hpValue, hpMax, functions, isProsthetic, mods}`
 * @param {Array} catalog - Funções (ver DEFAULT_BODY_FUNCTIONS)
 * @returns {{functions: object, conditions: Array, removedTraits: string[], movement: {factor:number, crawl:number|null}, vitalLost: Array}}
 */
export function bodyFunctionState(parts = [], catalog = []) {
  const byFunction = {};
  for (const fn of catalog) {
    const holders = parts.filter(p => partFunctions(p).includes(fn.id));
    const weights = holders.map(p => partWeight(p, Boolean(fn.woundedByHp)));
    const lostParts = holders.filter(p => (Number(p.hpValue) || 0) <= 0);
    byFunction[fn.id] = {
      total: holders.length,
      working: weights.reduce((a, b) => a + b, 0),
      lost: lostParts.length,
      lostParts: lostParts.map(p => ({ id: p.id, name: p.name })),
      holders: holders.map(p => p.id)
    };
  }

  const triggered = fn => {
    const st = byFunction[fn.id];
    if (!st?.total) return false;
    if (fn.count === "once") return st.lost >= st.total;
    return st.lost >= 1;
  };

  const conditions = [];
  const removedTraits = [];
  const vitalLost = [];
  let factor = 1;
  let crawl = null;

  for (const fn of catalog) {
    const st = byFunction[fn.id];
    const effect = fn.effect ?? {};
    if (!st?.total) continue;
    if (effect.kind === "condition" && effect.conditionId && triggered(fn)) conditions.push({ functionId: fn.id, conditionId: effect.conditionId, count: st.lost, label: fn.label });
    if (effect.kind === "removeTrait" && effect.traitId && triggered(fn)) removedTraits.push(effect.traitId);
    if (effect.kind === "notify" && st.lost) vitalLost.push(...st.lostParts.map(p => ({ ...p, functionId: fn.id })));
    if (effect.kind === "movement") {
      const ratio = st.total ? st.working / st.total : 1;
      factor = Math.min(factor, ratio);
      if (st.working <= 0) {
        const crawlFn = effect.crawlFunction ? byFunction[effect.crawlFunction] : null;
        // Sem nenhuma parte que ande: arrasta-se (ex.: com os braços) se a Função de arrastar ainda funciona.
        const canCrawl = crawlFn ? crawlFn.working > 0 : false;
        crawl = canCrawl ? Math.max(0, Number(effect.crawlMeters) || 0) : 0;
      }
    }
  }

  return { functions: byFunction, conditions, removedTraits, movement: { factor, crawl }, vitalLost };
}

/** Deslocamento final: proporcional; sem pernas, o mínimo de arrastar (ou 0). */
export function injuredMovement(total, movement) {
  if (!movement) return total;
  if (movement.crawl !== null && movement.crawl !== undefined) return movement.crawl;
  return Math.floor((Number(total) || 0) * Math.max(0, Math.min(1, movement.factor ?? 1)) + 1e-9);
}

/* ------------------------------------------------------------------ Vida da parte em %, estados, golpe e cura */

/** % da Vida máxima de uma parte pelo slot (tabela PART_HP_PERCENT_BY_SLOT); slot sem linha usa `default`. */
export function partHpPercentForSlot(slot, table = {}) {
  const value = table?.[slot] ?? table?.default;
  return Math.max(0, Number(value) || 0);
}

/** Vida máxima de uma parte com `percent` % da Vida máxima `actorMax` (nunca menos de 1). */
export function partMaxFromPercent(actorMax, percent) {
  return Math.max(1, Math.round(((Number(actorMax) || 0) * (Number(percent) || 0)) / 100));
}

/**
 * Vida e estado de uma parte. Com `hpPercent` > 0, o máximo é esse % da Vida máxima do personagem
 * (com buffs) e o que fica salvo é a PROPORÇÃO (`integrity`, 0–1): subir de nível ou ganhar um buff
 * de Vida aumenta o máximo e mantém a proporção, sem ferir nem curar a parte. Sem %, é a Vida fixa
 * de antes (`hpValue`/`hpMax`). Perdida (`lost`) vale 0 e só não vale numa prótese — a prótese é
 * que está no lugar do coto.
 * @returns {{max:number, value:number, state:"intact"|"damaged"|"destroyed"|"lost"}}
 */
export function resolvePartVitals(part = {}, actorMax = 0) {
  const percent = Number(part.hpPercent) || 0;
  let max;
  let value;
  if (percent > 0) {
    max = partMaxFromPercent(actorMax, percent);
    const integrity = Math.min(1, Math.max(0, Number(part.integrity ?? 1)));
    value = Math.round(integrity * max);
  } else {
    max = Math.max(0, Number(part.hpMax) || 0);
    value = Math.min(max, Math.max(0, Number(part.hpValue) || 0));
  }
  if (part.lost && !part.isProsthetic) return { max, value: 0, state: "lost" };
  const state = value <= 0 ? "destroyed" : value < max ? "damaged" : "intact";
  return { max, value, state };
}

/**
 * Parte atingida por um golpe sem mira: sorteada com chance proporcional ao tamanho (Vida máxima)
 * — o Tronco apanha mais que a Cauda. Partes perdidas não entram. `rng` devolve [0, 1).
 * @param {Array<{id:string, max:number, state:string}>} parts
 * @returns {string|null} id da parte
 */
export function pickHitPart(parts = [], rng = Math.random) {
  const pool = parts.filter(p => p.state !== "lost" && (Number(p.max) || 0) > 0);
  const total = pool.reduce((sum, p) => sum + Number(p.max), 0);
  if (!total) return null;
  let roll = rng() * total;
  for (const p of pool) {
    roll -= Number(p.max);
    if (roll < 0) return p.id;
  }
  return pool[pool.length - 1].id;
}

/**
 * Dano numa parte. A parte vai até 0 (Inutilizada); vira Perdida quando o golpe passa do 0 com
 * sobra ≥ `lossOverflow` % da Vida dela, ou quando o golpe tem Decepar (`sever`) e chega no 0.
 * Prótese nunca vira Perdida (quebra e espera Reparo).
 * @param {{value:number, max:number, isProsthetic?:boolean, lost?:boolean}} part
 * @param {number} amount
 * @param {{lossOverflow?:number, sever?:boolean}} [options]
 * @returns {{value:number, lost:boolean, overflow:number}}
 */
export function partDamage(part, amount, { lossOverflow = 50, sever = false } = {}) {
  const max = Math.max(0, Number(part?.max) || 0);
  const value = Math.max(0, Number(part?.value) || 0);
  const hit = Math.max(0, Math.round(Number(amount) || 0));
  const next = Math.max(0, value - hit);
  const overflow = Math.max(0, hit - value);
  if (part?.isProsthetic) return { value: next, lost: false, overflow };
  const byOverflow = lossOverflow > 0 && max > 0 && overflow > 0 && overflow >= (max * lossOverflow) / 100;
  const bySever = Boolean(sever) && next === 0 && hit > 0;
  return { value: next, lost: Boolean(part?.lost) || byOverflow || bySever, overflow };
}

/**
 * Esta cura consegue consertar a parte? Pelo tipo:
 *  - "descanso": só parte natural FERIDA (acima de 0%) — inutilizada/perdida/prótese esperam Cura,
 *    Regeneração ou Reparo;
 *  - "cura": partes naturais feridas ou inutilizadas (nunca a perdida nem a prótese);
 *  - "regeneracao": as naturais, inclusive as perdidas (voltam a crescer); com `repairsProsthesis`
 *    (Skill Única ou Ultimate) também as próteses;
 *  - "reparo": só próteses.
 */
export function partHealable(part, kind = "cura", { repairsProsthesis = false, regrowLost = false, partFactor = null } = {}) {
  const max = Number(part?.max) || 0;
  if (max <= 0) return false;
  // Parte com a cura totalmente bloqueada (maldição presa nela, de nível alto o bastante).
  if (partFactor && partFactor[part.id] !== undefined && !(partFactor[part.id] > 0)) return false;
  const lost = part.state === "lost";
  const value = lost ? 0 : Math.max(0, Number(part.value) || 0);
  if (!lost && value >= max) return false;
  if (part.isProsthetic) return kind === "reparo" || (kind === "regeneracao" && repairsProsthesis);
  if (kind === "descanso") return !lost && value > 0;
  // Cura de nível alto (Regra da Mesa, padrão 10) também refaz a perdida.
  if (lost) return kind === "regeneracao" || (kind === "cura" && regrowLost);
  return kind === "cura" || kind === "regeneracao";
}

/**
 * Até onde esta cura leva a Vida (fração da Vida máxima): uma parte a 0% que ela NÃO consegue
 * consertar bloqueia o % dela (braço perdido de 20% = a Cura e o Descanso param em 80%; uma
 * Regeneração, que refaz o braço, não para). `share` de cada parte = % da Vida máxima.
 * @param {Array<{max:number, value:number, state:string, isProsthetic?:boolean, share?:number}>} parts
 * @param {number} actorMax
 */
export function healCap(parts = [], actorMax = 0, kind = "cura", options = {}) {
  let blocked = 0;
  for (const p of parts) {
    const atZero = p.state === "lost" || (Number(p.value) || 0) <= 0;
    if (!atZero || partHealable(p, kind, options)) continue;
    const share = p.share !== undefined ? Number(p.share) || 0 : actorMax > 0 ? ((Number(p.max) || 0) / actorMax) * 100 : 0;
    blocked += share;
  }
  return Math.max(0, Math.min(1, 1 - blocked / 100));
}

/**
 * Para onde vai a cura nas partes: o que a Vida DE FATO subiu (`pool`, em pontos — a Vida da parte é
 * % da Vida máxima, mesma unidade) é repartido entre as partes que esta cura conserta. Com `focusId`
 * (Skill de cura focada numa parte), essa parte enche primeiro; o resto vai proporcional ao que falta
 * em cada uma — com um membro só ferido, tudo vai para ele; com o corpo todo, cada um recebe um pouco.
 * `blocked` (Regeneração bloqueada) = nada.
 * @param {Array<{id:string, max:number, value:number, state:string, isProsthetic?:boolean}>} parts
 * @param {number} pool
 * @param {{kind?:string, repairsProsthesis?:boolean, blocked?:boolean, focusId?:string|null}} [options]
 * @returns {Array<{id:string, value:number, regrow:boolean}>}
 */
export function partHealing(parts = [], pool = 0, { kind = "cura", repairsProsthesis = false, blocked = false, focusId = null, regrowLost = false, partFactor = null } = {}) {
  let left = Math.max(0, Math.round(Number(pool) || 0));
  if (!left || (kind === "regeneracao" && blocked)) return [];
  const eligible = parts
    .filter(p => partHealable(p, kind, { repairsProsthesis, regrowLost, partFactor }))
    .map(p => {
      const lost = p.state === "lost";
      const value = lost ? 0 : Math.max(0, Number(p.value) || 0);
      return { id: p.id, max: Number(p.max), value, lost, gain: 0 };
    });
  if (!eligible.length) return [];
  const missing = e => e.max - e.value - e.gain;

  const focus = focusId ? eligible.find(e => e.id === focusId) : null;
  if (focus) {
    focus.gain = Math.min(left, missing(focus));
    left -= focus.gain;
  }
  const rest = eligible.filter(e => missing(e) > 0);
  const totalMissing = rest.reduce((sum, e) => sum + missing(e), 0);
  if (left > 0 && totalMissing > 0) {
    if (left >= totalMissing) {
      for (const e of rest) e.gain += missing(e);
    } else {
      // Proporcional ao que falta, em inteiros: arredonda para baixo e entrega as sobras às maiores frações.
      const shares = rest.map(e => ({ e, exact: (missing(e) * left) / totalMissing }));
      let given = 0;
      for (const sh of shares) {
        sh.floor = Math.floor(sh.exact);
        given += sh.floor;
      }
      shares.sort((a, b) => b.exact - b.floor - (a.exact - a.floor));
      for (const sh of shares) {
        sh.e.gain += sh.floor + (given < left ? 1 : 0);
        if (given < left) given++;
      }
    }
  }
  // Bloqueio de cura preso numa parte: ela recebe só a fração que passa (o resto se perde).
  if (partFactor) for (const e of eligible) if (partFactor[e.id] !== undefined) e.gain = Math.floor(e.gain * Math.max(0, Math.min(1, partFactor[e.id])));
  return eligible
    .filter(e => e.gain > 0)
    .map(e => ({ id: e.id, value: Math.min(e.max, e.value + e.gain), regrow: e.lost }));
}

/**
 * Descanso (Curto/Completo) — tudo puro:
 *  - Vida: Curto soma `shortHpPercent` % da máxima, Completo enche; partes a 0% bloqueiam o % delas
 *    (healCap "descanso") e a Vida nunca desce;
 *  - Mana: Curto soma `shortEnergyPercent` %, Completo enche;
 *  - partes feridas recebem o que a Vida de fato subiu, proporcional ao que falta (partHealing).
 * @param {{hp:{value:number,max:number}, energy:{value:number,max:number}, parts?:Array, kind:"short"|"long", shortHpPercent?:number, shortEnergyPercent?:number, injury?:boolean}} input
 */
export function restOutcome({ hp, energy, parts = [], kind = "short", shortHpPercent = 25, shortEnergyPercent = 50, injury = false, bodyFactor = 1, partFactor = null }) {
  const hpMax = Math.max(0, Number(hp?.max) || 0);
  const hpNow = Math.max(0, Number(hp?.value) || 0);
  const cap = injury ? healCap(parts, hpMax, "descanso", { partFactor }) : 1;
  const ceiling = Math.floor(hpMax * cap + 1e-9);
  const wanted = kind === "long" ? hpMax : hpNow + Math.round((hpMax * shortHpPercent) / 100);
  // Bloqueio de cura no corpo todo (nível 0 do Descanso: uma maldição "toda cura" segura tudo).
  const reach = Math.max(hpNow, Math.min(wanted, ceiling));
  const hpNext = hpNow + Math.floor((reach - hpNow) * Math.max(0, Math.min(1, Number(bodyFactor ?? 1))));
  const enMax = Math.max(0, Number(energy?.max) || 0);
  const enNow = Math.max(0, Number(energy?.value) || 0);
  const enNext = kind === "long" ? enMax : Math.min(enMax, enNow + Math.round((enMax * shortEnergyPercent) / 100));
  const healed = injury ? partHealing(parts, hpNext - hpNow, { kind: "descanso", partFactor }) : [];
  return { hp: hpNext, energy: Math.max(enNow, enNext), cap, healedParts: healed };
}
