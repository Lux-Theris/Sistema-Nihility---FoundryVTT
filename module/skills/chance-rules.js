/**
 * Progressão por chance (1e, 1.124.0), regras puras e testadas (`test/chance-progression.test.mjs`).
 *
 * O ciclo de níveis de uma Skill era Poder × N → Desconto × M. Para a Skill que tem **alguma chance**, ele ganha um terceiro
 * passo, **Chance × P** (P e os pontos por nível são Regras desta mesa), e a Skill passa a ter um **nível máximo automático**:
 * o nível em que o Desconto chega ao piso E toda chance chega a 100%. Passado o máximo só a Evolução deixa continuar (ou a caixa
 * "Sem limite", só do Mestre, em que todo nível vira Poder).
 *
 * "Chance de uma Skill" (decisão do dono, 17/11 e 26/11):
 *  - a corrente "Saltar entre alvos" (`chainChance`);
 *  - o campo **Chance** de um efeito (40% de deixar Atordoado): `chance` abaixo de 100;
 *  - as chances do **elemento naquela Skill** (Fogo: 20% de Queimadura): sobem só quando o dano vem dela, o catálogo não muda;
 *  - as das Sub-Skills, que sobem junto (conta o nível da Skill-mãe).
 * Cada chance tem uma **chave estável** (`chain`, `effect:<id>`, `element:<id>:<n>`, `sub:<uid>:…`), nunca um índice de lista.
 * Os pontos ganhos moram na Skill-mãe (`chanceBonus: {chave: pontos}`), são ESTADO (como o XP) e ficam fora das listas de cópia.
 *
 * Os números do ciclo (poder, desconto, piso, passos) chegam como argumento (`cfg`): a leitura das Regras da Mesa fica em
 * `core/config/progression.js`. Uma Skill **sem chance** (`chanceNeed = 0`) percorre exatamente o ciclo antigo.
 */

export const DEFAULT_CHANCE_POINTS = 10;
export const MAX_SIMULATED_STEPS = 600;

/* ------------------------------------------------------------------ ids estáveis */

/**
 * Dá um id a cada efeito e a cada Sub-Skill (e aos efeitos delas) que ainda não tem. Não mexe nos que já têm. Devolve só o que
 * mudou, para gravar: `{changed: false}` ou `{changed: true, effects, subSkills}`.
 * @param {{effects?: object[], subSkills?: object[]}} system
 * @param {() => string} makeId - gerador de ids (`foundry.utils.randomID` no jogo, injetável no teste)
 */
export function withStableIds(system, makeId) {
  let changed = false;
  const stampEffects = list =>
    (Array.isArray(list) ? list : []).map(entry => {
      if (!entry || typeof entry !== "object" || entry.id) return entry;
      changed = true;
      return { ...entry, id: makeId() };
    });
  const effects = stampEffects(system?.effects);
  const subSkills = (Array.isArray(system?.subSkills) ? system.subSkills : []).map(sub => {
    if (!sub || typeof sub !== "object") return sub;
    const stamped = { ...sub };
    if (!stamped.uid) {
      stamped.uid = makeId();
      changed = true;
    }
    stamped.effects = stampEffects(sub.effects);
    return stamped;
  });
  return changed ? { changed: true, effects, subSkills } : { changed: false };
}

/* ------------------------------------------------------------------ as chances de uma Skill */

/** A chance de um efeito conta? (0 < chance < 100, fora da Magia enfraquecida, que usa o campo com outro sentido) */
export function entryHasChance(entry) {
  const c = Number(entry?.chance);
  return entry?.target !== "magicDampen" && Number.isFinite(c) && c > 0 && c < 100;
}

/**
 * As chances de UMA mecânica (a Skill ou uma Sub-Skill), cada uma com a chave (com o prefixo dado), a base e o "sentido"
 * (para a Evolução e a Fusão compararem por sentido, não por chave).
 * @param {object} mech
 * @param {string} [prefix] - "" para a Skill; "sub:<uid>:" para uma Sub-Skill
 * @param {(elementId: string) => Array<{n:number, chance:number, conditionId:string}>} [elementChances] - as chances de Condição do elemento no catálogo
 * @returns {Array<{key:string, base:number, kind:string, sense:string, label:string}>}
 */
export function ownChances(mech, prefix = "", elementChances = () => []) {
  const out = [];
  if (Number(mech?.chainChance) > 0 && Number(mech?.strikes) > 1) {
    out.push({ key: `${prefix}chain`, base: Math.min(100, Number(mech.chainChance)), kind: "chain", sense: "chain", label: "Saltar entre alvos" });
  }
  for (const entry of Array.isArray(mech?.effects) ? mech.effects : []) {
    if (!entry?.id || !entryHasChance(entry)) continue;
    out.push({ key: `${prefix}effect:${entry.id}`, base: Math.min(99, Number(entry.chance)), kind: "effect", sense: `effect:${entry.target}:${entry.conditionId || ""}`, label: entry.conditionId || entry.target || "efeito" });
  }
  if (mech?.effectType === "damage") {
    for (const elementId of [...new Set((mech.damageElements ?? []).filter(Boolean))]) {
      for (const c of elementChances(elementId) ?? []) {
        if (!(c.chance > 0 && c.chance < 100)) continue;
        out.push({ key: `${prefix}element:${elementId}:${c.n}`, base: Math.min(99, Number(c.chance)), kind: "element", sense: `element:${elementId}:${c.conditionId || ""}`, label: c.conditionId || elementId });
      }
    }
  }
  return out;
}

/** Todas as chances da Skill: as dela e as das Sub-Skills (que sobem junto com o nível da Skill-mãe). */
export function collectChances(system, elementChances = () => []) {
  const out = ownChances(system, "", elementChances);
  for (const sub of Array.isArray(system?.subSkills) ? system.subSkills : []) {
    if (!sub?.uid) continue;
    out.push(...ownChances(sub, `sub:${sub.uid}:`, elementChances));
  }
  return out;
}

/** Os pontos ganhos numa chave (0 se nenhum). `bonus` é o `chanceBonus` da Skill-mãe. */
export function chanceBonusOf(bonus, key) {
  const n = Number(bonus?.[key]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** O `chanceBonus` de UMA Sub-Skill, com o prefixo `sub:<uid>:` tirado (para ela ler as chaves como se fosse a Skill). */
export function subChanceBonus(bonus, uid) {
  if (!uid) return {};
  const prefix = `sub:${uid}:`;
  const out = {};
  for (const [key, n] of Object.entries(bonus ?? {})) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = n;
  return out;
}

/** A chance em uso: a base mais os pontos ganhos, até 100. */
export function effectiveChance(base, bonus = 0) {
  return Math.min(100, Math.max(0, Math.round((Number(base) || 0) + (Number(bonus) || 0))));
}

/** Quantos níveis de Chance a Skill pede para levar todas as chances a 100%: ⌈Σ(100 − base) ÷ pontos por nível⌉. */
export function chanceLevelsNeeded(chances, pointsPerLevel = DEFAULT_CHANCE_POINTS) {
  const per = Math.max(1, Math.floor(Number(pointsPerLevel) || DEFAULT_CHANCE_POINTS));
  const total = (chances ?? []).reduce((sum, c) => sum + Math.max(0, 100 - (Number(c.base) || 0)), 0);
  return total > 0 ? Math.ceil(total / per) : 0;
}

/**
 * Reparte `points` pontos de chance, um de cada vez, entre as chances que ainda estão abaixo de 100% (sorteio). Ponto que cairia numa
 * chance cheia vai para outra; se todas estão cheias, sobra. Devolve o `chanceBonus` novo, o ganho por chave e quantos se gastaram.
 * @param {Array<{key:string, base:number}>} chances
 * @param {object} bonus - o `chanceBonus` de antes
 * @param {number} points
 * @param {() => number} [random]
 */
export function distributeChancePoints(chances, bonus = {}, points = DEFAULT_CHANCE_POINTS, random = Math.random) {
  const next = { ...(bonus ?? {}) };
  const gains = {};
  let spent = 0;
  for (let p = 0; p < Math.max(0, Math.floor(points)); p++) {
    const open = (chances ?? []).filter(c => effectiveChance(c.base, next[c.key]) < 100);
    if (!open.length) break;
    const pick = open[Math.min(open.length - 1, Math.floor(random() * open.length))];
    next[pick.key] = (Number(next[pick.key]) || 0) + 1;
    gains[pick.key] = (gains[pick.key] || 0) + 1;
    spent++;
  }
  return { bonus: next, gains, spent };
}

/** "Atordoar +6% · Saltar entre alvos +4%": o anúncio do nível com o rótulo de cada chave. */
export function chanceGainsText(gains, labelOf = key => key) {
  return Object.entries(gains ?? {})
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${labelOf(key)} +${n}%`)
    .join(" · ");
}

/** Guarda só o que importa: pontos positivos de chaves que ainda existem (efeito apagado → o bônus dele some). */
export function pruneChanceBonus(bonus, chances) {
  const live = new Set((chances ?? []).map(c => c.key));
  const out = {};
  for (const [key, n] of Object.entries(bonus ?? {})) if (live.has(key) && Number(n) > 0) out[key] = Math.floor(Number(n));
  return out;
}

/* ------------------------------------------------------------------ Evolução e Fusão: a melhor chance */

/**
 * O `chanceBonus` de uma Skill nova (Evolução ou Fusão) que **nunca piora** as chances: cada chance da nova é comparada com a
 * chance do MESMO SENTIDO (a mesma Condição no mesmo tipo de efeito, o Saltar, o mesmo efeito de elemento) nas Skills de
 * origem; fica o bônus que leva a chance ao melhor valor que existia (nunca menos que a base da nova).
 * @param {Array<{chances: Array<{key,base,sense}>, bonus: object}>} sources - as chances (com base) e o bônus de cada Skill de origem
 * @param {Array<{key:string, base:number, sense:string}>} newChances
 */
export function carryOverChanceBonus(sources, newChances) {
  const best = new Map();
  for (const source of sources ?? []) {
    for (const c of source.chances ?? []) {
      const practical = effectiveChance(c.base, source.bonus?.[c.key]);
      if (practical > (best.get(c.sense) ?? 0)) best.set(c.sense, practical);
    }
  }
  const out = {};
  for (const c of newChances ?? []) {
    const wanted = best.get(c.sense) ?? 0;
    const extra = Math.max(0, Math.min(100, wanted) - c.base);
    if (extra > 0) out[c.key] = extra;
  }
  return out;
}

/* ------------------------------------------------------------------ o ciclo de níveis */

/**
 * @typedef {object} CycleConfig
 * @property {number} powerLevels - níveis de Poder por ciclo
 * @property {number} discountLevels - níveis de Desconto por ciclo
 * @property {number} chanceLevels - níveis de Chance por ciclo (P)
 * @property {number} powerStep - fração de Poder por nível (0,10)
 * @property {number} discountStep - fração de Desconto por nível (0,20)
 * @property {number} floor - o piso do Custo (fração, 0,10)
 * @property {number} chanceNeed - níveis de Chance que a Skill pede (0 = sem chance, o ciclo antigo)
 * @property {boolean} hasDiscount - a Skill tem Custo (ou manutenção) que o Desconto corta
 */

function buildCycle(cfg) {
  const power = Math.max(0, Math.round(cfg.powerLevels));
  const discount = cfg.hasDiscount ? Math.max(0, Math.round(cfg.discountLevels)) : 0;
  const chance = cfg.chanceNeed > 0 ? Math.max(0, Math.round(cfg.chanceLevels)) : 0;
  // Sem Custo e sem chance (nada a aprimorar além do Poder): todo nível é Poder (decisão do dono, 26/11).
  if (!cfg.hasDiscount && !(cfg.chanceNeed > 0)) return ["power"];
  return [...Array(power).fill("power"), ...Array(discount).fill("discount"), ...Array(chance).fill("chance")];
}

/**
 * Simula `count` passos do ciclo (do nível 1 até o nível `count + 1`).
 * @returns {{power:number, cost:number, chanceDone:number, kinds:string[], maxLevel:number}}
 *   `kinds[i]` = o que o passo i deu: "power" | "discount" | "chance" | "beyond" (Poder depois do máximo);
 *   `maxLevel` = o menor nível em que Desconto e Chances estão completos (Infinity se não há máximo)
 */
export function simulateCycle(count, cfg) {
  const floor = Math.min(1, Math.max(0, cfg.floor));
  const hasDiscount = Boolean(cfg.hasDiscount) && cfg.discountLevels > 0 ? true : Boolean(cfg.hasDiscount);
  const limited = hasDiscount || cfg.chanceNeed > 0;
  const cycle = buildCycle({ ...cfg, hasDiscount });
  const out = { power: 1, cost: 1, chanceDone: 0, kinds: [], maxLevel: Infinity };
  // Compatibilidade: sem nenhum passo no ciclo antigo (Poder e Desconto em 0) nada muda.
  if (cfg.chanceNeed <= 0 && Math.round(cfg.powerLevels) + Math.round(cfg.discountLevels) <= 0) return out;
  const costAtFloor = () => out.cost <= floor + 1e-9;
  const complete = () => limited && (!hasDiscount || costAtFloor()) && out.chanceDone >= cfg.chanceNeed;
  for (let i = 0; i < count; i++) {
    let kind;
    if (complete()) kind = "beyond";
    else {
      const phase = cycle[i % cycle.length];
      const canDiscount = hasDiscount && !costAtFloor();
      const canChance = out.chanceDone < cfg.chanceNeed;
      if (phase === "discount") kind = canDiscount ? "discount" : canChance ? "chance" : "beyond";
      else if (phase === "chance") kind = canChance ? "chance" : canDiscount ? "discount" : "beyond";
      else kind = "power";
    }
    if (kind === "power" || kind === "beyond") out.power *= 1 + cfg.powerStep;
    else if (kind === "discount") out.cost = Math.max(floor, out.cost * (1 - cfg.discountStep));
    else out.chanceDone++;
    out.kinds.push(kind);
    if (out.maxLevel === Infinity && complete()) out.maxLevel = i + 2;
  }
  return out;
}

/** O que o nível `level` entrega, acumulado: `{power, cost, chanceSteps}` (multiplicadores; 1 = sem alteração). */
export function levelPlan(level, cfg) {
  const steps = Math.max(0, Math.round(Number(level) || 1) - 1);
  const sim = simulateCycle(steps, cfg);
  return { power: sim.power, cost: sim.cost, chanceSteps: sim.chanceDone };
}

/**
 * O nível máximo automático (`skillMaxLevel`): o menor nível em que o Desconto chegou ao piso e toda chance chegou a 100%.
 * `Infinity` quando não há máximo: Skill sem Custo e sem chance (todo nível é Poder).
 */
export function maxLevelFor(cfg) {
  const limited = Boolean(cfg.hasDiscount) || cfg.chanceNeed > 0;
  if (!limited) return Infinity;
  const sim = simulateCycle(MAX_SIMULATED_STEPS, cfg);
  return sim.maxLevel;
}

/**
 * O que o próximo nível (de `level` para `level + 1`) vai dar: "power" | "discount" | "chance" | "beyond" (já no máximo).
 */
export function nextStepKind(level, cfg) {
  const steps = Math.max(1, Math.round(Number(level) || 1));
  return simulateCycle(steps, cfg).kinds[steps - 1] ?? "power";
}

/** A Skill está no nível máximo (ou além)? `unlimited` (a caixa "Sem limite") nunca está. */
export function isAtMaxLevel(level, cfg, { unlimited = false } = {}) {
  if (unlimited) return false;
  return Number(level) >= maxLevelFor(cfg);
}

/** O texto da ficha no máximo: "nível máximo · próximo passo: Evolução". */
export const MAX_LEVEL_TEXT = "nível máximo · próximo passo: Evolução";
