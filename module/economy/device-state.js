/**
 * Placas e programas (Lote 9) — a leitura do estado, leve de propósito (só config + regras puras): a
 * preparação da ficha e os coletores de bônus a importam sem puxar a cadeia de Skills. Quem grava é
 * `economy/devices.js`.
 */
import { isDevicesEnabled } from "../core/config.js";
import { sourceSuppressed } from "../core/suppression.js";
import { normalizeDevice, offExpired, deviceWorks, deviceBlockReason } from "./device-rules.js";

/** O `system.device` do Item, normalizado, ou null se não for uma placa. */
export function deviceOf(item) {
  const raw = item?.system?.device;
  return raw?.enabled ? normalizeDevice(raw) : null;
}

/** Os Itens do Ator que são placas. */
export function actorDevices(actor) {
  return (actor?.items ?? []).filter(i => i.type === "item" && i.system?.device?.enabled);
}

/** Ids dos combates começados (para o "off" que acaba com o combate). */
function liveCombatIds() {
  return (game.combats?.contents ?? []).filter(c => c.started).map(c => c.id);
}

/** Segundos de uma rodada para contar o "off" fora de combate (o do relógio do mundo, senão 6). */
function roundSeconds() {
  return Number(CONFIG.time?.roundTime) || 6;
}

/** A placa como está AGORA: um "off" que já venceu (fim do combate, ou rodadas do relógio) conta como normal. */
export function liveDevice(item) {
  const device = deviceOf(item);
  if (!device) return null;
  if (device.state === "off" && offExpired(device, { now: game.time?.worldTime ?? 0, roundSeconds: roundSeconds(), liveCombatIds: liveCombatIds() })) {
    return { ...device, state: "normal" };
  }
  return device;
}

/** A placa funciona agora (ligada, normal e o dono sem PEM/Antimagia que a alcance)? */
export function deviceWorksNow(actor, item) {
  const device = liveDevice(item);
  if (!device) return false;
  return deviceWorks(device, { techSuppressed: sourceSuppressed(actor, item) });
}

/** Por que a placa não funciona agora, ou "" se funciona. */
export function deviceBlockedReason(actor, item) {
  const device = liveDevice(item);
  if (!device) return "este Item não é uma placa";
  return deviceBlockReason(device, { techSuppressed: sourceSuppressed(actor, item) });
}

/**
 * Os programas instalados em placas que funcionam, nos Itens EQUIPADOS do Ator: `{host, uid, item}`
 * (`item` = o dado do programa guardado na placa). Vazio com o bloco "Placas e programas" desligado.
 * É daqui que vêm os bônus passivos do programa.
 */
export function workingPrograms(actor) {
  if (!isDevicesEnabled()) return [];
  const out = [];
  for (const host of actorDevices(actor)) {
    if (!host.system.equipped || !deviceWorksNow(actor, host)) continue;
    for (const entry of host.system.device.programs ?? []) {
      if (entry?.sourceItem?.system) out.push({ host, uid: entry.uid, item: entry.sourceItem });
    }
  }
  return out;
}
