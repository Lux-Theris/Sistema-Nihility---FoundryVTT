/**
 * Regras puras de dano: divisão por elemento, Penetração, Imunidade, Dano Absoluto, Escala e o
 * efeito padrão das Condições. Nada aqui toca Actor/Item/canvas — quem chama (skill-effects.js)
 * monta os números e grava o resultado. Tudo testado em test/rules.test.mjs.
 *
 * **Por que dividir por elemento:** antes, a Resistência de cada elemento era aplicada sobre o
 * golpe INTEIRO, uma depois da outra. Um golpe Fogo+Gelo contra alguém imune a Fogo dava 0,
 * inclusive a parte de Gelo. Agora o dano é dividido em partes iguais entre os elementos do
 * ataque, e cada parte sofre só as defesas que valem pra ela.
 */

/**
 * Divide um total em partes iguais, uma por elemento. Sem elemento, uma parte só (`null`).
 * @returns {Array<{elementId: string|null, raw: number}>}
 */
export function splitDamageParts(total, elementIds = []) {
  const ids = [...new Set((elementIds ?? []).filter(Boolean))];
  const safeTotal = Math.max(0, Number(total) || 0);
  if (!ids.length) return [{ elementId: null, raw: safeTotal }];
  return ids.map(elementId => ({ elementId, raw: safeTotal / ids.length }));
}

/**
 * Aplica as defesas do alvo a cada parte do dano.
 *
 * Por parte, na ordem: bônus do atacante (ex.: Pólaron contra Orgânico) → Defesa Mágica (só se o
 * golpe for mágico) → Resistência Geral → Resistência do elemento. A **Penetração** da parte
 * reduz cada uma dessas defesas proporcionalmente (Penetração 30% transforma 50% de Resistência
 * em 35%), mas **nunca atravessa Imunidade**: Resistência de 100% ou mais zera a parte.
 *
 * **Dano Absoluto** é o dano INTEIRO, não importa quais elementos venham junto no golpe: ignora
 * Defesa Mágica, Resistências e Imunidade, e os elementos também não o aumentam (o bônus contra
 * Traço não entra). A divisão em partes continua só pra saber de que elemento é cada pedaço (as
 * Condições do elemento ao acertar ainda podem disparar).
 *
 * @param {object} input
 * @param {Array<{elementId:string|null, raw:number, penetration?:number, bonus?:number}>} input.parts
 *   - `penetration` e `bonus` como fração (0.3 = 30%)
 * @param {number} [input.magicDefense=0] - fração (0-1); já zerada por quem chama se não for mágico
 * @param {number} [input.general=0] - fração (0-1)
 * @param {(elementId:string) => number} [input.resistanceFor] - fração do elemento (1 = Imunidade)
 * @param {boolean} [input.absolute=false]
 * @returns {{final:number, parts:Array<{elementId, raw, final, blockedGeneral, blockedElement}>}}
 */
export function resolveDamageParts({ parts, magicDefense = 0, general = 0, resistanceFor = () => 0, absolute = false }) {
  const results = (parts ?? []).map(part => {
    const base = Math.max(0, Number(part.raw) || 0);
    if (absolute) return { elementId: part.elementId, raw: base, final: base, beforeAffinity: base, blockedGeneral: 0, blockedElement: 0 };
    // Vantagem do elemento da parte contra o elemento do corpo do alvo (Fogo contra quem virou Gelo).
    const affinity = Math.max(0, Number(part.affinity ?? 1));
    const raw = base * (1 + Math.max(0, Number(part.bonus) || 0));

    const penetration = Math.min(1, Math.max(0, Number(part.penetration) || 0));
    const elementResist = part.elementId ? Math.max(0, Number(resistanceFor(part.elementId)) || 0) : 0;
    if (elementResist >= 1) {
      return { elementId: part.elementId, raw, final: 0, beforeAffinity: 0, blockedGeneral: 0, blockedElement: raw, immune: true };
    }

    const soften = value => Math.min(1, Math.max(0, value)) * (1 - penetration);
    let remaining = raw * (1 - soften(magicDefense));
    const beforeGeneral = remaining;
    remaining *= 1 - soften(general);
    const blockedGeneral = beforeGeneral - remaining;
    const beforeElement = remaining;
    remaining *= 1 - soften(elementResist);
    const blockedElement = beforeElement - remaining;

    return { elementId: part.elementId, raw, final: remaining * affinity, beforeAffinity: remaining, blockedGeneral, blockedElement };
  });

  const final = Math.max(0, Math.floor(results.reduce((sum, p) => sum + p.final, 0) + 1e-9));
  // O que chega num Escudo antes da vantagem contra o CORPO (o Escudo tem a vantagem dele).
  const shieldBase = Math.max(0, Math.floor(results.reduce((sum, p) => sum + p.beforeAffinity, 0) + 1e-9));
  return { final, shieldBase, parts: results };
}

/**
 * Multiplicador de Escala entre quem ataca e quem é atingido: o fator elevado à diferença de
 * degraus. Pistola (Pessoal, 0) contra Nave (2) com fator 10: ÷100. Canhão de Nave contra
 * Personagem: ×100. Mesma escala: 1.
 */
export function scaleMultiplier(attackIndex, targetIndex, factor = 10) {
  const a = Number.isInteger(attackIndex) ? attackIndex : 0;
  const t = Number.isInteger(targetIndex) ? targetIndex : 0;
  const f = Number(factor) > 0 ? Number(factor) : 1;
  return Math.pow(f, a - t);
}

/**
 * Transforma o efeito padrão de uma Condição (ver `DEFAULT_STATUS_CONDITIONS`) numa entrada de
 * efeito pronta pra aplicar, com o valor já calculado. `null` quando a Condição não tem efeito
 * padrão (fica só o ícone) ou quando o valor sai zero.
 *
 * Formas de valor:
 *  - `fixed`: o número escrito;
 *  - `hitPercent`: % do dano do golpe que aplicou (depois das defesas). Sem golpe (marcação à
 *    mão, Skill que não causa dano), não há de onde tirar o valor e o efeito fica só o ícone;
 *  - `maxPercent`: % da Vida (ou Mana) máxima do alvo.
 *
 * @param {object} condition - entrada do catálogo de Condições
 * @param {{hitDamage?:number, targetMax?:{hp:number, energy:number}, attributeTotal?:(key:string)=>number, movementTotal?:number}} ctx
 * @returns {{target:string, amount:number, periodic:boolean, durationRounds:number, tickUnit:string, conditionId:string}|null}
 */
export function resolveConditionEffect(condition, ctx = {}) {
  const effect = condition?.effect;
  if (!effect?.kind) return null;
  const rounds = Math.max(1, Math.round(Number(effect.durationRounds) || 1));
  const value = Number(effect.value) || 0;
  if (!value) return null;

  if (effect.kind === "tick") {
    // Vida/Mana de Personagem, ou Casco/Integridade de Nave. "Vida" numa Nave vira Integridade
    // (quem aplica troca — ver applyEffectsToActor).
    const target = ["energy", "shipCasco", "shipHull"].includes(effect.tickTarget) ? effect.tickTarget : "hp";
    let magnitude;
    if (effect.valueMode === "hitPercent") {
      if (!(ctx.hitDamage > 0)) return null;
      magnitude = (ctx.hitDamage * value) / 100;
    } else if (effect.valueMode === "maxPercent") {
      magnitude = ((ctx.targetMax?.[target] ?? 0) * value) / 100;
    } else {
      magnitude = value;
    }
    magnitude = Math.max(1, Math.round(Math.abs(magnitude)));
    const amount = effect.tickSign === "heal" ? magnitude : -magnitude;
    return { target, amount, periodic: true, durationRounds: rounds, tickUnit: effect.tickUnit === "manual" ? "manual" : "combatRound", conditionId: condition.id };
  }

  if (effect.kind === "modifier") {
    const target = effect.modTarget || "dexterity";
    let amount;
    if (target === "movement") {
      // Deslocamento é sempre percentual: −50% vale igual pra quem anda 6 m ou 20 m.
      amount = Math.round(value);
    } else if (effect.modMode === "percent") {
      const base = Number(ctx.attributeTotal?.(target)) || 0;
      amount = Math.round((base * value) / 100);
    } else {
      amount = Math.round(value);
    }
    if (!amount) return null;
    return { target, amount, periodic: false, durationRounds: rounds, tickUnit: "combatRound", conditionId: condition.id };
  }

  return null;
}

/**
 * Reaplicar a mesma Condição **renova** o contador, sem somar: a duração vira a maior entre o que
 * restava e a nova, e o valor fica o mais forte (maior em módulo) — um golpe fraco não pode
 * enfraquecer uma Queimadura forte.
 * @returns {{rounds:number, amount:number}}
 */
export function refreshReapplication(current, incoming) {
  const rounds = Math.max(Number(current?.rounds) || 0, Number(incoming?.rounds) || 0);
  const a = Number(current?.amount) || 0;
  const b = Number(incoming?.amount) || 0;
  return { rounds, amount: Math.abs(b) > Math.abs(a) ? b : a };
}

/** Rola uma chance em %: 100 ou mais sempre acontece, 0 ou menos nunca. `random` é injetável pra teste. */
export function rollChance(percent, random = Math.random) {
  const p = Number(percent);
  if (!(p > 0)) return false;
  if (p >= 100) return true;
  return random() * 100 < p;
}

/**
 * Escudo mantido por uma Skill Ativa (ex.: Barreiras Múltiplas): quanto entra agora. Com teto
 * (`cap` > 0), nunca passa do teto no total do Escudo — Escudo de outra fonte acima dele fica, só
 * não ganha mais. Sem teto, entra tudo.
 * @returns {number} quanto somar ao Escudo
 */
export function sustainedShieldGain(current, amount, cap = 0) {
  const now = Math.max(0, Number(current) || 0);
  const add = Math.max(0, Math.round(Number(amount) || 0));
  const ceiling = Math.max(0, Number(cap) || 0);
  if (!ceiling) return add;
  return Math.max(0, Math.min(add, ceiling - now));
}


/**
 * Uma camada da Nave (Escudo ou Casco) segurando a parte do golpe que mira nela. `multiplier` é o
 * % por camada do elemento (Phaser +20% no Escudo = 1,2; Torpedo −50% = 0,5): a camada sofre
 * `base × multiplier`, mas o que ela segura é contado na moeda do golpe, pra o que vaza seguir
 * pra próxima camada sem o multiplicador desta. Multiplicador 0 = a camada segura tudo sem sofrer
 * nada (enquanto tiver algum valor).
 * @returns {{absorbed: number, leaked: number}} `absorbed` na Vida da camada; `leaked` na moeda do golpe
 */
export function absorbLayer(base, pool, multiplier = 1) {
  const b = Math.max(0, Number(base) || 0);
  const p = Math.max(0, Number(pool) || 0);
  const m = Math.max(0, Number(multiplier) || 0);
  if (b <= 0 || p <= 0) return { absorbed: 0, leaked: b };
  if (m === 0) return { absorbed: 0, leaked: 0 };
  const effective = b * m;
  if (effective <= p) return { absorbed: Math.floor(effective), leaked: 0 };
  return { absorbed: Math.floor(p), leaked: Math.max(0, b - p / m) };
}

/**
 * Cascata de dano de Nave (Evasão → Escudo → Casco → Integridade Estrutural), só a conta.
 *
 * - **Evasão:** a fração do tiro que não chega. Vale até contra Dano Absoluto.
 * - **Redução de dano** ("Preparar para impacto"): fração tirada do que chegou. Não vale contra
 *   Absoluto (é resistir, e Absoluto não se resiste).
 * - **Dano Absoluto:** o dano inteiro vai direto pra Integridade — sem bônus, sem % por camada.
 * - **Bônus** do elemento contra os Traços da Nave, depois.
 * - **Escudo:** a Penetração da arma, menos a Resistência à Penetração do Escudo, decide quanto
 *   passa direto; o resto é segurado pelo Escudo (com o % de Escudo do elemento) até o valor dele.
 * - **Casco** (só enquanto tiver Vida): primeiro a Redução do Casco, depois a Penetração menos a
 *   Resistência à Penetração do Casco, e o % de Casco do elemento.
 * - **Integridade Estrutural:** o que sobrou, vezes o % de Integridade do elemento.
 *
 * @param {object} input - frações (0.3 = 30%) e multiplicadores (1 = normal)
 * @returns {{toShield: number, toCasco: number, toHull: number}}
 */
export function resolveShipCascade({
  damage,
  evasion = 0,
  damageReduction = 0,
  absolute = false,
  bonus = 0,
  penetration = 0,
  shield = {},
  casco = {},
  hullMultiplier = 1
}) {
  const clamp01 = v => Math.min(1, Math.max(0, Number(v) || 0));
  let d = Math.floor(Math.max(0, Number(damage) || 0) * (1 - clamp01(evasion)));
  if (absolute) return { toShield: 0, toCasco: 0, toHull: d, adapted: 0 };
  d = d * (1 - clamp01(damageReduction)) * (1 + Math.max(0, Number(bonus) || 0));
  // Escudo adaptativo: enquanto o Escudo está de pé, o golpe inteiro cai pela adaptação àquele
  // elemento + frequência (nunca mais que 95%: sempre passa algo).
  const adaptation = (Number(shield.value) || 0) > 0 ? Math.min(0.95, clamp01(shield.adaptation)) : 0;
  const adapted = d * adaptation;
  d -= adapted;

  const pen = clamp01(penetration);
  // Escudo
  const penShield = clamp01(pen - clamp01(shield.penResist));
  const shieldTargeted = d * (1 - penShield);
  const shieldStage = absorbLayer(shieldTargeted, shield.value, shield.multiplier ?? 1);
  let remaining = d - shieldTargeted + shieldStage.leaked;

  // Casco
  let toCasco = 0;
  if ((Number(casco.value) || 0) > 0 && remaining > 0) {
    const afterReduction = remaining * (1 - clamp01(casco.reduction));
    const penCasco = clamp01(pen - clamp01(casco.penResist));
    const cascoTargeted = afterReduction * (1 - penCasco);
    const cascoStage = absorbLayer(cascoTargeted, casco.value, casco.multiplier ?? 1);
    toCasco = cascoStage.absorbed;
    remaining = afterReduction - cascoTargeted + cascoStage.leaked;
  }

  const toHull = Math.max(0, Math.floor(remaining * Math.max(0, Number(hullMultiplier) || 0) + 1e-9));
  return { toShield: shieldStage.absorbed, toCasco, toHull, adapted: Math.floor(adapted + 1e-9) };
}

/* ------------------------------------------------------------------ Vantagem entre elementos */

/**
 * Níveis da tabela de vantagens (estilo Pokémon): −2 Imune, −1 Ineficaz, 0 Neutro, 1 Efetivo,
 * 2 Super efetivo. Cada nível vira um multiplicador (Regras da Mesa).
 */
export const AFFINITY_LEVELS = [-2, -1, 0, 1, 2];

/** Nível válido (−2..2), arredondado. Pura. */
export function clampAffinityLevel(level) {
  return Math.min(2, Math.max(-2, Math.round(Number(level) || 0)));
}

/** Clique na tabela: esquerdo sobe um nível (`+1`), direito desce (`−1`), sem passar dos extremos. Pura. */
export function cycleAffinityLevel(level, direction) {
  return clampAffinityLevel(clampAffinityLevel(level) + (direction < 0 ? -1 : 1));
}

/** Multiplicador de um nível. Pura. */
export function affinityMultiplier(level, { immune = 0, ineffective = 0.5, effective = 1.5, superEffective = 2 } = {}) {
  switch (clampAffinityLevel(level)) {
    case -2: return Math.max(0, Number(immune) || 0);
    case -1: return Math.max(0, Number(ineffective) || 0);
    case 1: return Math.max(0, Number(effective) || 0);
    case 2: return Math.max(0, Number(superEffective) || 0);
    default: return 1;
  }
}

/** Nível de `attackId` contra `defenseId` na tabela `{atacante: {defensor: nível}}`. Pura. */
export function affinityLevel(matrix, attackId, defenseId) {
  return clampAffinityLevel(matrix?.[attackId]?.[defenseId] ?? 0);
}

/**
 * Uma parte do golpe (um elemento) contra quem tem estes elementos: os multiplicadores de cada
 * elemento do defensor se MULTIPLICAM (Fogo contra Planta + Gelo = 2 × 2). Sem elemento de um dos
 * lados, 1. Pura.
 */
export function elementVsDefender(attackId, defenderElements, matrix, config) {
  if (!attackId) return 1;
  return [...new Set(defenderElements ?? [])].filter(Boolean)
    .reduce((factor, defenseId) => factor * affinityMultiplier(affinityLevel(matrix, attackId, defenseId), config), 1);
}

/**
 * O golpe inteiro contra um defensor (Escudo, Estrutura, corpo de Nave): média das partes iguais,
 * uma por elemento do golpe (como no dano por elemento). Golpe sem elemento: 1. Pura.
 */
export function hitAffinityFactor(hitElements, defenderElements, matrix, config) {
  const ids = [...new Set(hitElements ?? [])].filter(Boolean);
  if (!ids.length || !(defenderElements ?? []).length) return 1;
  return ids.reduce((sum, id) => sum + elementVsDefender(id, defenderElements, matrix, config), 0) / ids.length;
}

/**
 * Tabela de vantagens a partir do catálogo (`affinity` de cada elemento), convertendo o antigo
 * efeito "Dano extra contra elemento" (percentual) em nível: ≥ +75% Super efetivo, > 0 Efetivo,
 * ≤ −100% Imune, < 0 Ineficaz. O nível escrito na tabela manda sobre o convertido. Pura.
 */
export function buildAffinityMatrix(elements) {
  const matrix = {};
  for (const element of elements ?? []) {
    if (!element?.id) continue;
    const row = {};
    for (const effect of element.effects ?? []) {
      if (effect?.type !== "vsElement" || !effect.element) continue;
      const percent = Number(effect.percent) || 0;
      row[effect.element] = percent >= 75 ? 2 : percent > 0 ? 1 : percent <= -100 ? -2 : percent < 0 ? -1 : 0;
    }
    for (const [defenseId, level] of Object.entries(element.affinity ?? {})) row[defenseId] = clampAffinityLevel(level);
    for (const [defenseId, level] of Object.entries(row)) if (!level) delete row[defenseId];
    if (Object.keys(row).length) matrix[element.id] = row;
  }
  return matrix;
}

/** Chave da adaptação de um Escudo: elemento + frequência das armas de quem atacou. */
export function shieldAdaptationKey(elementId, frequency = 0) {
  return `${elementId || "none"}@${Math.round(Number(frequency) || 0)}`;
}

/**
 * Quanto (%) um Escudo adaptativo já está adaptado a este golpe: a média das partes (um golpe de
 * Phaser + Plasma divide em duas partes iguais, como no dano por elemento). Pura.
 */
export function shieldAdaptationFor(adaptation, elementIds, frequency = 0) {
  const ids = elementIds?.length ? [...new Set(elementIds)] : [""];
  const sum = ids.reduce((total, id) => total + (Number(adaptation?.[shieldAdaptationKey(id, frequency)]) || 0), 0);
  return sum / ids.length;
}

/**
 * Depois de um golpe que chegou no Escudo de pé: cada elemento dele (na frequência de quem atacou)
 * sobe `step` pontos, até `cap` (nunca acima de 95). Devolve um objeto novo. Pura.
 */
export function adaptShield(adaptation, elementIds, frequency, step, cap) {
  const next = { ...(adaptation ?? {}) };
  const limit = Math.min(95, Math.max(0, Number(cap) || 0));
  const ids = elementIds?.length ? [...new Set(elementIds)] : [""];
  for (const id of ids) {
    const key = shieldAdaptationKey(id, frequency);
    next[key] = Math.min(limit, (Number(next[key]) || 0) + Math.max(0, Number(step) || 0));
  }
  return next;
}

/**
 * "Mirar num sistema": do dano de Integridade, a fatia `share` (0-1) vai pro Módulo mirado, até a
 * Vida dele; o que ele não aguenta volta pro espalhamento normal.
 * @returns {{toTarget: number, toSpread: number}}
 */
export function splitTargetedStructural(amount, targetHp, share = 0.75) {
  const total = Math.max(0, Math.floor(Number(amount) || 0));
  const wanted = Math.floor(total * Math.min(1, Math.max(0, Number(share) || 0)));
  const toTarget = Math.min(wanted, Math.max(0, Math.floor(Number(targetHp) || 0)));
  return { toTarget, toSpread: total - toTarget };
}

/**
 * Chance de um efeito de sistema pegar (Derrubar Módulo, Drenar energia, Baixar resistência)
 * depois do Endurecimento do alvo: 20% de chance contra 30% de Endurecimento = 14%.
 */
export function hardenedChance(chancePercent, hardeningPercent = 0) {
  const chance = Math.min(100, Math.max(0, Number(chancePercent) || 0));
  const hardening = Math.min(100, Math.max(0, Number(hardeningPercent) || 0));
  return chance * (1 - hardening / 100);
}

/**
 * Escudo pessoal em **pools**: cada Skill que dá Escudo tem o seu, com Vida própria; o mostrador
 * soma todos (mais o "avulso" — Escudo digitado à mão ou de antes dos pools). O golpe gasta **um
 * de cada vez, do mais recente pro mais antigo** (o último erguido é a camada de fora), e o avulso
 * por último.
 *
 * A **Penetração** age em cada pool, um depois do outro: cada camada deixa passar a fração
 * penetrada e segura o resto (até o valor dela, com o "Dano por camada" de Escudo do elemento);
 * o que passou encontra a próxima camada, que aplica a Penetração de novo. Dano abaixo de 1 é
 * descartado. O dreno antigo de Escudo (dano extra só contra Escudo) come os pools primeiro.
 *
 * @param {Array<{id: string, value: number, order: number}>} pools
 * @param {number} loose - Escudo avulso
 * @param {number} amount - dano que chega no Escudo
 * @param {{penetration?: number, multiplier?: number, drain?: number}} [options]
 * @returns {{pools: object[], loose: number, toShield: number, toHp: number}}
 */
export function consumeShieldPools(pools, loose, amount, { penetration = 0, multiplier = 1, drain = 0, layerMultiplier = null } = {}) {
  const layers = [...(pools ?? [])]
    .map(pool => ({ ...pool, value: Math.max(0, Math.round(Number(pool.value) || 0)) }))
    .sort((a, b) => (Number(b.order) || 0) - (Number(a.order) || 0));
  const looseLayer = { id: null, value: Math.max(0, Math.round(Number(loose) || 0)) };
  const ordered = [...layers, looseLayer];
  const pen = Math.min(1, Math.max(0, Number(penetration) || 0));
  let toShield = 0;

  // Dreno de Escudo: dano EXTRA que só existe contra Escudo — come as camadas de fora pra dentro.
  let extra = Math.max(0, Math.round(Number(drain) || 0));
  for (const layer of ordered) {
    if (extra <= 0) break;
    const take = Math.min(layer.value, extra);
    layer.value -= take;
    extra -= take;
    toShield += take;
  }

  let remaining = Math.max(0, Number(amount) || 0);
  for (const layer of ordered) {
    if (remaining < 1) break;
    if (layer.value <= 0) continue;
    const targeted = remaining * (1 - pen);
    // Cada pool pode ter o seu elemento: a vantagem do golpe contra ele entra no multiplicador.
    const factor = layerMultiplier && layer.id !== null ? Math.max(0, Number(layerMultiplier(layer)) || 0) : 1;
    const { absorbed, leaked } = absorbLayer(targeted, layer.value, multiplier * factor);
    layer.value -= absorbed;
    toShield += absorbed;
    remaining = remaining - targeted + leaked;
  }
  if (remaining < 1) remaining = 0;

  return { pools: layers, loose: looseLayer.value, toShield, toHp: Math.floor(remaining + 1e-9) };
}

/**
 * O total do Escudo foi mudado à mão (ficha): os pools se ajustam. Diminuir tira dos pools do mais
 * recente pro mais antigo (depois de gastar o avulso); aumentar vira avulso.
 * @returns {Array<object>} pools ajustados (o avulso é o que sobrar: total − soma)
 */
export function reconcileShieldPools(pools, newTotal) {
  const list = [...(pools ?? [])].map(pool => ({ ...pool, value: Math.max(0, Math.round(Number(pool.value) || 0)) }));
  const total = Math.max(0, Math.round(Number(newTotal) || 0));
  let excess = list.reduce((sum, p) => sum + p.value, 0) - total;
  if (excess <= 0) return list;
  for (const pool of [...list].sort((a, b) => (Number(b.order) || 0) - (Number(a.order) || 0))) {
    if (excess <= 0) break;
    const take = Math.min(pool.value, excess);
    pool.value -= take;
    excess -= take;
  }
  return list;
}
