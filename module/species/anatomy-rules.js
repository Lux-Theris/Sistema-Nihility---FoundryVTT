/**
 * Anatomia com mecânica (board 5 do canvas "Rework de Espécies") — regras PURAS, testadas.
 *
 * Sem simular órgãos: a Parte da Espécie continua sendo o nível de detalhe, e o que um órgão FAZ é
 * uma Função da parte (visão, manipulação, locomoção…). Uma parte perdida desliga as Funções dela;
 * o catálogo de Funções diz o que isso causa (Condição, Deslocamento, Traço, aviso, regeneração).
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
    else if (tag === "regenerative") out.add("regenerativa");
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
 * @returns {{functions: object, conditions: Array, removedTraits: string[], movement: {factor:number, crawl:number|null}, vitalLost: Array, regen: Array}}
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
  const regen = [];
  let factor = 1;
  let crawl = null;

  for (const fn of catalog) {
    const st = byFunction[fn.id];
    const effect = fn.effect ?? {};
    if (!st?.total) continue;
    if (effect.kind === "condition" && effect.conditionId && triggered(fn)) conditions.push({ functionId: fn.id, conditionId: effect.conditionId, count: st.lost, label: fn.label });
    if (effect.kind === "removeTrait" && effect.traitId && triggered(fn)) removedTraits.push(effect.traitId);
    if (effect.kind === "notify" && st.lost) vitalLost.push(...st.lostParts.map(p => ({ ...p, functionId: fn.id })));
    if (effect.kind === "regen") {
      for (const p of parts) {
        if (!st.holders.includes(p.id)) continue;
        const max = Number(p.hpMax) || 0;
        const value = Number(p.hpValue) || 0;
        if (value > 0 && value < max) regen.push({ id: p.id, amount: Math.min(max - value, Math.max(1, Math.ceil((max * (Number(effect.value) || 0)) / 100))) });
      }
    }
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

  return { functions: byFunction, conditions, removedTraits, movement: { factor, crawl }, vitalLost, regen };
}

/** Deslocamento final: proporcional; sem pernas, o mínimo de arrastar (ou 0). */
export function injuredMovement(total, movement) {
  if (!movement) return total;
  if (movement.crawl !== null && movement.crawl !== undefined) return movement.crawl;
  return Math.floor((Number(total) || 0) * Math.max(0, Math.min(1, movement.factor ?? 1)) + 1e-9);
}
