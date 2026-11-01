/**
 * Simulador de encontro (canvas "Simulador de Encontro"): lê as fichas e calcula o golpe médio de
 * cada ataque contra cada alvo pelo MESMO caminho do dano de verdade — média da fórmula, Escala
 * por Atributo, Poder do nível, Escala de tamanho, bônus "Quando → Então", e então
 * `applyDamageReductions` (Defesa Mágica, Resistências em cadeia, vantagem de elemento) sem
 * disparar Condição nenhuma. A parte que estima rodadas e veredito é pura (encounter-rules.js).
 *
 * Nada é rolado nem gravado. NPCs de Arquétipo entram como Atores TEMPORÁRIOS (não salvos).
 */
import {
  MEU_SISTEMA,
  damageScalingMultiplier,
  skillLevelBonuses,
  effectiveSkillCost,
  isEnergyPoolEnabled,
  getActiveDamageElements,
  getAttributeLabel,
  getNpcTierConfig
} from "../core/config.js";
import { averageRoll } from "../skills/skill-cost-rules.js";
import { applyDamageReductions, damageScaleFor, situationalDamageFactor } from "./damage-roll.js";
import { unitHp } from "./encounter-rules.js";

/** Alvos que um ataque em área acerta, por padrão (o canvas: "até 3"). */
export const DEFAULT_AREA_TARGETS = 3;

/** Nave/Veículo ficam de fora nesta versão (têm a cascata de 3 camadas própria). */
export function canSimulate(actor) {
  return actor?.type === "character";
}

/**
 * Os ataques de dano de uma ficha: Skills (e Sub-Skills) de dano e armas equipadas.
 * @returns {Array<{id, label, mech, kind: "skill"|"weapon", cost, area: boolean}>}
 */
export function attackOptions(actor) {
  const out = [];
  const charges = isEnergyPoolEnabled();
  for (const item of actor?.items ?? []) {
    if (item.type === "skill") {
      const s = item.system;
      const list = [{ id: item.id, label: item.name, mech: s }, ...(s.subSkills ?? []).map((sub, i) => ({ id: `${item.id}:${i}`, label: `${item.name} — ${sub.name}`, mech: sub }))];
      for (const entry of list) {
        const m = entry.mech;
        if (m.effectType !== "damage" || !String(m.damageFormula ?? "").trim()) continue;
        out.push({
          id: entry.id,
          label: entry.label,
          mech: m,
          kind: "skill",
          cost: charges ? effectiveSkillCost(m.cost, m.level) : 0,
          area: m.targetType === "emission" || m.targetType === "zone"
        });
      }
    } else if (item.type === "item" && item.system.weapon?.enabled && item.system.equipped) {
      const w = item.system.weapon;
      const ammo = w.magazineSize > 0 ? w.loadedAmmo ?? null : null;
      if (!String(ammo?.damageFormula || w.damageFormula || "").trim()) continue;
      out.push({
        id: item.id,
        label: item.name,
        kind: "weapon",
        cost: 0,
        area: false,
        mech: {
          damageFormula: ammo?.damageFormula?.trim() || w.damageFormula,
          scalingAttribute: w.scalingAttribute,
          isMagicDamage: w.isMagicDamage,
          isAbsoluteDamage: w.isAbsoluteDamage || Boolean(ammo?.isAbsoluteDamage),
          damageScale: w.damageScale,
          damageElements: ammo?.damageElements?.length ? ammo.damageElements : w.damageElements,
          level: 1
        }
      });
    }
  }
  return out;
}

/** O golpe antes das defesas do alvo: média × Escala por Atributo × Poder do nível. */
function rawAverage(actor, option) {
  const avg = averageRoll(option.mech.damageFormula);
  const scaling = damageScalingMultiplier(actor, option.mech.scalingAttribute);
  const power = option.kind === "skill" ? skillLevelBonuses(option.mech.level).power : 1;
  return { avg, scaling, power, raw: avg * scaling * power };
}

/**
 * Golpe médio de `attacker` com `option` em `target`, com a conta linha a linha (prancha 2).
 * @returns {{damage: number, rows: Array<{label: string, value: string}>}}
 */
export function averageHit(attacker, option, target) {
  const fmt = n => (Math.round(n * 100) / 100).toString().replace(".", ",");
  const { avg, scaling, power, raw } = rawAverage(attacker, option);
  const scale = damageScaleFor(attacker, option.mech, target);
  const situational = situationalDamageFactor(attacker, target, option.mech);
  const reduction = applyDamageReductions(raw * scale * situational, option.mech, target, { attacker, triggerConditions: false });
  const elements = getActiveDamageElements();
  const elementNames = (option.mech.damageElements ?? []).map(id => elements.find(e => e.id === id)?.label ?? id).join(" + ") || "sem elemento";
  const rows = [{ label: `Dano médio de ${option.mech.damageFormula}`, value: fmt(avg) }];
  if (scaling !== 1) rows.push({ label: `Escala por ${getAttributeLabel(option.mech.scalingAttribute)}`, value: `× ${fmt(scaling)}` });
  if (power !== 1) rows.push({ label: `Nível ${option.mech.level} da Skill`, value: `× ${fmt(power)}` });
  if (scale !== 1) rows.push({ label: "Escala de tamanho", value: `× ${fmt(scale)}` });
  if (situational !== 1) rows.push({ label: "Quando → Então de quem ataca", value: `× ${fmt(situational)}` });
  rows.push({ label: `${elementNames}${option.mech.isMagicDamage ? ", Dano Mágico" : ""}${option.mech.isAbsoluteDamage ? ", Dano Absoluto" : ""}`, value: fmt(raw * scale * situational) });
  for (const r of reduction.traceRows ?? []) if (r.label) rows.push({ label: r.label, value: r.value ?? "" });
  rows.push({ label: `Golpe médio em ${target.name}`, value: String(reduction.finalDamage), kind: "total" });
  return { damage: reduction.finalDamage, rows };
}

/** Vida antes do Nível de NPC + Escudo atual (a mesma base que a ficha usa). */
function hpBaseOf(actor) {
  const hp = actor.system?.attributes?.hp ?? {};
  return Math.max(1, Number(hp.hpMaxBeforeTier ?? hp.max) || 1);
}

/**
 * Uma unidade do simulador a partir de uma ficha.
 * @param {Actor} actor
 * @param {{key: string, count?: number, tier?: string|null, npc?: boolean}} options
 */
export function unitFor(actor, { key, count = 1, tier = null, npc = false } = {}) {
  return {
    key,
    name: actor.name,
    actor,
    count,
    npc,
    tier: npc ? tier ?? (actor.system?.npcTier || "normal") : null,
    hpBase: hpBaseOf(actor),
    shield: Math.max(0, Number(actor.system?.attributes?.shield?.value) || 0),
    energyMax: Math.max(0, Number(actor.system?.attributes?.energy?.max) || 0),
    options: attackOptions(actor)
  };
}

/**
 * Monta os dois lados para encounter-rules.js: escolhe o ataque de cada unidade (o pedido em
 * `choices[key]`, senão o de maior dano por rodada contra o outro lado), calcula o golpe médio
 * contra cada tipo de alvo e os usos que cabem na Mana.
 * @param {{allies: Array, foes: Array}} sides - unidades de `unitFor`
 * @param {{choices?: Record<string, string>, areaTargets?: Record<string, number>}} [settings]
 */
export function buildSides({ allies, foes }, { choices = {}, areaTargets = {} } = {}) {
  const hitCache = new Map();
  const hit = (attacker, option, target) => {
    const id = `${attacker.key}|${option.id}|${target.key}`;
    if (!hitCache.has(id)) hitCache.set(id, averageHit(attacker.actor, option, target.actor));
    return hitCache.get(id);
  };
  const prepare = (side, enemies) =>
    side.map(unit => {
      const targets = option => (option.area ? Math.max(1, Number(areaTargets[`${unit.key}|${option.id}`] ?? DEFAULT_AREA_TARGETS)) : 1);
      const perRound = option => {
        const total = enemies.reduce((sum, e) => sum + hit(unit, option, e).damage * (e.count ?? 1), 0);
        const count = enemies.reduce((sum, e) => sum + (e.count ?? 1), 0) || 1;
        return (total / count) * Math.min(targets(option), count);
      };
      const ranked = [...unit.options].sort((a, b) => perRound(b) - perRound(a));
      const chosen = unit.options.find(o => o.id === choices[unit.key]) ?? ranked[0] ?? null;
      const free = ranked.find(o => !(o.cost > 0) && o !== chosen) ?? null;
      const toAttack = option =>
        option
          ? {
              id: option.id,
              label: option.label,
              targets: targets(option),
              uses: option.cost > 0 ? Math.floor(unit.energyMax / option.cost) : Infinity,
              perTarget: Object.fromEntries(enemies.map(e => [e.key, hit(unit, option, e).damage]))
            }
          : null;
      const attack = toAttack(chosen);
      if (attack && free) attack.fallback = toAttack(free);
      return { ...unit, attack, chosenId: chosen?.id ?? null };
    });
  return { allies: prepare(allies, foes), foes: prepare(foes, allies), hit };
}

/** Vida efetiva para a tabela (com o Nível de NPC e o Escudo). */
export function displayHp(unit) {
  const tiers = getNpcTierConfig();
  return unitHp(unit, { elite: tiers.eliteHp, boss: tiers.bossHp });
}

/**
 * Ator TEMPORÁRIO (não salvo) a partir de um rascunho do Gerador de NPC — o simulador precisa das
 * Skills, armas e atributos dele, mas sem criar ficha.
 */
export async function temporaryActorFromDraft(draft) {
  const { getActiveNpcArchetypes } = await import("../core/config.js");
  const { archetypeSkillItem, archetypeItemData } = await import("../npc/npc-generator.js");
  const archetype = getActiveNpcArchetypes().find(a => a.id === draft.archetypeId);
  const items = archetype
    ? [
        ...archetype.skills.filter(s => draft.skillKeys.includes(s.key)).map(s => archetypeSkillItem(s, draft.skillLevel)),
        ...archetype.items.filter(i => draft.itemKeys.includes(i.key)).map(archetypeItemData)
      ]
    : [];
  const ActorClass = CONFIG.Actor.documentClass;
  return new ActorClass({
    name: draft.name,
    type: "character",
    img: archetype?.img,
    system: {
      isPlayerCharacter: false,
      npcTier: draft.tier || "normal",
      species: draft.species,
      attributes: { level: draft.level, combat: Object.fromEntries(MEU_SISTEMA.COMBAT_ATTRIBUTES.map(k => [k, { points: draft.points[k] ?? 0 }])) }
    },
    items: items.map(i => ({ ...i, _id: foundry.utils.randomID() }))
  });
}
