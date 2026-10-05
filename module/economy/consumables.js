/**
 * Consumíveis (granada, poção, kit médico) e carregador de arma pessoal. As regras de gasto
 * (pilha, cargas, carregador) são puras, em consumable-rules.js; aqui só se lê, aplica e grava.
 *
 * Um consumível usa os MESMOS caminhos de uma Skill — `rollSkillDamage`/`rollSkillDamageArea`
 * para dano (com Escala por Atributo, defesas e o card com botões de Aplicar) e
 * `applySkillEffects`/`applySkillEffectsArea` para Efeitos — com uma mecânica montada a partir
 * do bloco `consumable` do Item. Sem Custo, sem XP (não é Skill), nível 1, não mágico a menos que
 * marque Dano Mágico (uma poção não é desfeita pela Antimagia).
 */
import { SYSTEM_ID, isAreaEffectsEnabled, getAmmoTypes } from "../core/config.js";
import { consumeUse, magazineState, ammoFitsWeapon, reloadPlan } from "./consumable-rules.js";
import { findStack } from "./inventory.js";
import { pickTargetActor } from "../helpers/target-picker.js";
import { rollOptionsFromEvent } from "../apps/roll-options-dialog.js";
import { areaEffectsSupported, pickAreaTargets } from "../combat/area-effects.js";
import { rollSkillDamage, rollSkillDamageArea } from "../combat/damage-roll.js";
import { applySkillEffects, applySkillEffectsArea } from "../skills/skill-effects.js";

/** A "mecânica" de um consumível, no formato que os caminhos de Skill entendem. */
export function consumableMech(item) {
  const c = item.system.consumable ?? {};
  return {
    effectType: c.effectType === "damage" ? "damage" : "temporary",
    targetType: c.targetType ?? "self",
    areaShape: c.areaShape || "circle",
    areaDistance: c.areaDistance ?? 3,
    areaAngle: c.areaAngle ?? 53,
    effects: foundry.utils.deepClone(c.effects ?? []),
    damageFormula: c.damageFormula ?? "",
    scalingAttribute: c.scalingAttribute ?? "",
    isMagicDamage: Boolean(c.isMagicDamage),
    damageElements: c.damageElements ?? [],
    level: 1,
    cost: 0,
    sourceLevel: 1,
    sourceMagic: Boolean(c.isMagicDamage),
    magicTag: c.isMagicDamage ? "magic" : "mundane"
  };
}

/** Tira 1 uso (ou 1 carga) do Item; a última unidade some da ficha. */
async function spendUse(item) {
  const c = item.system.consumable ?? {};
  const result = consumeUse({ quantity: item.system.quantity ?? 0, charges: c.charges, used: c.chargesUsed });
  if (result.gone) await item.delete();
  else await item.update({ "system.quantity": result.quantity, "system.consumable.chargesUsed": result.used });
  return result;
}

/**
 * "Usar" um consumível: escolhe o alvo (si / um alvo / uma área no mapa), aplica e gasta 1.
 * Cancelar a escolha não gasta nada; uma granada jogada onde não havia ninguém gasta (explodiu).
 * @param {Actor} actor - quem usa (dono do Item)
 * @param {Item} item
 * @param {{shiftKey?: boolean}|Event} [event] - Shift abre os modificadores de rolagem (só dano)
 */
export async function useConsumable(actor, item, event = null) {
  if (!actor?.isOwner || !item?.system?.consumable?.enabled) return null;
  if ((item.system.quantity ?? 0) <= 0) {
    ui.notifications.warn(`${item.name} acabou.`);
    return null;
  }
  const mech = consumableMech(item);
  const label = item.name;
  const isDamage = mech.effectType === "damage";
  if (isDamage && !mech.damageFormula.trim()) {
    ui.notifications.warn(`${item.name} não tem uma Fórmula de Dano configurada.`);
    return null;
  }
  if (!isDamage && !mech.effects.length) {
    ui.notifications.warn(`${item.name} não tem nenhum Efeito configurado.`);
    return null;
  }

  let rollOptions = null;
  if (isDamage) {
    const asked = await rollOptionsFromEvent(event, label);
    if (asked.cancelled) return null;
    rollOptions = asked.options;
  }

  try {
    if (mech.targetType === "emission" && isAreaEffectsEnabled() && areaEffectsSupported()) {
      const targets = await pickAreaTargets({ system: mech });
      // Sem `origin` = cancelou a colocação (pickAreaTargets devolve [] nos dois casos).
      if (!targets.origin) return null;
      if (isDamage) await rollSkillDamageArea(actor, mech, label, targets, rollOptions);
      else if (targets.length) await applySkillEffectsArea(actor, item, mech, label, targets);
      else ui.notifications.info(`${label}: ninguém na área.`);
    } else {
      // Área sem mapa (ou bloco de Emissão desligado) cai no alvo único, como uma Skill de área.
      const target =
        mech.targetType === "self" ? actor : await pickTargetActor({ self: actor, title: `Usar ${label}`, confirmLabel: "Usar", preferMap: true });
      if (!target) return null;
      const done = isDamage ? await rollSkillDamage(actor, mech, label, target, rollOptions) : await applySkillEffects(actor, item, mech, label, target);
      if (!done) return null;
    }
  } catch (err) {
    console.error(`${SYSTEM_ID} | Falha ao usar ${item.name}.`, err);
    return null;
  }
  return spendUse(item);
}

/** A arma pode atacar agora? Sem carregador, sempre; com carregador, só se houver disparo. */
export function weaponCanFire(weapon) {
  const w = weapon?.system?.weapon ?? {};
  const mag = magazineState({ size: w.magazineSize, loaded: w.loaded });
  if (mag.uses && mag.empty) {
    ui.notifications.warn(`${weapon.name} está sem munição — use Recarregar.`);
    return false;
  }
  return true;
}

/** Itens de munição do Ator que servem nesta arma (com quantidade). */
export function ammoForWeapon(actor, weapon) {
  const accepted = weapon?.system?.weapon?.ammoTypes ?? [];
  return (actor?.items ?? []).filter(
    i => i.type === "item" && i.system.ammo?.enabled && (i.system.quantity ?? 0) > 0 && ammoFitsWeapon(i.system.ammo.type, accepted)
  );
}

/** Rótulo de uma munição na lista: "Célula comum ×5 · aberta (4) · Célula". */
function ammoOptionLabel(item, types) {
  const rounds = Number(item.system.ammo.rounds) || 0;
  const type = types[item.system.ammo.type];
  return `${item.name} ×${item.system.quantity}${rounds ? ` · aberta (${rounds})` : ""}${type ? ` · ${type}` : ""}`;
}

/**
 * Janela de troca: mostra o que está na arma e o que vai acontecer com ele, deixa escolher a
 * munição nova ou só descarregar. Devolve `{action: "load", item}`, `{action: "unload"}` ou null.
 */
async function reloadDialog(weapon, candidates, mag, current) {
  const esc = foundry.utils.escapeHTML;
  const types = Object.fromEntries(getAmmoTypes().map(t => [t.id, t.label]));
  const plan = reloadPlan({ size: mag.max, loaded: mag.loaded });
  const inside = current
    ? `<p>Na arma: <strong>${mag.loaded}/${mag.max}</strong> · ${esc(current.label ?? "munição")} — ${
        plan.returned ? (plan.returned.rounds ? `volta para o inventário aberta (${plan.returned.rounds})` : "volta cheia para a pilha") : "vazia"
      }${current.source ? "" : " <em>(carregada antes desta versão: se perde)</em>"}.</p>`
    : `<p>Carregador vazio.</p>`;
  const select = candidates.length
    ? `<label>Carregar <select name="ammo">${candidates.map(i => `<option value="${i.id}">${esc(ammoOptionLabel(i, types))}</option>`).join("")}</select></label>`
    : `<p><em>Nenhuma outra munição compatível no inventário.</em></p>`;
  const buttons = [];
  if (candidates.length) {
    buttons.push({ action: "load", label: "Carregar", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=ammo]").value });
  }
  if (mag.loaded > 0) buttons.push({ action: "unload", label: "Só descarregar", callback: () => "__unload" });
  buttons.push({ action: "cancel", label: "Cancelar" });
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: `Munição — ${weapon.name}` },
    content: `<div class="nihility-reload-dialog">${inside}${select}</div>`,
    buttons,
    rejectClose: false
  });
  if (answer === "__unload") return { action: "unload" };
  const item = candidates.find(i => i.id === answer);
  return item ? { action: "load", item } : null;
}

/** Devolve ao inventário o que estava no carregador (cheio para a pilha, aberto à parte). */
async function returnLoadedAmmo(actor, weapon, mag) {
  const { returned } = reloadPlan({ size: mag.max, loaded: mag.loaded });
  const source = weapon.system.weapon.loadedAmmo?.source;
  if (!returned || !source) return;
  const data = foundry.utils.deepClone(source);
  data.system.quantity = 1;
  data.system.ammo.rounds = returned.rounds;
  data.system.containerId = "";
  data.system.equipped = false;
  const stack = findStack(actor, data, "");
  if (stack) await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + 1 });
  else await actor.createEmbeddedDocuments("Item", [data]);
}

/**
 * "Recarregar" / trocar munição. Gasta 1 Item de munição compatível (uma unidade aberta dá só os
 * disparos que tinha) e o que estava dentro VOLTA para o inventário: cheio para a pilha, pela
 * metade como unidade aberta (`ammo.rounds`). A munição que entra fica guardada na arma
 * (`loadedAmmo`, com os dados do Item em `source` para poder voltar): fórmula, elementos e Dano
 * Absoluto dela valem nos disparos. Carregador vazio com uma única munição compatível recarrega
 * direto; os outros casos abrem a janela de troca (com "Só descarregar").
 */
export async function reloadWeapon(actor, weapon) {
  if (!actor?.isOwner || !weapon?.system?.weapon?.enabled) return null;
  const w = weapon.system.weapon;
  const mag = magazineState({ size: w.magazineSize, loaded: w.loaded });
  if (!mag.uses) return null;
  const candidates = ammoForWeapon(actor, weapon);
  const current = mag.loaded > 0 ? w.loadedAmmo ?? { label: "munição" } : null;
  if (!candidates.length && !current) {
    ui.notifications.warn(`Sem munição compatível com ${weapon.name} no inventário.`);
    return null;
  }
  const choice = !current && candidates.length === 1 ? { action: "load", item: candidates[0] } : await reloadDialog(weapon, candidates, mag, current);
  if (!choice) return null;

  if (choice.action === "unload") {
    await returnLoadedAmmo(actor, weapon, mag);
    await weapon.update({ "system.weapon.loaded": 0, "system.weapon.loadedAmmo": null });
    ui.notifications.info(`${weapon.name} descarregada.`);
    return true;
  }

  const ammoItem = choice.item;
  const ammo = ammoItem.system.ammo;
  const plan = reloadPlan({ size: mag.max, loaded: mag.loaded, ammoRounds: ammo.rounds });
  // Os dados do Item, para a munição poder voltar ao inventário numa troca futura.
  const source = ammoItem.toObject();
  delete source._id;
  delete source.sort;
  source.system.ammo.rounds = 0;
  const left = consumeUse({ quantity: ammoItem.system.quantity ?? 0 });
  if (left.gone) await ammoItem.delete();
  else await ammoItem.update({ "system.quantity": left.quantity });
  await returnLoadedAmmo(actor, weapon, mag);
  await weapon.update({
    "system.weapon.loaded": plan.loaded,
    "system.weapon.loadedAmmo": {
      type: ammo.type ?? "",
      label: ammoItem.name,
      damageFormula: ammo.damageFormula ?? "",
      damageElements: ammo.damageElements ?? [],
      isAbsoluteDamage: Boolean(ammo.isAbsoluteDamage),
      source
    }
  });
  ui.notifications.info(`${weapon.name} carregada com ${ammoItem.name} (${plan.loaded}/${mag.max}).`);
  return true;
}
