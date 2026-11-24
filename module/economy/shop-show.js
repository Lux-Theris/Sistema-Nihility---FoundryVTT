/**
 * "Mostrar aos jogadores" (Lojas): o acesso a uma loja é como o Mostrar dos Diários, NÃO uma
 * permissão na ficha. O Mestre escolhe quem recebe a Vitrine; os escolhidos ficam em
 * `system.shop.shownTo` (userIds) e ganham a Vitrine aberta na hora, um card no chat com "Abrir loja"
 * e o clique no Token da loja. Ninguém recebe a ficha. O relay (`shopBuy`/`shopSell`/`shopTrade`)
 * só vale para quem está nessa lista (ou o Mestre; ou, na máquina de venda, quem está perto).
 */
import { SYSTEM_ID, isShopsEnabled } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { canUseShop, shownDiff } from "./shop-rules.js";
import { shopOf, openStorefront } from "./shops.js";

const { DialogV2 } = foundry.applications.api;

/** Os jogadores (não Mestres) do mundo, para o diálogo. */
const playerUsers = () => game.users.filter(u => !u.isGM);

/** Diálogo "Mostrar aos jogadores", no jeito do Mostrar dos Diários: todos ou alguns. */
export async function showShopDialog(shop) {
  const current = new Set(shopOf(shop).shownTo);
  const rows = playerUsers()
    .map(
      u => `<label class="nihility-show-row"><input type="checkbox" name="user" value="${escapeHtml(u.id)}" ${current.has(u.id) ? "checked" : ""}/> <span>${escapeHtml(u.name)}</span> <span class="hint">${u.active ? "conectado" : "desconectado"}${current.has(u.id) ? " · já vê" : ""}</span></label>`
    )
    .join("");
  const picked = await DialogV2.wait({
    window: { title: `Mostrar ${shop.name} aos jogadores`, icon: "fa-solid fa-store" },
    classes: ["nihility-condition-dialog"],
    content: `<div class="nihility-show-shop">
      <p class="hint">Quem você marcar recebe a <b>Vitrine</b> (nunca a ficha) e pode comprar e vender aqui. Ninguém ganha permissão na ficha.</p>
      <label class="nihility-show-row"><input type="checkbox" name="all"/> <b>Todos os jogadores</b></label>
      ${rows || '<p class="hint">Nenhum jogador no mundo.</p>'}
    </div>`,
    buttons: [
      {
        action: "show",
        label: "Mostrar",
        icon: "fa-solid fa-share",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element;
          if (root.querySelector("[name=all]")?.checked) return playerUsers().map(u => u.id);
          return [...root.querySelectorAll("[name=user]:checked")].map(el => el.value);
        }
      },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
  return Array.isArray(picked) ? picked : null;
}

/** Inclui `userIds` na lista da loja (Mestre) e avisa só os que são novos. */
export async function showShopTo(shop, userIds) {
  if (!game.user.isGM || !userIds?.length) return;
  const before = shopOf(shop).shownTo;
  const after = [...new Set([...before, ...userIds])];
  const { added } = shownDiff(before, after);
  await shop.update({ "system.shop.shownTo": after }, { nihilityShow: added });
  if (!added.length) return;
  const names = added.map(id => game.users.get(id)?.name).filter(Boolean).join(", ");
  await ChatMessage.create({
    content: `<div class="nihility-shop-card"><p><b>${escapeHtml(shop.name)}</b> abriu a loja para você.</p><button type="button" data-nihility-open-shop="${escapeHtml(shop.uuid)}">Abrir loja</button></div>`,
    whisper: [...added, ...game.users.filter(u => u.isGM).map(u => u.id)],
    flags: { [SYSTEM_ID]: { openShop: shop.uuid } }
  });
  ui.notifications.info(`${shop.name} mostrada a: ${names}.`);
}

/** Esconde a loja de todos os jogadores (limpa a lista). */
export async function hideShop(shop) {
  if (!game.user.isGM) return;
  await shop.update({ "system.shop.shownTo": [] });
  ui.notifications.info(`${shop.name} escondida dos jogadores.`);
}

/** Ganchos: a Vitrine abre sozinha para quem acabou de receber, e o botão do card abre a loja. */
export function registerShopShow() {
  Hooks.on("updateActor", (actor, changed, options) => {
    if (!isShopsEnabled() || game.user.isGM) return;
    if (!options?.nihilityShow?.includes?.(game.user.id)) return;
    if (canUseShop(actor.system?.shop, game.user.id)) openStorefront(actor).catch(err => reportError("Não abriu a loja.", err));
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    html.querySelectorAll?.("[data-nihility-open-shop]").forEach(button =>
      button.addEventListener("click", async () => {
        const shop = await fromUuid(button.dataset.nihilityOpenShop);
        if (!shop) return ui.notifications.warn("Esta loja não está disponível para você agora. Peça ao Mestre para mostrar de novo.");
        if (!game.user.isGM && !canUseShop(shop.system?.shop, game.user.id)) return ui.notifications.warn("O Mestre escondeu esta loja.");
        openStorefront(shop).catch(err => reportError("Não abriu a loja.", err));
      })
    );
  });
}
