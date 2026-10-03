/**
 * Maldições (prancha 6) — o lado Foundry. A conta é pura (core/curse-rules.js).
 *
 * Aplicar: uma entrada de Efeito de Skill (ou de elemento, ou a marcação à mão) com uma Condição
 * que é Maldição vira UM Active Effect com os efeitos de atributo/Deslocamento como `changes`, os de
 * dano/cura por rodada guardados na flag, o nível de quem lançou (`sourceLevel`) e `magic: true` —
 * a Antimagia de nível que alcance tira, como qualquer efeito mágico. Reaplicar renova (fica o maior
 * nível; a piora acumulada fica).
 *
 * Início do turno da vítima (Mestre, depois da manutenção das Habilidades Ativas): cobra o custo da
 * Mana dela e aplica o que a maldição faz sem pagamento; depois os efeitos por rodada.
 */
import { SYSTEM_ID, getActiveStatusConditions, getCharacterEnergyLabel, isEnergyPoolEnabled } from "../core/config.js";
import { normalizeCurse, curseCostRound, curseScaled, CURSE_UNPAID } from "../core/curse-rules.js";
import { buildEffectChanges, createActiveEffects } from "../helpers/foundry-compat.js";
import { resolveEffectChange } from "./effect-targets.js";

export const CURSE_FLAG = "curse";

/** Changes de Active Effect dos efeitos de atributo/Deslocamento, com a piora. */
function curseChanges(curse, targetActor, factor) {
  const changes = [];
  for (const fx of curse.effects) {
    if (fx.kind !== "modifier") continue;
    const target = fx.modTarget || "strength";
    let amount = Number(fx.value) || 0;
    // % de atributo: calculado sobre o total de agora (como o efeito padrão de Condição).
    if (target !== "movement" && fx.modMode === "percent") amount = Math.round(((targetActor.system?.attributes?.combat?.[target]?.total ?? 0) * amount) / 100);
    amount = curseScaled(amount, factor);
    if (!amount) continue;
    const change = resolveEffectChange({ target, amount, modifierType: "flat" }, targetActor);
    if (change?.key) changes.push({ key: change.key, mode: change.mode, value: change.value });
  }
  return changes;
}

/**
 * Aplica (ou renova) uma maldição num alvo.
 * @param {Actor} target
 * @param {object} condition - entrada do catálogo de Condições com `curse`
 * @param {{level?:number, label?:string, onUnpaid?:string, partId?:string, caster?:string}} [options]
 * @returns {Promise<string>} linha do resumo
 */
export async function applyCurse(target, condition, { level = 0, label = "", onUnpaid = "", partId = "", caster = "" } = {}) {
  const curse = normalizeCurse(condition.curse);
  const mode = CURSE_UNPAID.includes(onUnpaid) ? onUnpaid : curse.onUnpaid;
  const existing = target.effects.find(e => e.flags?.[SYSTEM_ID]?.[CURSE_FLAG]?.conditionId === condition.id);
  if (existing) {
    const flags = existing.flags[SYSTEM_ID];
    const nextLevel = Math.max(Number(flags.sourceLevel) || 0, Math.max(0, Number(level) || 0));
    await existing.update({
      name: `${condition.label} · nv ${nextLevel}`,
      [`flags.${SYSTEM_ID}.sourceLevel`]: nextLevel,
      [`flags.${SYSTEM_ID}.${CURSE_FLAG}.onUnpaid`]: mode
    });
    return `${condition.label}: renovada (nv ${nextLevel})`;
  }
  const lvl = Math.max(0, Number(level) || 0);
  await createActiveEffects(target, [
    {
      name: `${condition.label} · nv ${lvl}`,
      img: condition.icon || "icons/svg/skull.svg",
      statuses: [condition.id],
      ...buildEffectChanges(curseChanges(curse, target, 1)),
      flags: {
        [SYSTEM_ID]: {
          skillEffect: true,
          conditionId: condition.id,
          sourceLevel: lvl,
          magic: true,
          healBlockPartId: partId || "",
          [CURSE_FLAG]: { conditionId: condition.id, onUnpaid: mode, factor: 1, sleeping: false, caster, label }
        }
      }
    }
  ]);
  return `${condition.label} (nv ${lvl}${caster ? `, de ${caster}` : ""})`;
}

/**
 * Início do turno da vítima (Mestre): cada maldição cobra a Mana, faz o que faz sem pagamento e
 * aplica os efeitos por rodada (se não estiver dormindo). Posta um resumo.
 */
export async function tickCurses(actor) {
  if (actor?.type !== "character") return null;
  const catalog = new Map(getActiveStatusConditions().map(c => [c.id, c]));
  const curses = actor.effects.filter(e => e.flags?.[SYSTEM_ID]?.[CURSE_FLAG]);
  if (!curses.length) return null;
  const rows = [];
  const energyLabel = getCharacterEnergyLabel();
  for (const effect of curses) {
    const state = effect.flags[SYSTEM_ID][CURSE_FLAG];
    const condition = catalog.get(state.conditionId);
    if (!condition?.curse) continue;
    const curse = normalizeCurse(condition.curse);
    const attrs = actor.system.attributes;
    const energyOn = isEnergyPoolEnabled();
    const round = energyOn
      ? curseCostRound({ energy: attrs.energy.value, energyMax: attrs.energy.max, costPercent: curse.costPercent, onUnpaid: state.onUnpaid, factor: state.factor, worsenStep: curse.worsenStep, worsenCap: curse.worsenCap, sleeping: state.sleeping })
      : { energy: attrs.energy.value, cost: 0, paid: true, missing: 0, hpLoss: 0, sleeping: false, factor: state.factor ?? 1 };
    const parts = [];
    const update = {};
    if (round.cost) {
      update["system.attributes.energy.value"] = round.energy;
      parts.push(`−${attrs.energy.value - round.energy} ${energyLabel}${round.paid ? "" : ` (faltaram ${round.missing})`}`);
    }
    if (round.hpLoss) {
      update["system.attributes.hp.value"] = Math.max(0, attrs.hp.value - round.hpLoss);
      parts.push(`−${round.hpLoss} Vida (sem ${energyLabel})`);
    }
    if (Object.keys(update).length) await actor.update(update);

    // Estado da maldição: dormindo (efeitos desligados) e piora.
    const effectUpdate = {};
    if (round.sleeping !== Boolean(state.sleeping)) {
      effectUpdate[`flags.${SYSTEM_ID}.${CURSE_FLAG}.sleeping`] = round.sleeping;
      effectUpdate.disabled = round.sleeping;
      parts.push(round.sleeping ? "dormiu" : "acordou");
    }
    if (round.factor !== (state.factor ?? 1)) {
      effectUpdate[`flags.${SYSTEM_ID}.${CURSE_FLAG}.factor`] = round.factor;
      Object.assign(effectUpdate, buildEffectChanges(curseChanges(curse, actor, round.factor)));
      parts.push(`piorou (×${round.factor.toFixed(2)})`);
    }
    if (Object.keys(effectUpdate).length) await effect.update(effectUpdate);

    // Efeitos por rodada (dano/cura), com a piora — não agem dormindo.
    if (!round.sleeping) {
      for (const fx of curse.effects.filter(f => f.kind === "tick")) {
        const target = fx.tickTarget === "energy" ? "energy" : "hp";
        const attr = actor.system.attributes[target];
        const base = fx.valueMode === "maxPercent" ? Math.round(((attr.max ?? 0) * (Number(fx.value) || 0)) / 100) : Number(fx.value) || 0;
        const amount = curseScaled(Math.max(1, Math.abs(base)), round.factor);
        const delta = fx.tickSign === "heal" ? amount : -amount;
        const next = Math.max(0, Math.min(attr.max, attr.value + delta));
        if (next === attr.value) continue;
        await actor.update({ [`system.attributes.${target}.value`]: next });
        parts.push(`${next - attr.value > 0 ? "+" : ""}${next - attr.value} ${target === "hp" ? "Vida" : energyLabel}`);
      }
    }
    if (parts.length) rows.push(`<li><strong>${foundry.utils.escapeHTML(effect.name)}</strong>: ${parts.join(" · ")}</li>`);
  }
  if (rows.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> — maldições no início do turno:</p><ul>${rows.join("")}</ul>`
    });
  }
  return rows;
}
