/**
 * Placas e programas (Lote 9) — a leitura do estado, leve de propósito (só config + regras puras): a
 * preparação da ficha e os coletores de bônus a importam sem puxar a cadeia de Skills. Quem grava é
 * `economy/devices.js`.
 *
 * HOSPEDEIRO (host) = onde a placa mora. Dois casos, um só endereço (`host.id`, o "ref"):
 *  - um Item Geral do Ator com `system.device.enabled`: o ref é o id do Item e o hospedeiro é o próprio Item;
 *  - uma placa dentro de um implante/prótese JÁ INSTALADO numa Parte do Corpo (o Item inteiro vive em
 *    `mod.sourceItem`): o ref é `<id da parte>~<uid da modificação>` e o hospedeiro é um `ModDeviceHost`, que
 *    se parece com um Item (`id`, `name`, `system`, `uuid`, `update`) e grava reescrevendo a lista inteira
 *    `installedMods` da parte (nunca por caminho de índice). O uid é gravado ao instalar (anatomy.js).
 * O resto do código só fala com hospedeiros (`actorDevices`, `findDeviceHost`) e nunca olha de onde vêm.
 */
import { isDevicesEnabled } from "../core/config.js";
import { sourceSuppressed } from "../core/suppression.js";
import { normalizeDevice, offExpired, deviceWorks, deviceBlockReason, modHostRef, modUidOf, findModIndex, parseHostRef, parseDeviceSourceKey } from "./device-rules.js";

/**
 * A placa de um implante/prótese instalado, com a cara de um Item. Lê a Parte ao vivo (`system`, `name`) e
 * grava reescrevendo `installedMods` inteira, achando a modificação pelo uid (a ordem pode ter mudado).
 */
export class ModDeviceHost {
  isMod = true;
  type = "item";

  constructor(actor, part, mod, index) {
    this.parent = actor;
    this.part = part;
    this.mod = mod;
    this.index = index;
    this.uid = modUidOf(mod, index);
    this.id = modHostRef(part.id, this.uid);
  }

  get name() {
    return this.mod.sourceItem?.name || this.mod.name || "Placa";
  }

  get system() {
    return this.mod.sourceItem?.system ?? {};
  }

  get img() {
    return this.mod.sourceItem?.img ?? "";
  }

  get uuid() {
    return this.part.uuid;
  }

  /** Onde a placa está, para a ficha ("implante · Cabeça"). */
  get where() {
    const kind = this.mod.kind === "prosthesis" ? "prótese" : "implante";
    return `${kind} · ${this.mod.location || this.part.name}`;
  }

  /**
   * Grava mudanças `{"system.device.reserve": 3}` na placa: regrava a lista `installedMods` da parte (cópia
   * profunda, a modificação achada pelo uid) e devolve a Parte atualizada. `options` segue para o `update`.
   */
  async update(changes, options = {}) {
    const part = this.parent.items.get(this.part.id) ?? this.part;
    const mods = foundry.utils.deepClone(part.system.installedMods ?? []);
    const at = findModIndex(mods, this.uid);
    if (at < 0 || !mods[at].sourceItem) return null;
    for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(mods[at].sourceItem, path, foundry.utils.deepClone(value));
    return part.update({ "system.installedMods": mods }, options);
  }
}

/** O `system.device` do Item (ou hospedeiro), normalizado, ou null se não for uma placa. */
export function deviceOf(item) {
  const raw = item?.system?.device;
  return raw?.enabled ? normalizeDevice(raw) : null;
}

/** A placa conta como "vestida"? Implante instalado sim; Item solto só equipado. */
export function hostEquipped(host) {
  return Boolean(host?.isMod || host?.system?.equipped);
}

/** Os hospedeiros dentro de implantes/próteses instalados nas Partes do Corpo do Ator. */
function modHosts(actor) {
  const out = [];
  for (const part of actor?.items ?? []) {
    if (part.type !== "body_part") continue;
    (part.system.installedMods ?? []).forEach((mod, index) => {
      if (mod?.sourceItem?.system?.device?.enabled) out.push(new ModDeviceHost(actor, part, mod, index));
    });
  }
  return out;
}

/** As placas do Ator: Itens com placa e placas dentro de implantes instalados (cada uma é um hospedeiro). */
export function actorDevices(actor) {
  const items = (actor?.items ?? []).filter(i => i.type === "item" && i.system?.device?.enabled);
  return [...items, ...modHosts(actor)];
}

/** O hospedeiro de um endereço (`host.id`), ou null se saiu (a peça foi tirada, a parte apagada). */
export function findDeviceHost(actor, ref) {
  const parsed = parseHostRef(ref);
  if (!parsed || !actor) return null;
  if (parsed.kind === "item") {
    const item = actor.items?.get(parsed.itemId);
    return item?.type === "item" && item.system?.device?.enabled ? item : null;
  }
  const part = actor.items?.get(parsed.partId);
  if (part?.type !== "body_part") return null;
  const mods = part.system.installedMods ?? [];
  const index = findModIndex(mods, parsed.modUid);
  return index >= 0 && mods[index]?.sourceItem?.system?.device?.enabled ? new ModDeviceHost(actor, part, mods[index], index) : null;
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
 * Os programas instalados em placas que funcionam, nos hospedeiros VESTIDOS do Ator (Item equipado ou implante
 * instalado): `{host, uid, item}` (`item` = o dado do programa guardado na placa). Vazio com o bloco "Placas e
 * programas" desligado. É daqui que vêm os bônus passivos do programa.
 */
export function workingPrograms(actor) {
  if (!isDevicesEnabled()) return [];
  const out = [];
  for (const host of actorDevices(actor)) {
    if (!hostEquipped(host) || !deviceWorksNow(actor, host)) continue;
    for (const entry of host.system.device.programs ?? []) {
      if (entry?.sourceItem?.system) out.push({ host, uid: entry.uid, item: entry.sourceItem });
    }
  }
  return out;
}

/**
 * A placa e o programa de uma Habilidade concedida por programa: `{host, uid, entry}` ou null (a Skill não é de
 * placa, ou a placa saiu). A chave é `device:<ref>:<uid>` (`deviceSourceKey`).
 */
export function deviceSkillHost(actor, skill, systemId) {
  const key = parseDeviceSourceKey(skill?.flags?.[systemId]?.grantedBySource);
  if (!key) return null;
  const host = findDeviceHost(actor, key.hostRef);
  if (!host) return null;
  const entry = (host.system.device.programs ?? []).find(p => p.uid === key.uid) ?? null;
  return { host, uid: key.uid, entry };
}
