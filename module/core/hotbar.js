/**
 * Skills e armas na hotbar (H14): arrastar a linha da ficha para a barra cria uma macro que
 * chama exatamente o mesmo caminho do botão (Usar / Atacar / Disparar), inclusive Shift para os
 * modificadores de rolagem.
 *
 * **Tipo de arrasto próprio (`NihilityAction`)**, e não o arrasto de Item do Foundry: soltar um
 * Item comum na ficha de outro Ator cria uma cópia — com a linha da Skill arrastável, um jogador
 * com dois personagens copiaria Skills de graça, por fora da economia de Pontos. As fichas
 * ignoram este tipo; só a hotbar o entende. Linhas que já tinham arrasto de Item (inventário,
 * para mover entre contêineres) continuam como estavam, e a hotbar aceita esse também.
 *
 * Macro de script é permitida a Jogador por padrão no core (`MACRO_SCRIPT`, papel padrão
 * PLAYER); se o Mestre tiver tirado essa permissão, a criação falha e o jogador recebe um aviso.
 */
import { SYSTEM_ID, moduleRole } from "./config.js";

const DRAG_TYPE = "NihilityAction";
const ACTION_BUTTONS = '[data-action="useSkill"], [data-action="attackWithWeapon"], [data-action="fireWeapon"], [data-action="useConsumable"]';

/** O Item faz algo pela hotbar? Skill, arma de Personagem, Módulo de Arma. Só Itens dentro de um Ator. */
function hotbarKind(item) {
  if (!item || item.parent?.documentName !== "Actor") return null;
  if (item.type === "skill") return "skill";
  if (item.type === "item" && item.system?.consumable?.enabled) return "consumable";
  if (item.type === "item" && item.system?.weapon?.enabled) return "weapon";
  if (item.type === "starship_module" && moduleRole(item.system?.category) === "weapon") return "shipWeapon";
  return null;
}

/**
 * Deixa arrastáveis, para a hotbar, as linhas da ficha que têm botão de ação. Chamado no
 * `_onRender` de cada ficha (Personagem e Nave/Veículo).
 */
export function enableHotbarDrag(root, actor) {
  if (!root || !actor?.isOwner) return;
  for (const button of root.querySelectorAll(ACTION_BUTTONS)) {
    const row = button.closest("[data-item-id]");
    if (!row || row.dataset.hotbarDrag || row.hasAttribute("draggable")) continue;
    const item = actor.items.get(row.dataset.itemId);
    if (!hotbarKind(item)) continue;
    row.dataset.hotbarDrag = "1";
    row.setAttribute("draggable", "true");
    row.title ||= "Arraste para a hotbar para usar num clique";
    row.addEventListener("dragstart", event => {
      event.stopPropagation();
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG_TYPE, uuid: item.uuid }));
    });
  }
}

async function createActionMacro(item, slot) {
  const command = `game.nihility.useItem(${JSON.stringify(item.uuid)});`;
  try {
    let macro = game.macros.find(m => m.command === command && (m.author?.id ?? m.author) === game.user.id);
    macro ??= await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command,
      flags: { [SYSTEM_ID]: { itemMacro: item.uuid } }
    });
    if (macro) await game.user.assignHotbarMacro(macro, slot);
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Não foi possível criar a macro de "${item.name}".`, err);
    ui.notifications.warn("Não foi possível criar a macro — peça ao Mestre a permissão de usar macros de script.");
  }
}

/** `hotbarDrop` é síncrono: decide aqui, cria a macro depois. `false` impede a macro padrão do core. */
function onHotbarDrop(_hotbar, data, slot) {
  if (data?.type !== DRAG_TYPE && data?.type !== "Item") return;
  const item = typeof data.uuid === "string" ? fromUuidSync(data.uuid) : null;
  if (!hotbarKind(item)) return;
  createActionMacro(item, slot);
  return false;
}

/**
 * O que a macro chama: resolve o Item e roda o mesmo método do botão da ficha. `useItem(uuid)`
 * fica em `game.nihility` para a macro continuar valendo mesmo depois de uma atualização do
 * sistema (o texto da macro é só esta chamada).
 */
export async function useItemFromHotbar(uuid) {
  const item = typeof uuid === "string" ? await fromUuid(uuid) : null;
  const kind = hotbarKind(item);
  if (!kind) {
    ui.notifications.warn("Esta macro aponta para uma Skill ou arma que não existe mais.");
    return;
  }
  const actor = item.parent;
  if (!actor.isOwner) {
    ui.notifications.warn(`Você não controla ${actor.name}.`);
    return;
  }
  const event = { shiftKey: Boolean(game.keyboard?.isModifierActive?.("Shift")) };
  // Consumível não depende da ficha: o caminho é o mesmo do botão Usar do inventário.
  if (kind === "consumable") {
    const { useConsumable } = await import("../economy/consumables.js");
    return useConsumable(actor, item, event);
  }
  const sheet = actor.sheet;
  const method = { skill: "useSkillItem", weapon: "attackWithWeaponItem", shipWeapon: "fireWeaponItem" }[kind];
  if (typeof sheet?.[method] !== "function") {
    ui.notifications.warn(`A ficha de ${actor.name} não sabe usar ${item.name} pela hotbar.`);
    return;
  }
  return sheet[method](item.id, event);
}

/** Liga o hook. Chamado uma vez, no `init`. */
export function registerHotbarMacros() {
  Hooks.on("hotbarDrop", onHotbarDrop);
}
