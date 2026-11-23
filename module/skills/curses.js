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
export async function applyCurse(target, condition, { level = 0, label = "", onUnpaid = "", partId = "", caster = "", appliedBy = "" } = {}) {
  const curse = normalizeCurse(condition.curse);
  const mode = CURSE_UNPAID.includes(onUnpaid) ? onUnpaid : curse.onUnpaid;
  const existing = target.effects.find(e => e.flags?.[SYSTEM_ID]?.[CURSE_FLAG]?.conditionId === condition.id);
  if (existing) {
    const flags = existing.flags[SYSTEM_ID];
    const nextLevel = Math.max(Number(flags.sourceLevel) || 0, Math.max(0, Number(level) || 0));
    await existing.update({
      name: `${condition.label} · nv ${nextLevel}`,
      [`flags.${SYSTEM_ID}.sourceLevel`]: nextLevel,
      [`flags.${SYSTEM_ID}.${CURSE_FLAG}.onUnpaid`]: mode,
      ...(appliedBy ? { [`flags.${SYSTEM_ID}.appliedBy`]: appliedBy } : {})
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
          appliedBy: appliedBy || "",
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
 *
 * Ritmo do tempo (8e): a maldição segue o ritmo do personagem, como um "número por turno". Com `steps` > 1
 * (Acelerado ×N) a conta anda `steps` vezes em memória (custo, piora, sono e efeitos por rodada, volta a volta,
 * parando se a Vida chega a 0) e é gravada uma vez por maldição. `steps` 0 (Desacelerado, turno parado): nada anda.
 * A maldição não tem prazo próprio (acaba por Antimagia, Dissipar ou à mão), então só o N limita.
 */
export async function tickCurses(actor, { steps = 1, notes = null } = {}) {
  if (actor?.type !== "character" || steps <= 0) return null;
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
    // Estado simulado em memória.
    const sim = { energy: attrs.energy.value, hp: attrs.hp.value, factor: state.factor ?? 1, sleeping: Boolean(state.sleeping) };
    const start = { energy: sim.energy, hp: sim.hp };
    let missingTotal = 0;
    let costed = false;
    let energySpent = 0;
    let hpLost = 0;
    let slept = null;
    let worsened = false;
    const tickTotals = { hp: 0, energy: 0 };
    let done = 0;
    for (let turn = 0; turn < steps; turn++) {
      done++;
      const round = energyOn
        ? curseCostRound({ energy: sim.energy, energyMax: attrs.energy.max, costPercent: curse.costPercent, onUnpaid: state.onUnpaid, factor: sim.factor, worsenStep: curse.worsenStep, worsenCap: curse.worsenCap, sleeping: sim.sleeping })
        : { energy: sim.energy, cost: 0, paid: true, missing: 0, hpLoss: 0, sleeping: false, factor: sim.factor };
      if (round.cost) {
        costed = true;
        energySpent += sim.energy - round.energy;
        sim.energy = round.energy;
        if (!round.paid) missingTotal += round.missing;
      }
      if (round.hpLoss) {
        sim.hp = Math.max(0, sim.hp - round.hpLoss);
        hpLost += round.hpLoss;
      }
      if (round.sleeping !== sim.sleeping) slept = round.sleeping;
      sim.sleeping = round.sleeping;
      if (round.factor !== sim.factor) worsened = true;
      sim.factor = round.factor;
      // Efeitos por rodada (dano/cura), com a piora: não agem dormindo.
      if (!sim.sleeping) {
        for (const fx of curse.effects.filter(f => f.kind === "tick")) {
          const target = fx.tickTarget === "energy" ? "energy" : "hp";
          const attr = actor.system.attributes[target];
          const current = sim[target];
          const base = fx.valueMode === "maxPercent" ? Math.round(((attr.max ?? 0) * (Number(fx.value) || 0)) / 100) : Number(fx.value) || 0;
          const amount = curseScaled(Math.max(1, Math.abs(base)), sim.factor);
          const delta = fx.tickSign === "heal" ? amount : -amount;
          const next = Math.max(0, Math.min(attr.max, current + delta));
          sim[target] = next;
          tickTotals[target] += next - current;
        }
      }
      if (sim.hp <= 0) break;
    }
    const parts = [];
    const update = {};
    if (costed) {
      parts.push(`−${energySpent} ${energyLabel}${missingTotal ? ` (faltaram ${missingTotal})` : ""}`);
    }
    if (hpLost) parts.push(`−${hpLost} Vida (sem ${energyLabel})`);
    if (sim.energy !== start.energy) update["system.attributes.energy.value"] = sim.energy;
    if (sim.hp !== start.hp) update["system.attributes.hp.value"] = sim.hp;
    if (Object.keys(update).length) await actor.update(update);

    // Estado da maldição: dormindo (efeitos desligados) e piora.
    const effectUpdate = {};
    if (sim.sleeping !== Boolean(state.sleeping)) {
      effectUpdate[`flags.${SYSTEM_ID}.${CURSE_FLAG}.sleeping`] = sim.sleeping;
      effectUpdate.disabled = sim.sleeping;
      parts.push(sim.sleeping ? "dormiu" : "acordou");
    }
    if (sim.factor !== (state.factor ?? 1)) {
      effectUpdate[`flags.${SYSTEM_ID}.${CURSE_FLAG}.factor`] = sim.factor;
      Object.assign(effectUpdate, buildEffectChanges(curseChanges(curse, actor, sim.factor)));
      parts.push(`piorou (×${sim.factor.toFixed(2)})`);
    }
    if (Object.keys(effectUpdate).length) await effect.update(effectUpdate);
    for (const target of ["hp", "energy"]) {
      if (tickTotals[target]) parts.push(`${tickTotals[target] > 0 ? "+" : ""}${tickTotals[target]} ${target === "hp" ? "Vida" : energyLabel}`);
    }
    if (done > 1 && parts.length) parts.push(`em ${done} turnos`);
    if (parts.length) {
      rows.push(`<li><strong>${foundry.utils.escapeHTML(effect.name)}</strong>: ${parts.join(" · ")}</li>`);
      if (notes) notes.push({ label: effect.name, text: parts.join(" · ") });
    }
  }
  if (rows.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> — maldições no início do turno:</p><ul>${rows.join("")}</ul>`
    });
  }
  return rows;
}
