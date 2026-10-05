/**
 * Inventário (documento): soltar Item na ficha (empilhar, mover entre fichas, guardar em
 * contêiner), dividir pilha, equipar, e o contexto da aba Inventário / do Porão. As contas
 * (slots, pilhas, peso, carga) são puras e testadas em config.js (`inventoryLoad`, `stackCount`…);
 * os números do Personagem saem prontos de `system.inventory` (character-model.js).
 */
import { chargesLeft, magazineState } from "./consumable-rules.js";
import { MEU_SISTEMA, stackCount, isInventoryEnabled } from "../core/config.js";
import { createGrantedSkill, removeGrantedSkill } from "../skills/skill-economy.js";

const { DialogV2 } = foundry.applications.api;

/** Mesmo Item pra empilhar: Item Geral de mesmo nome e imagem, nenhum dos dois contêiner, no mesmo lugar. */
export function findStack(actor, data, containerId) {
  if (data.system?.container?.enabled) return null;
  // Munição aberta (com disparos sobrando) não empilha com a cheia, nem com outra aberta diferente.
  const rounds = Number(data.system?.ammo?.rounds) || 0;
  return actor.items.find(
    i =>
      i.type === "item" &&
      i.name === data.name &&
      i.img === data.img &&
      !i.system.container?.enabled &&
      (Number(i.system.ammo?.rounds) || 0) === rounds &&
      (i.system.containerId ?? "") === containerId
  ) ?? null;
}

/** Avisa quando passou dos slots (o sistema não bloqueia: a mesa decide). */
function warnOverflow(actor) {
  if (["starship", "vehicle"].includes(actor.type)) {
    const used = actor.system.cargoLoad?.looseSlots ?? 0;
    const slots = actor.system.cargoSlots ?? 0;
    if (used > slots) ui.notifications.warn(`${actor.name}: Porão cheio (${used}/${slots} slots).`);
    return;
  }
  const inv = actor.system.inventory;
  if (inv && inv.usedSlots > inv.slots) ui.notifications.warn(`${actor.name}: inventário cheio (${inv.usedSlots}/${inv.slots} slots).`);
}

/**
 * Item solto numa ficha (Personagem ou Nave). Item Geral:
 *  - da própria ficha: sobre um contêiner (`[data-container-id]`) guarda nele; senão, ordena (padrão);
 *  - de fora: soma na pilha igual, se houver; senão cria. Vindo da ficha de OUTRO Ator que o
 *    usuário controla, é MOVER (sai de lá) — do Diretório ou Compêndio continua sendo cópia.
 * Outros tipos seguem o caminho padrão (`fallback`).
 */
export async function handleItemDrop(sheet, event, dropped, fallback) {
  const actor = sheet.actor;
  if (!actor?.isOwner || !isInventoryEnabled()) return fallback();
  let item = dropped;
  if (!(item instanceof foundry.abstract.Document)) item = await Item.implementation.fromDropData(dropped);
  if (!item || item.type !== "item") return fallback();

  const containerEl = event?.target?.closest?.("[data-container-id]");
  const target = containerEl?.dataset.containerId ?? null;
  const containerId = target && target !== "loose" ? target : "";

  if (item.parent?.uuid === actor.uuid) {
    if (target === null || target === item.id) return fallback();
    await item.update({ "system.containerId": containerId });
    return item;
  }

  const data = item.toObject();
  delete data._id;
  data.system.containerId = containerId;
  data.system.equipped = false;
  const quantity = Math.max(1, Number(data.system.quantity) || 1);
  const stack = findStack(actor, data, containerId);
  let result;
  if (stack) {
    await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + quantity });
    result = stack;
  } else {
    [result] = await actor.createEmbeddedDocuments("Item", [data]);
  }

  const source = item.parent;
  if (source?.documentName === "Actor" && source.uuid !== actor.uuid && source.isOwner) {
    // Contêiner que sai leva a identidade, não o conteúdo: o que estava dentro fica solto lá.
    const orphans = source.items.filter(i => i.system?.containerId === item.id).map(i => ({ _id: i.id, "system.containerId": "" }));
    if (orphans.length) await source.updateEmbeddedDocuments("Item", orphans);
    if (item.system.equipped) await removeGrantedSkill(source, item.id);
    await item.delete();
  }
  warnOverflow(actor);
  return result;
}

/** Divide uma pilha: pergunta quantos saem e cria outra pilha com eles (no mesmo lugar). */
export async function splitStack(item) {
  const quantity = Number(item?.system?.quantity) || 0;
  if (quantity < 2) return;
  const amount = await DialogV2.wait({
    window: { title: `Dividir — ${item.name}` },
    content: `<div class="nihility-split-stack"><p>Quantos separar? (1 a ${quantity - 1})</p><input type="number" name="amount" min="1" max="${quantity - 1}" value="${Math.floor(quantity / 2)}"/></div>`,
    buttons: [
      { action: "ok", label: "Dividir", default: true, callback: (event, button, dialog) => Number(dialog.element.querySelector('[name="amount"]').value) || 0 },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  const n = Math.min(quantity - 1, Math.max(0, Math.floor(Number(amount) || 0)));
  if (!n) return;
  const copy = item.toObject();
  delete copy._id;
  copy.system.quantity = n;
  copy.system.equipped = false;
  await item.update({ "system.quantity": quantity - n });
  await item.parent.createEmbeddedDocuments("Item", [copy]);
}

/** Equipar/desequipar: concede ou tira a Habilidade do Item (mesmo caminho da ficha do Item). */
export async function toggleEquipped(item) {
  const actor = item?.parent;
  if (!actor) return;
  const equipped = !item.system.equipped;
  await item.update({ "system.equipped": equipped });
  if (equipped) await createGrantedSkill(actor, item.system.grantsSkill, item.id);
  else await removeGrantedSkill(actor, item.id);
}

export const INVENTORY_FILTERS = [
  ["all", "Todos"],
  ["equipped", "Equipados"],
  ["weapons", "Armas"],
  ["containers", "Contêineres"],
  ["ammo", "Munição"]
];
export const INVENTORY_SORTS = [
  ["name", "Nome"],
  ["weight", "Peso"],
  ["quantity", "Quantidade"]
];

function itemRow(item, containers) {
  const sys = item.system;
  const quantity = Number(sys.quantity) || 0;
  const stacks = sys.container?.enabled ? 1 : stackCount(quantity, sys.stackSize);
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    quantity,
    stacks,
    stackSize: sys.stackSize ?? MEU_SISTEMA.ITEM_STACK_DEFAULT,
    weight: Math.round((Number(sys.weight) || 0) * quantity * 100) / 100,
    equipped: Boolean(sys.equipped),
    isWeapon: Boolean(sys.weapon?.enabled),
    weaponFormula: sys.weapon?.damageFormula ?? "",
    isContainer: Boolean(sys.container?.enabled),
    isAmmo: Boolean(sys.ammo?.enabled),
    // Munição aberta (tirada da arma numa troca): quantos disparos sobraram.
    ammoRounds: sys.ammo?.enabled ? Number(sys.ammo.rounds) || 0 : 0,
    // Consumível: botão Usar e, com cargas, "3/5" da unidade aberta.
    isConsumable: Boolean(sys.consumable?.enabled),
    chargesText: sys.consumable?.enabled && (sys.consumable.charges ?? 0) > 1 ? `${chargesLeft({ charges: sys.consumable.charges, used: sys.consumable.chargesUsed })}/${sys.consumable.charges}` : "",
    // Arma com carregador: disparos e Recarregar.
    magazine: sys.weapon?.enabled ? magazineState({ size: sys.weapon.magazineSize, loaded: sys.weapon.loaded, capacity: sys.weapon.loadedAmmo?.capacity }) : null,
    canSplit: quantity > 1,
    hasContainers: containers.some(c => c.id !== item.id),
    containerId: sys.containerId ?? "",
    containerOptions: [{ id: "", label: "— solto —" }, ...containers.filter(c => c.id !== item.id)].map(c => ({
      id: c.id,
      label: c.label,
      selected: c.id === (sys.containerId ?? "")
    }))
  };
}

/** Contexto da aba Inventário do Personagem. */
export function inventoryContext(actor, { filter = "all", sort = "name" } = {}) {
  const summary = actor.system.inventory ?? { containers: [], byContainer: {} };
  const containers = summary.containers ?? [];
  const containerIds = new Set(containers.map(c => c.id));
  const matches = {
    all: () => true,
    equipped: r => r.equipped,
    weapons: r => r.isWeapon,
    containers: r => r.isContainer,
    ammo: r => r.isAmmo
  }[filter] ?? (() => true);
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    weight: (a, b) => b.weight - a.weight,
    quantity: (a, b) => b.quantity - a.quantity
  }[sort] ?? ((a, b) => a.name.localeCompare(b.name));
  const rows = actor.items
    .filter(i => i.type === "item")
    .map(i => itemRow(i, containers))
    .filter(matches)
    .sort((a, b) => (a.equipped === b.equipped ? by(a, b) : a.equipped ? -1 : 1));
  const loose = rows.filter(r => !containerIds.has(r.containerId) || r.containerId === r.id);
  const groups = containers.map(c => {
    const used = summary.byContainer?.[c.id]?.used ?? 0;
    return {
      ...c,
      used,
      full: !c.unlimited && used > c.slots,
      rows: rows.filter(r => r.containerId === c.id && r.id !== c.id)
    };
  });
  return {
    summary,
    slotsOver: summary.usedSlots > summary.slots,
    slotsPercent: summary.slots ? Math.min(100, Math.round((summary.usedSlots / summary.slots) * 100)) : 100,
    weightPercent: summary.capacity ? Math.min(100, Math.round((summary.weight / summary.capacity) * 100)) : 100,
    loose,
    groups,
    filters: INVENTORY_FILTERS.map(([id, label]) => ({ id, label, selected: id === filter })),
    sorts: INVENTORY_SORTS.map(([id, label]) => ({ id, label, selected: id === sort }))
  };
}

/** Contexto do Porão de uma Nave/Veículo. */
export function cargoContext(ship) {
  const sys = ship.system;
  const load = sys.cargoLoad ?? { looseSlots: 0, weight: 0 };
  const factor = sys.cargoMassFactor ?? 1;
  return {
    slots: sys.cargoSlots ?? 0,
    used: load.looseSlots,
    weight: load.weight,
    full: load.looseSlots > (sys.cargoSlots ?? 0),
    massFactor: factor > 1 ? factor.toFixed(2) : "",
    enginePenalty: factor > 1 ? Math.round((1 - 1 / factor) * 100) : 0,
    rows: (sys.cargoItems ?? []).map(i => itemRow(i, [])).sort((a, b) => a.name.localeCompare(b.name))
  };
}
