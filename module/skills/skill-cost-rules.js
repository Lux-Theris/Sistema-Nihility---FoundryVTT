/**
 * Custo sugerido (backlog L9; canvas "Editor de Skill Assistido", prancha 3). Puro e testado
 * (test/skill-assist.test.mjs). Só SUGERE: nunca muda o campo.
 *
 * A conta soma "pontos de poder" pelo que a Skill faz (dano médio, área, efeitos e duração) e
 * converte em Mana por "Mana por ponto" (Regras da Mesa). É o custo do NÍVEL 1 — o desconto dos
 * níveis já acontece sozinho. Os pesos foram calibrados nas Skills que vêm no sistema
 * (Arquétipos de NPC): Bola de Fogo (4d6, círculo 4 m, escala por Magia) ≈ 25.
 *
 * A Mana de quem tem a Skill NÃO entra na sugestão (o mesmo poder sugere o mesmo custo para
 * todos); ela só aparece numa linha à parte (`holderLine`).
 */

/** Pesos da conta. Ficam aqui (e não em settings) para a conta ser legível linha a linha. */
export const COST_WEIGHTS = {
  scaling: 1.25,
  absolute: 1.5,
  attributePerRound: 0.75,
  foreverRounds: 4,
  maxRounds: 6,
  heal: 0.45,
  shield: 0.45,
  periodic: 0.6,
  activeTicks: 3,
  percentMaxAsPoints: 1.5,
  condition: 4,
  toggle: 4,
  antimagic: 8,
  structureHpPerPoint: 5,
  upkeepShare: 0.25,
  percentTarget: 0.1
};

/** Alvos cujo valor já é uma porcentagem (+50% de Deslocamento ≠ +50 de Força). */
const PERCENT_VALUE_TARGETS = ["movement", "shipShieldCapacity", "shipShieldRegen", "shipReactorOutput", "shipPropulsion", "shipDamageReduction"];

/**
 * Média de uma fórmula de dados simples: termos `NdM`, `dM`, números, `+`/`-`. Partes que não dá
 * para calcular sem a ficha (`@força`, funções) contam 0. Modificadores de dado (`kh`, `r`, `x`)
 * são ignorados — é uma estimativa.
 */
export function averageRoll(formula) {
  const text = String(formula ?? "").replace(/\s+/g, "").replace(/@[\w.]+/g, "0");
  if (!text) return 0;
  let total = 0;
  const re = /([+-]?)(\d*)d(\d+)[a-z<>=\d]*|([+-]?)(\d+(?:\.\d+)?)/gi;
  let match;
  while ((match = re.exec(text))) {
    if (match[3]) {
      const sign = match[1] === "-" ? -1 : 1;
      const n = match[2] ? Number(match[2]) : 1;
      total += sign * n * ((Number(match[3]) + 1) / 2);
    } else if (match[5]) {
      total += (match[4] === "-" ? -1 : 1) * Number(match[5]);
    }
  }
  return Math.max(0, total);
}

/** Fator da área pelo formato e tamanho (alvo único = 1). */
export function areaFactor(shape, distance) {
  const d = Math.max(0, Number(distance) || 0);
  if (!d) return 1;
  if (shape === "cone") return 1 + d / 12;
  if (shape === "ray") return 1 + d / 15;
  return 1 + d / 6.67;
}

const fmt = n => (Math.round(n * 100) / 100).toString().replace(".", ",");

/**
 * @param {object} mech - a Skill no formato do schema
 * @param {object} [ctx]
 * @param {number} [ctx.manaPerPoint] - Regras da Mesa (padrão 0,9)
 * @param {(id: string) => number} [ctx.structureHp] - Vida da Estrutura do catálogo
 * @param {(id: string) => string} [ctx.conditionLabel]
 * @param {(key: string) => string} [ctx.targetLabel]
 * @param {(key: string) => string} [ctx.attributeLabel]
 * @returns {{cost: number, upkeep: number|null, points: number, rows: Array<{label: string, value: string}>}}
 */
export function suggestSkillCost(mech, ctx = {}) {
  const m = mech ?? {};
  const w = COST_WEIGHTS;
  const perPoint = Number(ctx.manaPerPoint) > 0 ? Number(ctx.manaPerPoint) : 0.9;
  const label = (fn, key) => (fn ? fn(key) : key) || key;
  const rows = [];
  const active = Boolean(m.hasUpkeep);
  let points = 0;

  const effectType = m.effectType ?? "none";
  const isArea = (effectType === "damage" || effectType === "temporary") && (m.targetType === "emission" || m.targetType === "zone");

  if (effectType === "damage") {
    const avg = averageRoll(m.damageFormula);
    points = avg;
    rows.push({ label: `Dano médio de ${String(m.damageFormula || "—")}`, value: fmt(avg) });
    if (m.scalingAttribute) {
      points *= w.scaling;
      rows.push({ label: `Escala por ${label(ctx.attributeLabel, m.scalingAttribute)} (cresce com o atributo)`, value: `× ${fmt(w.scaling)}` });
    }
    if (m.isAbsoluteDamage) {
      points *= w.absolute;
      rows.push({ label: "Dano Absoluto (não se resiste)", value: `× ${fmt(w.absolute)}` });
    }
  } else if (effectType === "temporary") {
    for (const e of m.effects ?? []) {
      const target = e?.target ?? "";
      const raw = Math.abs(Number(e?.amount) || 0);
      const amount = e?.amountMode === "percentMax" ? raw * w.percentMaxAsPoints : PERCENT_VALUE_TARGETS.includes(target) ? raw * w.percentTarget : raw;
      const name = label(ctx.targetLabel, target);
      let p = 0;
      let text = "";
      if (target === "antimagic") {
        p = w.antimagic;
        text = "Antimagia";
      } else if (["weaponElement", "bodyElement", "weaponMagic", "weaponAbsolute"].includes(target)) {
        p = w.toggle;
        text = name;
      } else if (e?.periodic) {
        const ticks = active ? w.activeTicks : Math.max(1, Number(e?.durationRounds) || 1);
        p = amount * ticks * w.periodic;
        text = `${name} ${Number(e?.amount) > 0 ? "+" : "−"}${raw}${e?.amountMode === "percentMax" ? "%" : ""} por rodada × ${ticks}`;
      } else if (target === "heal" || target === "restoreEnergy") {
        p = amount * w.heal;
        text = `${name} ${raw}${e?.amountMode === "percentMax" ? "% do máximo" : ""}`;
      } else if (target === "shield" || target === "shipShieldRestore") {
        p = amount * w.shield + (Number(e?.shieldRegen) || 0) * w.shield;
        text = `Escudo ${raw}${Number(e?.shieldRegen) ? ` (+${e.shieldRegen}/rodada)` : ""}`;
      } else if (amount) {
        const rounds = active ? w.activeTicks : Number(e?.durationRounds) > 0 ? Math.min(w.maxRounds, Number(e.durationRounds)) : w.foreverRounds;
        p = amount * rounds * w.attributePerRound;
        text = `${name} ${Number(e?.amount) > 0 ? "+" : "−"}${raw}${e?.amountMode === "percentMax" || PERCENT_VALUE_TARGETS.includes(target) ? "%" : ""} por ${active ? "rodada ativa" : `${rounds} rodada(s)`}`;
      }
      if (p) {
        points += p;
        rows.push({ label: text, value: fmt(p) });
      }
      if (e?.conditionId) {
        points += w.condition;
        rows.push({ label: `Condição ${label(ctx.conditionLabel, e.conditionId)}`, value: `+ ${w.condition}` });
      }
    }
    if (!(m.effects ?? []).length) rows.push({ label: "Nenhum Efeito", value: "—" });
  } else if (effectType === "structure" || m.targetType === "structure") {
    const hp = Number(ctx.structureHp?.(m.structureId)) || 0;
    points = hp / w.structureHpPerPoint;
    rows.push({ label: `Estrutura com ${hp} de Vida`, value: fmt(points) });
  } else {
    rows.push({ label: "Descritiva: o Mestre julga", value: "—" });
  }

  if (isArea) {
    const factor = areaFactor(m.areaShape, m.areaDistance);
    const shapeName = { cone: "cone", ray: "linha" }[m.areaShape] ?? "círculo";
    points *= factor;
    rows.push({ label: `Área: ${shapeName} de ${Number(m.areaDistance) || 0} m`, value: `× ${fmt(factor)}` });
    if (m.targetType === "zone") {
      const rounds = active ? w.activeTicks : Math.max(1, Number(m.zoneRounds) || 1);
      const zf = 1 + (rounds - 1) * 0.5;
      points *= zf;
      rows.push({ label: `Zona: bate por ${rounds} rodada(s)`, value: `× ${fmt(zf)}` });
    }
  } else if (effectType === "damage" || effectType === "temporary") {
    rows.push({ label: "Alvo único", value: "× 1" });
  }

  rows.push({ label: "Mana por ponto (Regras da Mesa)", value: `× ${fmt(perPoint)}` });
  const cost = points > 0 ? Math.max(1, Math.round(points * perPoint)) : 0;
  const upkeep = active && cost > 0 ? Math.max(1, Math.round(cost * w.upkeepShare)) : null;
  return { cost, upkeep, points, rows };
}

/** Perto do sugerido? (até `tolerance`, padrão 30%, de diferença do que está escrito). */
export function costCloseEnough(actual, suggested, tolerance = 0.3) {
  const a = Number(actual) || 0;
  const s = Number(suggested) || 0;
  if (!s) return true;
  return Math.abs(a - s) <= s * tolerance;
}

/** A linha "na ficha de X": quanto da Mana máxima o custo come e quantas vezes dá para usar. */
export function holderLine(cost, energyMax) {
  const c = Number(cost) || 0;
  const max = Number(energyMax) || 0;
  if (!(c > 0) || !(max > 0)) return null;
  return { percent: Math.round((c / max) * 100), uses: Math.floor(max / c) };
}
