/**
 * Uma Skill numa frase (L2), para a linha da ficha: "3d6 de Fogo · cone de 6 m · 20 Mana ·
 * Ativa: −3/rodada". O jogador sabe o que a Skill faz sem abrir o editor.
 *
 * Pura e testada: os nomes (elementos, Condições, alvos de efeito, Estruturas) e os números já
 * resolvidos (custo efetivo pelo nível, rótulo da energia) chegam em `ctx`, montado com os
 * leitores de config.js por `skillSummariesFor` (skill-summary-ui.js).
 */
import { strikeSentence } from "../combat/weapon-mastery-rules.js";
import { isSenseTarget, SENSE_LABELS, describeSenseRange, senseRangeValue } from "../combat/senses-rules.js";

const SHAPE_WORDS = { circle: "círculo", cone: "cone", ray: "linha" };

const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** "Força +3", "Vida −5/rodada", "Envenenado", "Escudo +20". */
function describeEffect(entry, ctx) {
  // Movimento (J1/J4): "empurra 5 m", "puxa 5 m", "empurra ou puxa 5 m", "voo", "escava".
  if (entry.target === "push") {
    const meters = Math.round((Number(entry.amount) || 0) * 10) / 10;
    const verb = entry.pushDirection === "pull" ? "puxa" : entry.pushDirection === "choose" ? "empurra ou puxa" : "empurra";
    return `${verb} ${String(meters).replace(".", ",")} m`;
  }
  if (entry.target === "flight") return "voo";
  if (entry.target === "burrow") return "escava";
  if (entry.target === "unarmedType") return `desarmado vira ${ctx.weaponTypes?.[entry.weaponTypeId] ?? entry.weaponTypeId ?? "?"}`;
  // Sentidos (J4b): "sentido sísmico 10 m", "ver o invisível (sem limite)".
  if (isSenseTarget(entry.target)) {
    const range = describeSenseRange(senseRangeValue(entry.amount));
    return `${SENSE_LABELS[entry.target].toLowerCase()} ${range === "sem limite" ? "(sem limite)" : range.replace(".", ",")}`;
  }
  const condition = entry.conditionId ? ctx.conditions?.[entry.conditionId] ?? entry.conditionId : "";
  const amount = Number(entry.amount) || 0;
  if (!amount) return condition || ctx.targets?.[entry.target] || entry.target || "";
  const target = ctx.targets?.[entry.target] ?? entry.target;
  const text = `${target} ${signed(amount)}${entry.amountMode === "percentMax" ? "% do máx." : ""}${entry.periodic ? "/rodada" : ""}`;
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
  if (mech.effectType === "form") return `Forma: ${ctx.formName?.(mech.formActorUuid) ?? "(sem ficha)"}`;
  if (mech.effectType === "structure" || mech.targetType === "structure") {
    const regen = Number(mech.structureRegen) || 0;
    const regenCost = Number(mech.structureRegenCost) || 0;
    const regenText = regen > 0 ? `, regenera ${regen}/rodada${regenCost ? ` (−${regenCost} ${ctx.energyLabel || "Mana"})` : ""}` : "";
    return `ergue ${ctx.structures?.[mech.structureId] ?? "Estrutura"}${regenText}`;
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

/** Alcance (H4): "alcance 20 m" e, nas formas de área, de onde saem ("sai de você", "livre", "livre a partir do nv 5"). */
function describeRange(mech) {
  const out = [];
  const range = Number(mech.range) || 0;
  if (range > 0 && mech.targetType !== "self") out.push(`alcance ${String(Math.round(range * 10) / 10).replace(".", ",")} m`);
  const area = mech.targetType === "emission" || mech.targetType === "zone";
  if (area && SHAPE_WORDS[mech.areaShape]) {
    if (mech.areaOrigin === "caster") {
      const from = Math.floor(Number(mech.areaFreeLevel)) || 0;
      out.push(from > 0 ? `sai de você, livre a partir do nv ${from}` : "sai de você");
    } else if (mech.areaOrigin === "free" || range > 0) {
      out.push("livre");
    }
  }
  if (area) {
    const who = { notCaster: "poupa você", allies: "só aliados", enemies: "só inimigos" }[mech.areaAffects];
    if (who) out.push(who);
  }
  return out;
}

/**
 * As partes da frase, na ordem em que se lê: o que faz → onde → quanto custa → manutenção.
 * @param {object} mech - `skill.system`
 * @param {{elements?:object, conditions?:object, targets?:object, structures?:object,
 *   energyLabel?:string, cost?:number, upkeep?:number, resistance?:string, mastery?:string, weaponTypes?:object, formName?:(uuid:string)=>string|null}} ctx
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
      if (mech.effectType !== "structure" && mech.targetType !== "structure" && mech.effectType !== "form") parts.push(describeReach(mech));
      if (ctx.skillRange !== false) parts.push(...describeRange(mech));
      // Golpe de arma (H6): "golpe desarmado" / "golpe de Lâminas".
      if (mech.effectType === "damage" && mech.weaponStrike && ctx.strikesOn) parts.push(strikeSentence(mech.weaponStrike, ctx.weaponTypes?.[mech.weaponStrike]) + (mech.weaponStrike !== "unarmed" && mech.strikeRequiresWeapon !== false ? " (com a arma)" : ""));
    }
  }
  if (ctx.resistance) parts.push(ctx.resistance);
  // Maestria de arma (H6): a frase pronta ("Maestria: Lâminas · +15% de dano") vem de fora.
  if (ctx.mastery) parts.push(ctx.mastery);
  // Skill pré-feita de Manipulação: o que ela faz é resistir ao campo de Antimagia.
  if (mech.coreSkill === "manaManipulation") parts.push("resiste à Antimagia");

  const cost = Number(ctx.cost ?? mech.cost) || 0;
  if (mech.variableMana) parts.push(`${energy} variável${cost ? ` (base ${cost})` : ""}`);
  else if (cost) parts.push(`${cost} ${energy}`);

  if (mech.hasUpkeep) {
    const upkeep = Number(ctx.upkeep ?? mech.upkeepCost) || 0;
    parts.push(upkeep ? `Ativa: −${upkeep}/rodada` : "Ativa");
  }
  // Recarga e Preparo (H3): só aparecem quando a Skill os tem.
  const cooldown = Math.floor(Number(mech.cooldown)) || 0;
  if (cooldown > 0) parts.push(`recarga ${cooldown}`);
  const prep = Math.floor(Number(mech.prepTurns)) || 0;
  if (prep > 0) parts.push(`pronta em ${prep} rodada${prep === 1 ? "" : "s"}`);
  return parts;
}

/** A frase pronta ("" quando a Skill é só descritiva e de graça). */
export function skillSummary(mech, ctx = {}) {
  return skillSummaryParts(mech, ctx).join(" · ");
}
