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
 * **Dano Absoluto** não pode ser resistido: ignora Defesa Mágica, Resistências e Imunidade.
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
    const raw = Math.max(0, Number(part.raw) || 0) * (1 + Math.max(0, Number(part.bonus) || 0));
    if (absolute) return { elementId: part.elementId, raw, final: raw, blockedGeneral: 0, blockedElement: 0 };

    const penetration = Math.min(1, Math.max(0, Number(part.penetration) || 0));
    const elementResist = part.elementId ? Math.max(0, Number(resistanceFor(part.elementId)) || 0) : 0;
    if (elementResist >= 1) {
      return { elementId: part.elementId, raw, final: 0, blockedGeneral: 0, blockedElement: raw, immune: true };
    }

    const soften = value => Math.min(1, Math.max(0, value)) * (1 - penetration);
    let remaining = raw * (1 - soften(magicDefense));
    const beforeGeneral = remaining;
    remaining *= 1 - soften(general);
    const blockedGeneral = beforeGeneral - remaining;
    const beforeElement = remaining;
    remaining *= 1 - soften(elementResist);
    const blockedElement = beforeElement - remaining;

    return { elementId: part.elementId, raw, final: remaining, blockedGeneral, blockedElement };
  });

  const final = Math.max(0, Math.floor(results.reduce((sum, p) => sum + p.final, 0) + 1e-9));
  return { final, parts: results };
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
    const target = effect.tickTarget === "energy" ? "energy" : "hp";
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
