/**
 * Uma Skill numa frase (L2), para a linha da ficha: "3d6 de Fogo · cone de 6 m · 20 Mana ·
 * Ativa: −3/rodada". O jogador sabe o que a Skill faz sem abrir o editor.
 *
 * Pura e testada: os nomes (elementos, Condições, alvos de efeito, Estruturas) e os números já
 * resolvidos (custo efetivo pelo nível, rótulo da energia) chegam em `ctx`, montado com os
 * leitores de config.js por `skillSummariesFor` (skill-summary-ui.js).
 */
import { LUCK_SCOPES, LUCK_SCOPE_LABELS, luckPercentText } from "../combat/luck-rules.js";
import { onlyIfClause } from "./only-if-rules.js";
import { normalizeOnHit } from "./marks-rules.js";
import { combinedSentence } from "./combined-rules.js";
import { rerollSentence } from "./reroll-rules.js";
import { clampTimeFactor, describeTimeFactor } from "../combat/time-rate-rules.js";
import { spaceSentence } from "../combat/space-rules.js";
import { strikeSentence } from "../combat/weapon-mastery-rules.js";
import { isSenseTarget, SENSE_LABELS, describeSenseRange, senseRangeValue } from "../combat/senses-rules.js";
import { perLevelText } from "../combat/area-size-rules.js";
import { reflectSentence } from "../combat/reflect-rules.js";
import { purifySentence } from "./purify-rules.js";
import { reviveSentence } from "./revive-rules.js";
import { scrySentence } from "../combat/scry-rules.js";
import { drainKindOf, drainSentence } from "./drain-rules.js";
import { strikesSentence, chainChance, strikeCount } from "./strikes-rules.js";
import { effectiveChance, chanceBonusOf } from "./chance-rules.js";

const SHAPE_WORDS = { circle: "círculo", cone: "cone", ray: "linha" };

const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

/** "Força +3", "Vida −5/rodada", "Envenenado", "Escudo +20". */
function describeEffect(entry, ctx) {
  let text = describeEffectCore(entry, ctx);
  // Chance do efeito, com os pontos que a progressão por chance já deu ("Atordoado, 46% de chance").
  const base = Number(entry.chance);
  if (text && entry.target !== "magicDampen" && base > 0 && base < 100) {
    text += `, ${effectiveChance(base, entry.id ? chanceBonusOf(ctx.chanceBonus, `effect:${entry.id}`) : 0)}% de chance`;
  }
  // "Só se…" (8.1a): "Atordoa, só se o alvo estiver Molhado".
  const clause = text ? onlyIfClause(entry.onlyIf, (kind, value) => ctx.conditions?.[value] ?? ctx.traits?.[value] ?? value) : "";
  return clause ? `${text}, só se ${clause}` : text;
}

function describeEffectCore(entry, ctx) {
  // Movimento (J1/J4): "empurra 5 m", "puxa 5 m", "empurra ou puxa 5 m", "voo", "escava".
  if (entry.target === "push") {
    const meters = Math.round((Number(entry.amount) || 0) * 10) / 10;
    const verb = entry.pushDirection === "pull" ? "puxa" : entry.pushDirection === "choose" ? "empurra ou puxa" : "empurra";
    return `${verb} ${String(meters).replace(".", ",")} m`;
  }
  if (entry.target === "createSurface") {
    const label = ctx.elements?.[entry.elementId] ?? entry.elementId ?? "?";
    const meters = Math.round((Number(entry.amount) || 0) * 10) / 10;
    return `deixa ${label} no chão${meters > 0 ? ` (raio ${String(meters).replace(".", ",")} m)` : ""}`;
  }
  if (entry.target === "flight") return "voo";
  // Peças de magia (1.123.0).
  if (entry.target === "reflect") return reflectSentence(entry.amount, entry.reflectShieldOnly);
  if (entry.target === "purify") return purifySentence({ max: Math.abs(Number(entry.amount) || 0), conditionLabel: entry.conditionId ? ctx.conditions?.[entry.conditionId] ?? entry.conditionId : "", level: Number(ctx.level) || 0 });
  if (entry.target === "revive") return reviveSentence(entry);
  if (entry.target === "scry") return scrySentence(entry);
  if (drainKindOf(entry)) return drainSentence(entry, { targetLabel: ctx.targets?.[entry.target], energyLabel: ctx.energyLabel });
  // Espaço (8f): "teleporta quem usa até 10 m, atravessando paredes" / "troca de lugar com o alvo".
  if (entry.target === "space") return spaceSentence(entry, { range: ctx.range });
  // Ritmo do tempo (8e): "Acelerado ×3 (3 de tempo por turno, Deslocamento ×3)" / "Desacelerado ×½".
  if (entry.target === "timeRate" && entry.timeRewind) {
    const rounds = Math.max(0, Math.floor(Number(entry.durationRounds) || 0));
    return `volta o tempo do alvo em ${rounds} ${rounds === 1 ? "rodada" : "rodadas"} (Vida, energia, efeitos, Itens e lugar em combate; efeitos e tempo de vida fora dele)`;
  }
  if (entry.target === "timeRate" && entry.timeStop) return "para o tempo do alvo (ele não age nem se move, nada nele anda; o dano que leva cai quando o tempo volta)";
  if (entry.target === "timeRate") {
    const factor = clampTimeFactor(entry.timeFactor);
    if (Math.abs(factor - 1) < 1e-6) return "ritmo do tempo sem mudança";
    return factor > 1 ? `Acelerado ${describeTimeFactor(factor)} (${Math.floor(factor)} de tempo por turno, Deslocamento ${describeTimeFactor(factor)})` : `Desacelerado ${describeTimeFactor(factor)} (Deslocamento ${describeTimeFactor(factor)}, contadores mais lentos)`;
  }
  // Sorte (8d.1): "sorte +30% nos dados (atributos, dano)".
  if (entry.target === "luck") return `sorte ${luckPercentText(Number(entry.amount) || 0)} nos dados (${LUCK_SCOPES.filter(k => entry.luckScopes?.[k]).map(k => LUCK_SCOPE_LABELS[k].toLowerCase()).join(", ") || "sem escopo"})`;
  // Magia enfraquecida (8c.2): "50% das magias do alvo saem com 50% da força".
  if (entry.target === "magicDampen") return `${Math.round(Number(entry.chance ?? 100))}% das magias do alvo saem com ${Math.round(Number(entry.amount) || 0)}% da força`;
  if (entry.target === "burrow") return "escava";
  // Dissipar (8d.2): "dissipa efeitos mágicos (só marcas)".
  if (entry.target === "dispelMagic") return `dissipa ${entry.dispelScope === "marks" ? "marcas" : entry.dispelScope === "condition" ? `${ctx.conditions?.[entry.conditionId] ?? entry.conditionId ?? "uma Condição"} mágica` : "efeitos mágicos"}`;
  if (entry.target === "unarmedType") return `desarmado vira ${ctx.weaponTypes?.[entry.weaponTypeId] ?? entry.weaponTypeId ?? "?"}`;
  // Sentidos (J4b): "sentido sísmico 10 m", "ver o invisível (sem limite)".
  if (isSenseTarget(entry.target)) {
    const range = describeSenseRange(senseRangeValue(entry.amount));
    return `${SENSE_LABELS[entry.target].toLowerCase()} ${range === "sem limite" ? "(sem limite)" : range.replace(".", ",")}`;
  }
  const conditionName = entry.conditionId ? ctx.conditions?.[entry.conditionId] ?? entry.conditionId : "";
  // "Fura imunidade e resistência a Condição" (1.119.0).
  const condition = conditionName && entry.piercesCondition ? `${conditionName}, fura imunidade` : conditionName;
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
    const drain = Number(mech.lifeSteal) > 0 ? `, drena ${Math.round(Number(mech.lifeSteal))}% como Vida` : "";
    return `${formula}${elements.length ? ` de ${elements.join(" + ")}` : ""}${kind}${drain}`;
  }
  if (mech.effectType === "temporary") {
    const effects = (mech.effects ?? []).map(e => describeEffect(e, { ...ctx, range: Number(mech.range) || 0, level: Number(mech.level) || 0, chanceBonus: mech.chanceBonus ?? ctx.chanceBonus })).filter(Boolean);
    if (!effects.length) return "efeito";
    const shown = effects.slice(0, 2).join(" e ");
    return effects.length > 2 ? `${shown} +${effects.length - 2}` : shown;
  }
  if (mech.effectType === "analysis") return "analisa um alvo";
  if (mech.effectType === "predation") return "preda um alvo derrotado";
  if (mech.effectType === "reroll") return rerollSentence(mech);
  if (mech.effectType === "form") return `Forma: ${ctx.formName?.(mech.formActorUuid) ?? "(sem ficha)"}`;
  if (mech.effectType === "structure" || mech.targetType === "structure") {
    const regen = Number(mech.structureRegen) || 0;
    const regenCost = Number(mech.structureRegenCost) || 0;
    const regenText = regen > 0 ? `, regenera ${regen}/rodada${regenCost ? ` (−${regenCost} ${ctx.energyLabel || "Mana"})` : ""}` : "";
    const size = Number(mech.structureSize) > 0 ? Number(mech.structureSize) : ctx.structureSizes?.[mech.structureId];
    const sizeText = size ? ` de ${meterText(size)} m${perLevelText(mech.areaPerLevel) ? ` (${perLevelText(mech.areaPerLevel)})` : ""}` : "";
    const follows = mech.structureFollows ? ", segue quem lançou" : "";
    const aura = mech.structureFollows && ctx.fieldStructures?.[mech.structureId] ? "; quem lançou não é afetado" : "";
    return `ergue ${ctx.structures?.[mech.structureId] ?? "Estrutura"}${sizeText}${regenText}${follows}${aura}`;
  }
  return null;
}

const meterText = value => String(Math.round(Number(value) * 100) / 100).replace(".", ",");

/** "3 m" ou "3 m (+1 m por nível)": o tamanho base e o que cresce por nível. */
function areaSizeText(mech) {
  const base = `${meterText(Number(mech.areaDistance) || 0)} m`;
  const per = perLevelText(mech.areaPerLevel);
  return per ? `${base} (${per})` : base;
}

/** "num alvo", "em si", "cone de 6 m", "zona de 4 m por 3 rod.". */
function describeReach(mech) {
  switch (mech.targetType) {
    case "self":
      return "em si";
    case "emission":
      return SHAPE_WORDS[mech.areaShape] ? `${SHAPE_WORDS[mech.areaShape]} de ${areaSizeText(mech)}` : "área";
    case "zone": {
      const size = SHAPE_WORDS[mech.areaShape] ? ` de ${areaSizeText(mech)}` : "";
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
    const who = { notCaster: "poupa você", allies: "só aliados", enemies: "só inimigos", othersExceptTarget: "poupa você e o alvo" }[mech.areaAffects];
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
    // Combinada (8c.2): "Combinada: A + B + C"; uma Skill fundida só diz quantas Sub-Skills tem.
    parts.push(mech.combined ? combinedSentence(mech) : `${subSkills} Sub-Skill${subSkills === 1 ? "" : "s"}`);
  } else {
    const mechanic = describeMechanic(mech, ctx);
    if (mechanic) {
      parts.push(mechanic);
      if (mech.effectType !== "structure" && mech.targetType !== "structure" && mech.effectType !== "form" && mech.effectType !== "reroll") parts.push(describeReach(mech));
      if (ctx.skillRange !== false) parts.push(...describeRange(mech));
      // Golpes N e a corrente (1.123.0), com a chance atual da progressão por chance.
      if (["damage", "temporary"].includes(mech.effectType) && strikeCount(mech) > 1) parts.push(strikesSentence(mech, chainChance(mech, chanceBonusOf(mech.chanceBonus, "chain"))));
      // Golpe de arma (H6): "golpe desarmado" / "golpe de Lâminas".
      if (mech.effectType === "damage" && mech.weaponStrike && ctx.strikesOn) parts.push(strikeSentence(mech.weaponStrike, ctx.weaponTypes?.[mech.weaponStrike]) + (mech.weaponStrike !== "unarmed" && mech.strikeRequiresWeapon !== false ? " (com a arma)" : ""));
    }
  }
  // "Só se…" da Skill inteira (8c.1): "só se o alvo tiver a Marca do Duelo posta por mim".
  const skillOnlyIf = onlyIfClause(mech.onlyIf, (kind, value) => ctx.conditions?.[value] ?? ctx.traits?.[value] ?? value);
  if (skillOnlyIf) parts.push(`só se ${skillOnlyIf}`);
  // "Ao acertar" (8c.1): "seus golpes põem Marca do Duelo (50%)".
  const onHit = normalizeOnHit(mech.onHit);
  if (onHit) {
    const name = ctx.conditions?.[onHit.conditionId] ?? onHit.conditionId;
    const when = onHit.when === "on" ? " enquanto ligada" : onHit.when === "off" ? " enquanto desligada" : "";
    parts.push(`seus golpes põem ${name}${onHit.chance < 100 ? ` (${onHit.chance}%)` : ""}${when}${onHit.pierce ? ", furando imunidade e resistência" : ""}`);
  }
  // O duelo (8c.2): quando a Skill Ativa desliga sozinha.
  if (mech.hasUpkeep && mech.endsWhenTargetFalls) parts.push("desliga se o alvo cair");
  if (mech.hasUpkeep && mech.intruderRule === "break") parts.push("desliga se alguém entrar na Estrutura");
  if (mech.hasUpkeep && mech.intruderRule === "include") parts.push("quem entrar na Estrutura recebe o efeito no alvo");
  if (ctx.resistance) parts.push(ctx.resistance);
  // Maestria de arma (H6): a frase pronta ("Maestria: Lâminas · +15% de dano") vem de fora.
  if (ctx.mastery) parts.push(ctx.mastery);
  // Skill pré-feita de Manipulação: o que ela faz é resistir ao campo de Antimagia.
  if (mech.coreSkill === "manaManipulation") parts.push("resiste à Antimagia");
  if (mech.coreSkill === "concealment") parts.push("dificulta a Análise");

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
