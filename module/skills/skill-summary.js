/**
 * Uma Skill numa frase (L2), para a linha da ficha: "3d6 de Fogo · cone de 6 m · 20 Mana ·
 * Ativa: −3/rodada". O jogador sabe o que a Skill faz sem abrir o editor.
 *
 * Pura e testada: os nomes (elementos, Condições, alvos de efeito, Estruturas) e os números já
 * resolvidos (custo efetivo pelo nível, rótulo da energia) chegam em `ctx`, montado com os
 * leitores de config.js por `skillSummariesFor` (skill-summary-ui.js).
 */

const SHAPE_WORDS = { circle: "círculo", cone: "cone", ray: "linha" };

const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** "Força +3", "Vida −5/rodada", "Envenenado", "Escudo +20". */
function describeEffect(entry, ctx) {
  const condition = entry.conditionId ? ctx.conditions?.[entry.conditionId] ?? entry.conditionId : "";
  const amount = Number(entry.amount) || 0;
  if (!amount) return condition || ctx.targets?.[entry.target] || entry.target || "";
  const target = ctx.targets?.[entry.target] ?? entry.target;
  const text = `${target} ${signed(amount)}${entry.periodic ? "/rodada" : ""}`;
  return condition ? `${condition} (${text})` : text;
}

/** O que a mecânica faz, sem alvo nem custo. Null = Descritiva. */
function describeMechanic(mech, ctx) {
  if (mech.effectType === "damage") {
    const formula = mech.damageFormula?.trim() || "dano sem fórmula";
    const elements = (mech.damageElements ?? []).map(id => ctx.elements?.[id] ?? id);
    const kind = mech.isAbsoluteDamage ? " absoluto" : mech.isMagicDamage ? " mágico" : "";
    return `${formula}${elements.length ? ` de ${elements.join(" + ")}` : ""}${kind}`;
  }
  if (mech.effectType === "temporary") {
    const effects = (mech.effects ?? []).map(e => describeEffect(e, ctx)).filter(Boolean);
    if (!effects.length) return "efeito";
    const shown = effects.slice(0, 2).join(" e ");
    return effects.length > 2 ? `${shown} +${effects.length - 2}` : shown;
  }
  if (mech.effectType === "structure" || mech.targetType === "structure") {
    return `ergue ${ctx.structures?.[mech.structureId] ?? "Estrutura"}`;
  }
  return null;
}

/** "num alvo", "em si", "cone de 6 m", "zona de 4 m por 3 rod.". */
function describeReach(mech) {
  switch (mech.targetType) {
    case "self":
      return "em si";
    case "emission":
      return SHAPE_WORDS[mech.areaShape] ? `${SHAPE_WORDS[mech.areaShape]} de ${Number(mech.areaDistance) || 0} m` : "área";
    case "zone": {
      const size = SHAPE_WORDS[mech.areaShape] ? ` de ${Number(mech.areaDistance) || 0} m` : "";
      return `zona${size}${mech.hasUpkeep ? "" : ` por ${Number(mech.zoneRounds) || 1} rod.`}`;
    }
    default:
      return "num alvo";
  }
}

/**
 * As partes da frase, na ordem em que se lê: o que faz → onde → quanto custa → manutenção.
 * @param {object} mech - `skill.system`
 * @param {{elements?:object, conditions?:object, targets?:object, structures?:object,
 *   energyLabel?:string, cost?:number, upkeep?:number, resistance?:string}} ctx
 *   `cost`/`upkeep` já com o desconto do nível; `resistance` = "Resistência a Fogo 30%" pronto.
 * @returns {string[]}
 */
export function skillSummaryParts(mech, ctx = {}) {
  if (!mech) return [];
  const energy = ctx.energyLabel || "Mana";
  const parts = [];
  const subSkills = mech.subSkills?.length ?? 0;

  if (subSkills) {
    parts.push(`${subSkills} Sub-Skill${subSkills === 1 ? "" : "s"}`);
  } else {
    const mechanic = describeMechanic(mech, ctx);
    if (mechanic) {
      parts.push(mechanic);
      if (mech.effectType !== "structure" && mech.targetType !== "structure") parts.push(describeReach(mech));
    }
  }
  if (ctx.resistance) parts.push(ctx.resistance);

  const cost = Number(ctx.cost ?? mech.cost) || 0;
  if (mech.variableMana) parts.push(`${energy} variável${cost ? ` (base ${cost})` : ""}`);
  else if (cost) parts.push(`${cost} ${energy}`);

  if (mech.hasUpkeep) {
    const upkeep = Number(ctx.upkeep ?? mech.upkeepCost) || 0;
    parts.push(upkeep ? `Ativa: −${upkeep}/rodada` : "Ativa");
  }
  return parts;
}

/** A frase pronta ("" quando a Skill é só descritiva e de graça). */
export function skillSummary(mech, ctx = {}) {
  return skillSummaryParts(mech, ctx).join(" · ");
}
