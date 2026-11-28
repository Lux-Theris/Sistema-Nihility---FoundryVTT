/**
 * Placas e programas (Lote 9) — o lado Foundry. A conta é pura (device-rules.js); a leitura do estado
 * está em device-state.js. Aqui: instalar/tirar programa (de graça, como o implante), pagar a Reserva
 * no uso de uma Habilidade de programa, recarregar (Descanso, Célula, ação), PEM e curto-circuito,
 * conserto (com relay) e os ganchos de chat/combate.
 *
 * A placa vive num Item do Ator (`system.device`); o programa instalado é guardado inteiro na lista
 * `device.programs` (`{uid, sourceItem}`) e volta ao inventário ao sair. A Habilidade de um programa
 * ativo é concedida com a chave `device:<id da placa>:<uid>`. Sempre se regrava a lista inteira.
 */
import { SYSTEM_ID, isDevicesEnabled, getFeatureOption, combatantIsActor, getAttributeLabel, effectiveSkillCost, getEnergyLabelForActor } from "../core/config.js";
import { floatTextOnActor } from "../combat/floating-numbers.js";
import { itemIsMagic } from "../core/magic-rules.js";
import { createGrantedSkill, removeGrantedSkill } from "../skills/skill-economy.js";
import { isDesignatedGm, mayActFor, ownedDoc, owns, runAsGm } from "../helpers/gm-relay.js";
import { RELAY_REASONS, refuse } from "../helpers/gm-relay-rules.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { consumeUse } from "./consumable-rules.js";
import {
  normalizeDevice, programFits, programCost, payProgramCost, restRecharge, cellRecharge, actionRecharge, empReserveDrain,
  rollShortCircuit, shortCircuitHit, disasterDamageFormula, deviceSourceKey, parseDeviceSourceKey, isEnergyCell, canRepairDevice, needsRepair,
  normalizeShortBands, DEFAULT_SHORT_BANDS, DEFAULT_CURTO_CHANCE_ON_EMP, OFF_OUT_OF_COMBAT_ROUNDS,
  modHostRef, reserveState, reservePips, slotLayout, rechargeOptions, programCostTag, skillDeviceStatus, restReserveLine
} from "./device-rules.js";
import { deviceOf, actorDevices, findDeviceHost, hostEquipped, liveDevice, deviceWorksNow, deviceBlockedReason, deviceSkillHost } from "./device-state.js";
import { sourceSuppressed } from "../core/suppression.js";

const SHORT_FLAG = "deviceShort";
const PROGRESS_FLAG = "deviceSkillProgress";

const clone = value => foundry.utils.deepClone(value);

/** Opções de um `update` que fazem todo cliente subir um texto sobre o Token ("−2 Reserva"). Um objeto novo a cada escrita. */
const floatOptions = (text, fill = "#6ee7ff") => ({ nihilityFloat: { text, fill } });

/* ------------------------------------------------------------------ opções */

/** As faixas do curto-circuito escolhidas nas opções do bloco. */
export function shortBands() {
  return normalizeShortBands({
    leveMax: getFeatureOption("devices", "shortLeveMax") ?? DEFAULT_SHORT_BANDS.leveMax,
    graveMax: getFeatureOption("devices", "shortGraveMax") ?? DEFAULT_SHORT_BANDS.graveMax
  });
}

/** Chance de curto por PEM, em % (0–100). */
export function curtoChanceOnEmp() {
  return Math.min(100, Math.max(0, Number(getFeatureOption("devices", "curtoChanceOnEmp") ?? DEFAULT_CURTO_CHANCE_ON_EMP)));
}

/* ------------------------------------------------------------------ instalar / tirar programa */

/** A natureza da Habilidade de um programa: tecnológica, e mágica se a placa (ou o programa) for. */
function programNature(host, programItem) {
  return { magic: itemIsMagic(host.system) || itemIsMagic(programItem.system ?? {}), tech: true };
}

/**
 * Instala um Item-programa numa placa do Ator (de graça: quem edita a ficha pode). Confere encaixes e
 * `accepts`/`fits`, guarda o Item na placa, concede a Habilidade (se o programa dá uma) e tira 1 do
 * inventário (se o Item era desta ficha).
 * @returns {Promise<boolean>}
 */
export async function installProgram(actor, hostRef, item) {
  if (!isDevicesEnabled()) return false;
  const host = findDeviceHost(actor, hostRef);
  const device = deviceOf(host);
  if (!device) {
    ui.notifications.warn("Este Item não é uma placa.");
    return false;
  }
  const program = item?.system?.program;
  const installed = device.programs.map(p => p.sourceItem?.system?.program).filter(Boolean);
  const fit = programFits(device, installed, program, { hostIsWeapon: Boolean(host.system.weapon?.enabled) });
  if (!fit.ok) {
    ui.notifications.warn(`${item?.name ?? "Programa"} não entra em ${host.name}: ${fit.reason}.`);
    return false;
  }
  const sourceItem = item.toObject();
  delete sourceItem._id;
  sourceItem.system.quantity = 1;
  const progress = sourceItem.flags?.[SYSTEM_ID]?.[PROGRESS_FLAG] ?? null;
  const uid = foundry.utils.randomID();
  if (item.system.grantsSkill?.name) {
    const created = await createGrantedSkill(actor, item.system.grantsSkill, deviceSourceKey(host.id, uid), programNature(host, item));
    // A Habilidade que voltou com o programa recupera o nível e a XP que tinha ao sair.
    if (created && progress) {
      const update = {};
      if (Number(progress.level) > 0) update["system.level"] = Number(progress.level);
      if (Number(progress.xp) >= 0) update["system.xp"] = Number(progress.xp);
      if (Object.keys(update).length) await created.update(update);
    }
  }
  if (sourceItem.flags?.[SYSTEM_ID]) delete sourceItem.flags[SYSTEM_ID][PROGRESS_FLAG];
  const programs = [...clone(host.system.device.programs ?? []), { uid, sourceItem }];
  await host.update({ "system.device.programs": programs });
  if (item.parent?.uuid === actor.uuid) {
    const quantity = Number(item.system.quantity) || 1;
    if (quantity > 1) await item.update({ "system.quantity": quantity - 1 });
    else await item.delete();
  }
  ui.notifications.info(`${item.name} instalado em ${host.name}.`);
  return true;
}

/**
 * Tira o programa `uid` da placa: a Habilidade que ele concedia sai (com o nível e a XP guardados dentro do
 * Item devolvido, para reinstalar restaurar) e o Item volta ao inventário.
 * @returns {Promise<boolean>}
 */
export async function uninstallProgram(actor, hostRef, uid) {
  const host = findDeviceHost(actor, hostRef);
  if (!host?.system?.device) return false;
  const list = clone(host.system.device.programs ?? []);
  const entry = list.find(p => p.uid === uid);
  if (!entry) return false;
  const key = deviceSourceKey(host.id, uid);
  const skill = actor.items.find(i => i.type === "skill" && i.flags?.[SYSTEM_ID]?.grantedBySource === key);
  const returned = clone(entry.sourceItem);
  if (skill) {
    returned.flags ??= {};
    returned.flags[SYSTEM_ID] ??= {};
    returned.flags[SYSTEM_ID][PROGRESS_FLAG] = { level: Number(skill.system.level) || 1, xp: Number(skill.system.xp) || 0 };
    await removeGrantedSkill(actor, key);
  }
  await host.update({ "system.device.programs": list.filter(p => p.uid !== uid) });
  if (returned) await actor.createEmbeddedDocuments("Item", [returned]);
  return true;
}

/** A placa foi apagada: as Habilidades dos programas dela saem junto (gancho `preDeleteItem`). */
export async function removeDeviceGrants(item) {
  const actor = item?.parent;
  if (!actor) return;
  for (const entry of item.system?.device?.programs ?? []) await removeGrantedSkill(actor, deviceSourceKey(item.id, entry.uid));
  // Uma Parte do Corpo apagada leva junto as placas dos implantes que tinha.
  if (item.type === "body_part") {
    const mods = item.system.installedMods ?? [];
    for (let index = 0; index < mods.length; index++) {
      const ref = modHostRef(item.id, mods[index].uid || `idx${index}`);
      for (const entry of mods[index]?.sourceItem?.system?.device?.programs ?? []) await removeGrantedSkill(actor, deviceSourceKey(ref, entry.uid));
    }
  }
}

/**
 * A placa mudou de endereço (um Item virou implante instalado, ou o contrário): as Habilidades dos programas dela
 * saem da chave antiga e voltam na nova, com o nível e a XP que tinham. `hostSystem` = o `system` do Item da placa.
 */
export async function rekeyHostGrants(actor, fromRef, toRef, programs, hostSystem = {}) {
  for (const entry of programs ?? []) {
    const grants = entry?.sourceItem?.system?.grantsSkill;
    if (!grants?.name) continue;
    const oldKey = deviceSourceKey(fromRef, entry.uid);
    const old = actor.items.find(i => i.type === "skill" && i.flags?.[SYSTEM_ID]?.grantedBySource === oldKey);
    const progress = old ? { level: Number(old.system.level) || 1, xp: Number(old.system.xp) || 0 } : null;
    if (old) await removeGrantedSkill(actor, oldKey);
    const nature = { magic: itemIsMagic(hostSystem) || itemIsMagic(entry.sourceItem.system ?? {}), tech: true };
    const created = await createGrantedSkill(actor, grants, deviceSourceKey(toRef, entry.uid), nature);
    if (created && progress) await created.update({ "system.level": progress.level, "system.xp": progress.xp });
  }
}

/* ------------------------------------------------------------------ pagar a Reserva */

/**
 * O que o uso de uma Habilidade concedida por programa custa, ANTES de gravar nada. `null` = a Skill não é
 * de placa (ou o bloco está desligado): o fluxo normal paga. Senão `{ok, host, reserveAfter, manaCost, reserveSpent, reason}`;
 * `ok: false` já avisou o jogador.
 * @param {number} cost - o Custo que a Skill pagaria (em energia)
 */
export function planDevicePayment(actor, skill, cost) {
  if (!isDevicesEnabled() || skill?.parent?.uuid !== actor?.uuid) return null;
  const key = parseDeviceSourceKey(skill.flags?.[SYSTEM_ID]?.grantedBySource);
  if (!key) return null;
  const host = findDeviceHost(actor, key.hostRef);
  const device = liveDevice(host);
  if (!device) return null;
  const block = deviceBlockedReason(actor, host);
  if (block) {
    ui.notifications.warn(`${skill.name}: ${block}. Nada foi gasto.`);
    return { ok: false, host, reason: block };
  }
  const entry = (host.system.device.programs ?? []).find(p => p.uid === key.uid);
  const amount = programCost({ skillCost: cost, costPerUse: entry?.sourceItem?.system?.program?.costPerUse });
  const pay = payProgramCost({ cost: amount, reserve: device.reserve, nature: device.nature, infinite: device.infinite });
  if (!pay.ok) {
    ui.notifications.warn(`${skill.name}: ${host.name} está sem Reserva (precisa de ${amount}, tem ${device.reserve}). Nada foi gasto.`);
    return { ok: false, host, reason: pay.reason };
  }
  return { ok: true, host, reserveAfter: pay.reserveAfter, reserveBefore: device.reserve, manaCost: pay.manaCost, reserveSpent: device.reserve - pay.reserveAfter, reason: pay.reason };
}

/** Grava o que `planDevicePayment` calculou (só a Reserva; a Mana que faltou sai pelo caminho normal). */
export async function commitDevicePayment(plan) {
  if (!plan?.ok || plan.reserveSpent <= 0) return;
  await plan.host.update({ "system.device.reserve": plan.reserveAfter }, floatOptions(`−${plan.reserveSpent} Reserva`));
}

/* ------------------------------------------------------------------ recarregar */

/** Descanso (curto ou completo): enche a Reserva das placas com "Descanso". Devolve quantas encheu. */
export async function rechargeOnRest(actor) {
  if (!isDevicesEnabled()) return 0;
  let changed = 0;
  // Um a um: duas placas do mesmo implante regravam a mesma lista `installedMods`.
  for (const host of actorDevices(actor)) {
    const r = restRecharge(host.system.device);
    if (!r.changed) continue;
    await host.update({ "system.device.reserve": r.reserve });
    changed++;
  }
  return changed;
}

/** A linha do Descanso: "Reserva volta: Cyberdeck 6/6" (vazia sem placas que recarreguem no Descanso). */
export function restReserveLineFor(actor) {
  if (!isDevicesEnabled() || !actor) return "";
  return restReserveLine(actorDevices(actor).map(host => ({ name: host.name, device: host.system.device })));
}

/** Gasta 1 Célula de energia do inventário e enche a Reserva da placa. */
export async function rechargeWithCell(actor, hostRef) {
  if (!isDevicesEnabled()) return false;
  const host = findDeviceHost(actor, hostRef);
  const check = cellRecharge(host?.system?.device);
  if (!check.ok) {
    ui.notifications.warn(`Não dá para recarregar${host ? ` ${host.name}` : ""}: ${check.reason}.`);
    return false;
  }
  const cell = actor.items.find(i => i.type === "item" && isEnergyCell(i.system));
  if (!cell) {
    ui.notifications.warn("Sem Célula de energia no inventário.");
    return false;
  }
  const left = consumeUse({ quantity: cell.system.quantity ?? 0 });
  if (left.gone) await cell.delete();
  else await cell.update({ "system.quantity": left.quantity });
  const filled = check.reserve - (Number(host.system.device.reserve) || 0);
  await host.update({ "system.device.reserve": check.reserve }, floatOptions(`+${filled} Reserva`));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> trocou a Célula de energia de <strong>${escapeHtml(host.name)}</strong>: Reserva cheia (${check.reserve}).</p>`
  });
  return true;
}

/** Recarga por ação: só fora de combate, soma o valor da placa. */
export async function rechargeByAction(actor, hostRef) {
  if (!isDevicesEnabled()) return false;
  const host = findDeviceHost(actor, hostRef);
  const inCombat = Boolean(game.combats?.some(c => c.started && c.combatants.some(cb => combatantIsActor(cb, actor))));
  const check = actionRecharge(host?.system?.device, inCombat);
  if (!check.ok) {
    ui.notifications.warn(`Não dá para recarregar${host ? ` ${host.name}` : ""}: ${check.reason}.`);
    return false;
  }
  const gained = check.reserve - (Number(host.system.device.reserve) || 0);
  await host.update({ "system.device.reserve": check.reserve }, floatOptions(`+${gained} Reserva`));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${escapeHtml(actor.name)}</strong> recarregou <strong>${escapeHtml(host.name)}</strong>: Reserva ${check.reserve}/${normalizeDevice(host.system.device).reserveMax}.</p>`
  });
  return true;
}

/* ------------------------------------------------------------------ cards de chat */

const STATE_TEXT = { normal: "normal", off: "desligada", damaged: "danificada" };

/**
 * O card de Curto / Conserto (prancha 10): título, linhas "rótulo — valor" e o tom (ok / warn / bad). Todo texto
 * de documento passa por `escapeHtml`. Os botões do Mestre entram depois (renderDeviceShortControls).
 * @param {{icon:string, title:string, tone?:string, lines?:[string,string][]}} card
 */
export function deviceCardHtml({ icon, title, tone = "ok", lines = [] }) {
  const rows = lines.map(([k, v]) => `<div class="ln"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join("");
  return `<div class="nihility-device-card tone-${escapeHtml(tone)}"><h5><i class="fa-solid ${escapeHtml(icon)}"></i> ${escapeHtml(title)}</h5>${rows}</div>`;
}

/* ------------------------------------------------------------------ curto-circuito */

const SEVERITY_TEXT = { leve: "curto leve", grave: "curto grave", desastre: "desastre" };

/** O combate começado em que o Ator está, ou null. */
function startedCombatOf(actor) {
  return (game.combats?.contents ?? []).find(c => c.started && c.combatants.some(cb => combatantIsActor(cb, actor))) ?? null;
}

/** A foto do estado que o Desfazer volta. */
function offFields(device) {
  return { state: device.state, offMode: device.offMode ?? "", offCombatId: device.offCombatId ?? "", offSince: Number(device.offSince) || 0, offRounds: Number(device.offRounds) || OFF_OUT_OF_COMBAT_ROUNDS };
}

/** O dano Elétrico do desastre (implante/prótese): rola, aplica as defesas de quem veste e posta o card com Aplicar. */
async function dealDisasterDamage(actor, host, device) {
  const formula = disasterDamageFormula(device.reserveMax);
  let roll;
  try {
    roll = await new Roll(formula).evaluate();
  } catch (err) {
    reportError(`Desastre em ${host.name}: fórmula de dano inválida (${formula}).`, err, { gmOnly: true });
    return 0;
  }
  const { applyDamageReductions, personalTraceTail } = await import("../combat/damage-roll.js");
  const { damageApplyFlags, withDamageTrace } = await import("../combat/damage-apply.js");
  const mech = { damageElements: ["lightning"], isMagicDamage: false, isAbsoluteDamage: false };
  const reduction = applyDamageReductions(roll.total, mech, actor, { attacker: null });
  const label = `Desastre em ${host.name}`;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${escapeHtml(label)} — ${escapeHtml(actor.name)}: ${reduction.finalDamage} de dano Elétrico`,
    flags: withDamageTrace(
      damageApplyFlags(actor, reduction.finalDamage, {
        shieldBase: reduction.shieldBase,
        elementIds: reduction.elementIds,
        shieldExtra: reduction.shieldExtra ?? 0,
        shieldMultiplier: reduction.shieldMultiplier ?? 1,
        shieldPenetration: reduction.shieldPenetration ?? 0,
        triggeredConditions: reduction.triggeredConditions ?? [],
        sever: reduction.sever,
        label
      }),
      [{ name: actor.name, rows: [{ label: "Rolagem (desastre)", value: String(roll.total) }, ...personalTraceTail(reduction, actor)] }]
    )
  });
  return reduction.finalDamage;
}

/**
 * Curto-circuito numa placa. `roll` (1–100) opcional: sem ele, rola um d100. Leve desliga até o fim do combate
 * (ou 3 rodadas fora dele); grave e desastre danificam; desastre num implante/prótese dá dano Elétrico em quem veste.
 * Posta um card com "Desfazer" (só o Mestre vê o botão). Devolve o resultado ou null.
 */
export async function shortCircuit(actor, hostRef, { roll = null } = {}) {
  if (!isDevicesEnabled()) return null;
  const host = findDeviceHost(actor, hostRef);
  const device = deviceOf(host);
  if (!device) return null;
  const d100 = roll ?? (await new Roll("1d100").evaluate()).total;
  const result = rollShortCircuit(d100, shortBands());
  const before = offFields(device);
  const update = {};
  if (result.state === "damaged") {
    Object.assign(update, { "system.device.state": "damaged", "system.device.offMode": "", "system.device.offCombatId": "" });
  } else if (device.state !== "damaged") {
    // Leve: desliga. Em combate, até o fim dele; fora, por 3 rodadas do relógio.
    const combat = startedCombatOf(actor);
    Object.assign(update, {
      "system.device.state": "off",
      "system.device.offMode": combat ? "combat" : "time",
      "system.device.offCombatId": combat?.id ?? "",
      "system.device.offSince": game.time?.worldTime ?? 0,
      "system.device.offRounds": OFF_OUT_OF_COMBAT_ROUNDS
    });
  }
  if (Object.keys(update).length) await host.update(update);
  // Implante/prótese: o Item com `implant.enabled` ou a placa que já está instalada numa Parte do Corpo.
  const wears = Boolean(host.isMod || host.system.implant?.enabled);
  let damage = null;
  if (result.disaster && wears) damage = await dealDisasterDamage(actor, host, device);
  const after = offFields(normalizeDevice(findDeviceHost(actor, host.id)?.system?.device ?? host.system.device));
  const stopped = (device.programs ?? []).map(p => p.sourceItem?.name).filter(Boolean);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: deviceCardHtml({
      icon: "fa-bolt",
      title: `Curto · ${host.name} de ${actor.name}`,
      tone: result.state === "off" ? "warn" : "bad",
      lines: [
        [`d100 ${d100}`, `${result.severity}: ${result.state === "off" ? "desligou até o fim do combate (fora dele, 3 rodadas)" : "danificada até ser consertada"}`],
        ...(stopped.length ? [["Programas parados", stopped.join(", ")]] : []),
        ...(damage !== null ? [["Dano Elétrico em quem veste", String(damage)]] : [])
      ]
    }),
    flags: { [SYSTEM_ID]: { [SHORT_FLAG]: { actorUuid: actor.uuid, hostItemId: host.id, before, after, undone: false } } }
  });
  floatTextOnActor(actor, `Curto: ${host.name}`, { fill: "#ff8a8a", fontSize: 26 });
  return { ...result, d100, damage };
}

/** O Mestre desfaz um curto (a placa volta ao estado de antes; o dano Elétrico tem o próprio Desfazer). */
export async function undoShortCircuit(message) {
  const info = message.getFlag(SYSTEM_ID, SHORT_FLAG);
  if (!info || info.undone || !game.user.isGM) return false;
  const actor = await fromUuid(info.actorUuid);
  const host = findDeviceHost(actor, info.hostItemId);
  if (!host) return false;
  const b = info.before ?? {};
  await host.update({
    "system.device.state": b.state ?? "normal",
    "system.device.offMode": b.offMode ?? "",
    "system.device.offCombatId": b.offCombatId ?? "",
    "system.device.offSince": b.offSince ?? 0,
    "system.device.offRounds": b.offRounds ?? OFF_OUT_OF_COMBAT_ROUNDS
  });
  await message.setFlag(SYSTEM_ID, SHORT_FLAG, { ...info, undone: true });
  return true;
}

/** Botão "Desfazer" (só o Mestre) no card de curto-circuito. */
export function renderDeviceShortControls(message, html) {
  const info = message.getFlag(SYSTEM_ID, SHORT_FLAG);
  if (!info || !game.user.isGM) return;
  const box = document.createElement("div");
  box.className = "nihility-device-short-controls";
  if (info.undone) {
    box.innerHTML = "<small><i>Desfeito pelo Mestre.</i></small>";
  } else {
    box.innerHTML = '<button type="button" class="device-short-undo"><i class="fa-solid fa-rotate-left"></i> Desfazer</button>';
    box.querySelector("button").addEventListener("click", () => undoShortCircuit(message).catch(err => reportError("Não consegui desfazer o curto-circuito.", err)));
  }
  html.appendChild(box);
}

/* ------------------------------------------------------------------ PEM */

/**
 * Um PEM atingiu o Ator: cada placa EQUIPADA perde Reserva (a fórmula da Nave: 5% × alcance, de 5% a 75% do
 * máximo; a infinita não perde) e rola a chance de curto. Devolve linhas para o resumo da Skill.
 */
export async function empHitDevices(actor, { reach = 0 } = {}) {
  if (!isDevicesEnabled() || !actor) return [];
  const lines = [];
  const chance = curtoChanceOnEmp();
  for (const host of actorDevices(actor)) {
    if (!hostEquipped(host)) continue;
    const device = normalizeDevice(host.system.device);
    const parts = [];
    if (!device.infinite) {
      const drain = empReserveDrain(device.reserve, reach, device.reserveMax);
      if (drain.drained > 0) {
        await host.update({ "system.device.reserve": drain.reserveAfter }, floatOptions(`PEM: −${drain.percent}% Reserva`, "#ff8a8a"));
        parts.push(`Reserva −${drain.drained}`);
      }
    }
    if (chance > 0) {
      const roll = (await new Roll("1d100").evaluate()).total;
      if (shortCircuitHit(roll, chance)) {
        const result = await shortCircuit(actor, host.id);
        if (result) parts.push(SEVERITY_TEXT[result.severity]);
      }
    }
    if (parts.length) lines.push(`${host.name}: ${parts.join(", ")}`);
  }
  return lines;
}

/* ------------------------------------------------------------------ conserto */

/** Conserta a placa direto (Mestre / quem já passou pelo relay): `damaged` ou `off` → `normal`. */
export async function repairDevice(actor, hostRef, { engineer = null, skill = null } = {}) {
  const host = findDeviceHost(actor, hostRef);
  if (!deviceOf(host)) return false;
  const before = liveDevice(host)?.state ?? "normal";
  await host.update({ "system.device.state": "normal", "system.device.offMode": "", "system.device.offCombatId": "" });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: engineer ?? actor }),
    content: deviceCardHtml({
      icon: "fa-screwdriver-wrench",
      title: engineer ? `Conserto · ${engineer.name} → ${host.name} de ${actor.name}` : `Conserto · ${host.name} de ${actor.name}`,
      tone: "ok",
      lines: [
        ...(skill ? [["Skill", `${skill.name} Nv ${Number(skill.system.level) || 1} (Engenharia)`]] : []),
        ["Antes → depois", `${STATE_TEXT[before] ?? before} → normal`]
      ]
    })
  });
  floatTextOnActor(actor, `Consertada: ${host.name}`, { fill: "#6ee7a0", fontSize: 26 });
  return true;
}

/** A Skill de Engenharia que consertou (a de maior nível), para o card. */
function engineeringSkillOf(actor) {
  return (actor?.items ?? []).filter(i => i.type === "skill" && i.system.engineering === true).sort((a, b) => (Number(b.system.level) || 1) - (Number(a.system.level) || 1))[0] ?? null;
}

/** O Ator tem uma Skill com Engenharia? */
export function actorCanRepair(actor) {
  return canRepairDevice((actor?.items ?? []).filter(i => i.type === "skill").map(i => i.system));
}

/**
 * "Consertar…": `engineer` (com Engenharia) conserta a placa `hostItemId` de `target` (pode ser ele mesmo).
 * Vai ao Mestre pelo relay `deviceRepair`; a placa de outra pessoa pede o aval dele.
 * @returns {Promise<{ok:boolean, reason:string}>}
 */
export async function requestDeviceRepair(engineer, target, hostRef) {
  if (!actorCanRepair(engineer)) {
    ui.notifications.warn(`${engineer?.name ?? "Quem conserta"} não tem uma Habilidade de Engenharia.`);
    return { ok: false, reason: "sem Engenharia" };
  }
  return runAsGm("deviceRepair", { engineerUuid: engineer.uuid, actorUuid: target.uuid, hostItemId: hostRef }, { reply: true, timeout: 60000 });
}

/** Lado do Mestre: confere tudo na ficha (nunca no payload), pede o aval se a placa é de outra pessoa e conserta. */
async function deviceRepairAsGm(payload, user) {
  const engineer = await ownedDoc(payload?.engineerUuid, user);
  const target = typeof payload?.actorUuid === "string" ? await fromUuid(payload.actorUuid) : null;
  if (!engineer || !target) return refuse(RELAY_REASONS.invalid);
  if (!(await mayActFor(user, engineer.uuid))) return refuse(RELAY_REASONS.permission);
  const host = findDeviceHost(target, String(payload.hostItemId ?? ""));
  if (!deviceOf(host)) return refuse(RELAY_REASONS.invalid);
  if (!actorCanRepair(engineer)) return refuse("sem Engenharia");
  if (!needsRepair(host.system.device) && liveDevice(host)?.state === "normal") return refuse("a placa não precisa de conserto");
  const own = engineer.uuid === target.uuid || owns(user, target);
  if (!own && !user?.isGM) {
    const approved = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Consertar placa" },
      yes: { label: "Aprovar", icon: "fa-solid fa-check" },
      no: { label: "Recusar", icon: "fa-solid fa-xmark" },
      content: `<div class="nihility-device-approve"><p><strong>${escapeHtml(engineer.name)}</strong> quer consertar <strong>${escapeHtml(host.name)}</strong> de <strong>${escapeHtml(target.name)}</strong>. Aprovar?</p></div>`,
      rejectClose: false
    });
    if (!approved) return refuse("o Mestre não aprovou o conserto");
  }
  const done = await repairDevice(target, host.id, { engineer, skill: engineeringSkillOf(engineer) });
  return done ? { ok: true } : refuse(RELAY_REASONS.invalid);
}

/** Ações do relay deste subsistema (registradas em core/relay-actions.js). */
export const RELAY_HANDLERS = {
  deviceRepair: (payload, user) => deviceRepairAsGm(payload, user)
};

/* ------------------------------------------------------------------ painel da ficha (Inventário) e aba Skills */

/** Quantas Células de energia o Ator carrega. */
function energyCellCount(actor) {
  return (actor?.items ?? []).filter(i => i.type === "item" && isEnergyCell(i.system)).reduce((sum, i) => sum + (Number(i.system.quantity) || 0), 0);
}

/** O Ator está num combate começado? */
function actorInStartedCombat(actor) {
  return Boolean(game.combats?.some(c => c.started && c.combatants.some(cb => combatantIsActor(cb, actor))));
}

/** O que um programa passivo dá, em texto curto ("+2 Precisão · +5 Vida"). Vazio se não dá bônus. */
function passiveBonusText(item) {
  const sys = item?.system ?? {};
  const parts = [];
  for (const b of sys.attributeBonuses ?? []) {
    const n = Number(b.amount) || 0;
    if (n) parts.push(`${n > 0 ? "+" : "−"}${Math.abs(n)} ${getAttributeLabel(b.attribute)}`);
  }
  if (Number(sys.statModifiers?.hp)) parts.push(`${sys.statModifiers.hp > 0 ? "+" : "−"}${Math.abs(sys.statModifiers.hp)} Vida`);
  if (Number(sys.statModifiers?.energy)) parts.push(`${sys.statModifiers.energy > 0 ? "+" : "−"}${Math.abs(sys.statModifiers.energy)} ${"energia"}`);
  if (sys.conditionalModifiers?.length) parts.push(`${sys.conditionalModifiers.length} condicional(is)`);
  return parts.join(" · ");
}

/** A Habilidade concedida a um programa instalado, se existir na ficha. */
function programSkill(actor, hostRef, uid) {
  const key = deviceSourceKey(hostRef, uid);
  return (actor?.items ?? []).find(i => i.type === "skill" && i.flags?.[SYSTEM_ID]?.grantedBySource === key) ?? null;
}

/**
 * O bloco "Placas" da aba Inventário: uma linha por hospedeiro vestido (Item equipado com placa e placas dentro de
 * implantes instalados). `null` com o bloco desligado ou sem placas. Tudo é leitura; os botões chamam as ações da ficha.
 */
export function devicePanelContext(actor) {
  if (!isDevicesEnabled() || !actor) return null;
  const hosts = actorDevices(actor).filter(hostEquipped);
  if (!hosts.length) return null;
  const cells = energyCellCount(actor);
  const inCombat = actorInStartedCombat(actor);
  const isGM = Boolean(game.user?.isGM);
  const canEdit = Boolean(actor.isOwner);
  const myCharacter = game.user?.character;
  const canRepairHere = isGM || actorCanRepair(actor) || actorCanRepair(myCharacter);
  const rows = hosts.map(host => {
    const device = liveDevice(host);
    const works = deviceWorksNow(actor, host);
    const block = works ? "" : deviceBlockedReason(actor, host);
    const reserve = reserveState(device);
    const pips = reservePips(device);
    const layout = slotLayout(device, device.programs);
    const energyLabel = getEnergyLabelForActor(actor);
    const programs = device.programs.map(entry => {
      const item = entry.sourceItem ?? {};
      const skill = programSkill(actor, host.id, entry.uid);
      const grants = item.system?.grantsSkill;
      const passive = passiveBonusText(item);
      let costTag = "";
      if (grants?.name) {
        const cost = programCost({ skillCost: skill ? effectiveSkillCost(skill.system.cost, skill.system) : Number(grants.cost) || 0, costPerUse: item.system?.program?.costPerUse });
        costTag = programCostTag({ cost, infinite: device.infinite });
      }
      return {
        uid: entry.uid,
        name: item.name || "Programa",
        img: item.img || "",
        slots: Math.max(1, Number(item.system?.program?.slotsUsed) || 1),
        costTag,
        passiveTag: passive,
        grantsName: grants?.name ?? ""
      };
    });
    const recharge = rechargeOptions(device, { cells, inCombat });
    return {
      ref: host.id,
      name: host.name,
      where: host.isMod ? host.where : `${host.system.weapon?.enabled ? "arma" : "equipado"}${host.system.weapon?.enabled ? " · equipada" : ""}`,
      technomagic: device.nature === "technomagic",
      stateTag: works ? "" : block.includes("PEM") ? "suprimida" : STATE_TEXT[device.state] ?? "",
      blocked: block,
      damaged: device.state === "damaged",
      off: device.state === "off",
      infinite: device.infinite,
      reserveText: device.infinite ? "infinita" : `${reserve.current}/${reserve.max}`,
      pips: pips.pips.map(on => ({ on })),
      programs,
      freeSlots: layout.freeSlots,
      slotsFree: layout.free,
      slotsTotal: layout.total,
      rechargeOptions: recharge.options,
      rechargeReason: recharge.reason,
      canRecharge: canEdit && recharge.options.length > 0,
      canEdit,
      canShort: isGM,
      canRepair: canRepairHere && (device.state !== "normal"),
      energyLabel
    };
  });
  return { rows, cells };
}

/**
 * As etiquetas das Habilidades de programa na aba Skills: `{skillId: {text, tone, disabled, reason}}`. Só as Skills
 * cuja chave `device:` aponta para uma placa viva.
 */
export function deviceSkillTagsFor(actor) {
  const out = {};
  if (!isDevicesEnabled() || !actor) return out;
  const energyLabel = getEnergyLabelForActor(actor);
  for (const skill of actor.items ?? []) {
    if (skill.type !== "skill") continue;
    const found = deviceSkillHost(actor, skill, SYSTEM_ID);
    if (!found) continue;
    const device = liveDevice(found.host);
    if (!device) continue;
    const cost = programCost({ skillCost: effectiveSkillCost(skill.system.cost, skill.system), costPerUse: found.entry?.sourceItem?.system?.program?.costPerUse });
    out[skill.id] = skillDeviceStatus({ device, cost, hostName: found.host.name, energyLabel, suppressed: sourceSuppressed(actor, found.host) });
  }
  return out;
}

/** Para a frase da Skill: `{name, cost, infinite}` da placa de uma Skill de programa, ou null. */
export function deviceSentenceContext(actor, skill) {
  if (!isDevicesEnabled()) return null;
  const found = deviceSkillHost(actor, skill, SYSTEM_ID);
  const device = found ? liveDevice(found.host) : null;
  if (!device) return null;
  return {
    name: found.host.name,
    infinite: device.infinite,
    cost: programCost({ skillCost: effectiveSkillCost(skill.system.cost, skill.system), costPerUse: found.entry?.sourceItem?.system?.program?.costPerUse })
  };
}

/** "Recarregar ▾": o menu com só as opções que valem. Devolve true se recarregou. */
export async function openRechargeMenu(actor, hostRef) {
  const host = findDeviceHost(actor, hostRef);
  if (!host || !actor?.isOwner) return false;
  const { options, reason } = rechargeOptions(host.system.device, { cells: energyCellCount(actor), inCombat: actorInStartedCombat(actor) });
  if (!options.length) {
    ui.notifications.warn(`Não dá para recarregar ${host.name}: ${reason}.`);
    return false;
  }
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: `Recarregar — ${host.name}` },
    content: `<div class="nihility-device-approve"><p>Como recarregar <strong>${escapeHtml(host.name)}</strong>?</p></div>`,
    buttons: [
      ...options.map(o => ({ action: o.id, label: o.label, callback: () => o.id })),
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  if (choice === "cell") return rechargeWithCell(actor, host.id);
  if (choice === "action") return rechargeByAction(actor, host.id);
  return false;
}

/**
 * "Consertar…" na ficha: o Mestre conserta direto; quem tem Engenharia (esta ficha ou o personagem do jogador) pede
 * pelo relay, que confere tudo e pede o aval do Mestre se a placa for de outra pessoa.
 */
export async function repairFromSheet(actor, hostRef) {
  if (game.user.isGM) return repairDevice(actor, hostRef, { engineer: null, skill: null });
  const engineer = actorCanRepair(actor) && actor.isOwner ? actor : game.user.character;
  if (!engineer) {
    ui.notifications.warn("Nenhum personagem com Engenharia para consertar.");
    return false;
  }
  const result = await requestDeviceRepair(engineer, actor, hostRef);
  if (!result?.ok) ui.notifications.warn(`Conserto recusado${result?.reason ? `: ${result.reason}` : ""}.`);
  return Boolean(result?.ok);
}

/* ------------------------------------------------------------------ manutenção de Skill Ativa de programa */

/**
 * Para a manutenção por rodada (`skills/upkeep.js`): a placa que paga a Skill Ativa `skill`, ou null (não é de
 * programa → paga a energia como sempre). `{host, blocked, device}`: `blocked` = por que a placa não funciona agora ("" se funciona).
 */
export function deviceUpkeepHost(actor, skill) {
  if (!isDevicesEnabled()) return null;
  const found = deviceSkillHost(actor, skill, SYSTEM_ID);
  const device = found ? liveDevice(found.host) : null;
  if (!device) return null;
  return { host: found.host, device, blocked: deviceBlockedReason(actor, found.host) };
}

/** Grava a Reserva que a manutenção gastou (um texto "−N Reserva" sobe do Token). */
export async function commitUpkeepReserve(host, reserveAfter, spent) {
  if (!host || spent <= 0) return;
  await host.update({ "system.device.reserve": reserveAfter }, floatOptions(`−${spent} Reserva`));
}

/* ------------------------------------------------------------------ ganchos */

/** Quando o "off" de uma placa acabou (fim do combate ou rodadas do relógio): grava `normal`. Só o Mestre designado. */
async function clearExpiredOff(actors) {
  for (const actor of actors) {
    for (const host of actorDevices(actor)) {
      if (host.system.device.state !== "off") continue;
      if (liveDevice(host)?.state === "normal") {
        try {
          await host.update({ "system.device.state": "normal", "system.device.offMode": "", "system.device.offCombatId": "" });
        } catch (err) {
          console.warn(`${SYSTEM_ID} | Placa: não consegui religar ${host.name}.`, err);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ arrastar programa (destaque) */

let draggedProgram = null;

/** Guarda o programa que está sendo arrastado (de qualquer janela) para a ficha destacar onde ele cabe. */
function registerProgramDragTracking() {
  document.addEventListener("dragstart", event => {
    draggedProgram = null;
    try {
      const data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
      if (data?.type !== "Item" || !data.uuid) return;
      const item = fromUuidSync(data.uuid);
      const program = item?.system?.program;
      if (program?.enabled) draggedProgram = { name: item.name, program: foundry.utils.deepClone(program) };
    } catch (err) {
      draggedProgram = null;
    }
  });
  document.addEventListener("dragend", () => {
    draggedProgram = null;
  });
}

/** O programa arrastado agora (`{name, program}`) ou null. */
export function currentDraggedProgram() {
  return draggedProgram;
}

/**
 * O programa arrastado cabe nesta placa? `{ok, reason}` com o motivo em pt-BR (o mesmo de `programFits`);
 * sem programa na mão, `null`.
 */
export function dragFitFor(actor, hostRef) {
  const dragged = currentDraggedProgram();
  if (!dragged) return null;
  const host = findDeviceHost(actor, hostRef);
  if (!host) return { ok: false, reason: "a placa não está mais aí" };
  const device = host.system.device;
  const installed = (device.programs ?? []).map(p => p.sourceItem?.system?.program).filter(Boolean);
  return programFits(device, installed, dragged.program, { hostIsWeapon: Boolean(host.system.weapon?.enabled) });
}

export function registerDevices() {
  registerProgramDragTracking();
  Hooks.on("renderChatMessageHTML", (message, html) => renderDeviceShortControls(message, html));
  // O texto sobre o Token ("−2 Reserva", "PEM: −50% Reserva") viaja nas opções do `update`: todo cliente que vê o Token o mostra.
  Hooks.on("updateItem", (item, _changes, options) => {
    const float = options?.nihilityFloat;
    if (!float?.text || !item.parent) return;
    floatTextOnActor(item.parent, float.text, { fill: float.fill, fontSize: 28 });
  });
  // O combate acabou: as placas que desligaram nele voltam (a leitura já conta como normal; isto limpa o dado).
  Hooks.on("deleteCombat", combat => {
    if (!isDevicesEnabled() || !isDesignatedGm()) return;
    const actors = (combat.combatants?.contents ?? []).map(c => c.actor).filter(Boolean);
    // O combate já saiu da lista de combates vivos quando o gancho roda; espera o próximo ciclo para ler.
    setTimeout(() => clearExpiredOff(actors), 0);
  });
  // Fora de combate: o relógio do mundo andou, as placas de 3 rodadas atrás voltam.
  Hooks.on("updateWorldTime", () => {
    if (!isDevicesEnabled() || !isDesignatedGm()) return;
    clearExpiredOff([...game.actors].filter(a => a.type === "character"));
  });
}
