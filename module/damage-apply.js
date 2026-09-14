/**
 * Botões de aplicar dano no card de chat (Aplicar / Metade / Dobro → Desfazer).
 *
 * O sistema sempre calculou o dano e deixou o Mestre digitar o resultado na ficha na mão — uma
 * decisão de design legítima (é ele quem decide o que fazer com o número), mas que virava
 * digitação pura depois que Defesa Mágica e Resistência já tinham sido calculadas. Os botões
 * tiram a digitação sem tirar a decisão: nada acontece sem clique.
 *
 * O card guarda o estado em `flags`, não no DOM: quem abrir o chat depois — ou recarregar a
 * página — vê o mesmo card que quem estava online na hora.
 *
 * **Por que some o botão depois de clicar:** aplicar duas vezes por engano é invisível (o HP só
 * cai mais), então depois do clique os botões dão lugar a um Desfazer, que restaura exatamente o
 * valor anterior guardado na flag. Nada de "aplicar -X de novo", que erraria se algo mais tivesse
 * mexido no HP nesse meio-tempo.
 */
import { SYSTEM_ID } from "./config.js";

/** Onde o dano cai em cada tipo de Ator. Nave/Veículo não entra: lá a cascata já aplica sozinha. */
function hpPath(actor) {
  return actor?.type === "character" ? "system.attributes.hp.value" : null;
}

/**
 * Grava no card os dados que os botões precisam. Chamado por quem posta a rolagem de dano.
 * @param {Actor|null} targetActor
 * @param {number} finalDamage - já com todas as reduções aplicadas
 */
export function damageApplyFlags(targetActor, finalDamage) {
  if (!targetActor || !hpPath(targetActor) || !(finalDamage > 0)) return {};
  return {
    [SYSTEM_ID]: {
      damageApply: { targetUuid: targetActor.uuid, amount: Math.round(finalDamage), applied: null }
    }
  };
}

/** Desenha a faixa de botões conforme o estado atual do card. */
function buildControls(state) {
  if (state.applied) {
    return (
      '<div class="nihility-damage-controls">' +
      `<span class="damage-applied">✓ ${state.applied.amount} aplicado(s)</span>` +
      '<button type="button" class="damage-undo">↩ Desfazer</button>' +
      "</div>"
    );
  }
  return (
    '<div class="nihility-damage-controls">' +
    `<button type="button" class="damage-apply" data-factor="1">Aplicar ${state.amount}</button>` +
    '<button type="button" class="damage-apply" data-factor="0.5">Metade</button>' +
    '<button type="button" class="damage-apply" data-factor="2">Dobro</button>' +
    "</div>"
  );
}

/**
 * Injeta os botões no card já renderizado. Só o Mestre vê: aplicar dano em ficha alheia exige
 * permissão de escrita, e deixar o botão visível pra quem não pode usá-lo só geraria erro.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderDamageControls(message, html) {
  const state = message.getFlag(SYSTEM_ID, "damageApply");
  if (!state || !game.user.isGM) return;

  const container = document.createElement("div");
  container.innerHTML = buildControls(state);
  const controls = container.firstElementChild;
  html.appendChild(controls);

  controls.querySelectorAll(".damage-apply").forEach(button => {
    button.addEventListener("click", () => applyDamage(message, Number(button.dataset.factor)));
  });
  controls.querySelector(".damage-undo")?.addEventListener("click", () => undoDamage(message));
}

async function applyDamage(message, factor) {
  const state = message.getFlag(SYSTEM_ID, "damageApply");
  if (!state || state.applied) return;

  const actor = await fromUuid(state.targetUuid);
  const path = hpPath(actor);
  if (!path) {
    ui.notifications.warn("O alvo deste card não existe mais.");
    return;
  }

  const amount = Math.max(0, Math.round(state.amount * factor));
  const previous = foundry.utils.getProperty(actor, path) ?? 0;
  const next = Math.max(0, previous - amount);

  await actor.update({ [path]: next });
  // Guarda o HP ANTERIOR, não o valor aplicado: desfazer restaura o estado exato, sem depender
  // de nada mais ter mexido no HP nesse meio-tempo.
  await message.setFlag(SYSTEM_ID, "damageApply", { ...state, applied: { amount, previousValue: previous } });
}

async function undoDamage(message) {
  const state = message.getFlag(SYSTEM_ID, "damageApply");
  if (!state?.applied) return;

  const actor = await fromUuid(state.targetUuid);
  const path = hpPath(actor);
  if (!path) {
    ui.notifications.warn("O alvo deste card não existe mais.");
    return;
  }

  await actor.update({ [path]: state.applied.previousValue });
  await message.setFlag(SYSTEM_ID, "damageApply", { ...state, applied: null });
}
