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
 *
 * **Escudo pessoal absorve primeiro** (`attributes.shield.value`): o dano sai do Escudo até ele
 * zerar e só o resto chega na Vida. Antes o botão ia direto na Vida e o Escudo só era gasto
 * editando a ficha na mão — Escudo 10 contra 20 de dano tirava 20 de Vida e deixava o Escudo
 * intacto. Dano Absoluto (flag `absolute` do card) pula o Escudo.
 */
import { SYSTEM_ID } from "./config.js";

const SHIELD_PATH = "system.attributes.shield.value";

/**
 * Divide um dano entre o Escudo pessoal e a Vida: o Escudo absorve até acabar, o resto vai pra
 * Vida. Pura (testada em test/rules.test.mjs).
 * @param {number} amount - dano já com reduções e fator (Metade/Dobro) aplicados
 * @param {number} shield - Escudo atual
 * @param {{bypassShield?: boolean, shieldExtra?: number}} [options] - Dano Absoluto passa direto;
 *   `shieldExtra` é o dreno de Escudo do elemento
 * @returns {{toShield: number, toHp: number}}
 */
export function splitShieldDamage(amount, shield, { bypassShield = false, shieldExtra = 0 } = {}) {
  const total = Math.max(0, Math.round(Number(amount) || 0));
  const available = bypassShield ? 0 : Math.max(0, Math.round(Number(shield) || 0));
  // Dreno de Escudo (elemento tipo Táquion): dano EXTRA que só existe contra o Escudo — bate
  // primeiro e nunca passa pra Vida.
  const drain = Math.min(available, Math.max(0, Math.round(Number(shieldExtra) || 0)));
  const absorbed = Math.min(total, available - drain);
  return { toShield: drain + absorbed, toHp: total - absorbed };
}

/** Onde o dano cai em cada tipo de Ator. Nave/Veículo não entra: lá a cascata já aplica sozinha. */
function hpPath(actor) {
  return actor?.type === "character" ? "system.attributes.hp.value" : null;
}

/**
 * Grava no card os dados que os botões precisam. Chamado por quem posta a rolagem de dano.
 * @param {Actor|null} targetActor
 * @param {number} finalDamage - já com todas as reduções aplicadas
 * @param {{absolute?: boolean, shieldExtra?: number, triggeredConditions?: object[], label?: string}} [options]
 *   - Dano Absoluto não passa pelo Escudo pessoal
 */
export function damageApplyFlags(targetActor, finalDamage, { absolute = false, shieldExtra = 0, triggeredConditions = [], label = "" } = {}) {
  if (!targetActor || !hpPath(targetActor) || !(finalDamage > 0)) return {};
  return {
    [SYSTEM_ID]: {
      damageApply: {
        targetUuid: targetActor.uuid,
        amount: Math.round(finalDamage),
        absolute: Boolean(absolute),
        // Dano extra só contra o Escudo pessoal (elemento de dreno), e Condições que o elemento
        // disparou — as duas só valem quando o Mestre confirma o acerto clicando em Aplicar.
        shieldExtra: absolute ? 0 : Math.max(0, Math.round(shieldExtra || 0)),
        triggeredConditions: Array.isArray(triggeredConditions) ? triggeredConditions : [],
        label: String(label || ""),
        applied: null
      }
    }
  };
}

/** "10 no Escudo · 10 na Vida", omitindo a parte que for zero. */
function describeApplied(applied) {
  // Cards aplicados antes do Escudo existir no cálculo só têm `amount`.
  if (applied.toShield === undefined) return `${applied.amount} aplicado(s)`;
  const parts = [];
  if (applied.toShield) parts.push(`${applied.toShield} no Escudo`);
  if (applied.toHp || !applied.toShield) parts.push(`${applied.toHp} na Vida`);
  return parts.join(" · ");
}

/** Desenha a faixa de botões conforme o estado atual do card. */
function buildControls(state) {
  if (state.applied) {
    return (
      '<div class="nihility-damage-controls">' +
      `<span class="damage-applied">✓ ${describeApplied(state.applied)}</span>` +
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

  // Metade/Dobro agem sobre o dano inteiro, antes de o Escudo absorver.
  const amount = Math.max(0, Math.round(state.amount * factor));
  const previousHp = foundry.utils.getProperty(actor, path) ?? 0;
  const previousShield = foundry.utils.getProperty(actor, SHIELD_PATH) ?? 0;
  const shieldExtra = Math.round((state.shieldExtra || 0) * factor);
  const { toShield, toHp } = splitShieldDamage(amount, previousShield, { bypassShield: state.absolute, shieldExtra });

  const update = { [path]: Math.max(0, previousHp - toHp) };
  if (toShield) update[SHIELD_PATH] = previousShield - toShield;
  await actor.update(update);

  // Condições do elemento (Queimadura do Fogo…): só agora, com o acerto confirmado. O valor
  // "% do dano" acompanha Metade/Dobro.
  let createdEffectIds = [];
  if (state.triggeredConditions?.length) {
    const { applyTriggeredConditions } = await import("./skill-effects.js");
    ({ createdIds: createdEffectIds } = await applyTriggeredConditions(actor, state.triggeredConditions, { label: state.label, factor }));
  }

  // Guarda os valores ANTERIORES, não o aplicado: desfazer restaura o estado exato, sem depender
  // de nada mais ter mexido no HP/Escudo nesse meio-tempo.
  await message.setFlag(SYSTEM_ID, "damageApply", {
    ...state,
    applied: { amount, toShield, toHp, previousValue: previousHp, previousShield, createdEffectIds }
  });
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

  const update = { [path]: state.applied.previousValue };
  // Card aplicado antes desta versão não tem `previousShield`: aí o Escudo nunca foi tocado.
  if (state.applied.previousShield !== undefined && state.applied.toShield) {
    update[SHIELD_PATH] = state.applied.previousShield;
  }
  await actor.update(update);
  // Condições que este Aplicar criou saem junto. Uma Condição que já existia e só foi renovada
  // fica como está — não há como saber a duração de antes.
  const created = (state.applied.createdEffectIds ?? []).filter(id => actor.effects.has(id));
  if (created.length) await actor.deleteEmbeddedDocuments("ActiveEffect", created);
  await message.setFlag(SYSTEM_ID, "damageApply", { ...state, applied: null });
}
