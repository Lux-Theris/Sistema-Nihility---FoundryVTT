/**
 * Condições na origem (1.117.0): Espécie, Linhagem e Herança podem dar Imunidade ou Resistência a uma
 * Condição (`passives.conditions = [{conditionId, mode: "resist"|"immune", amount}]`). Este é o ponto
 * único que decide se a Condição pega num Ator; as regras puras ficam em `species-rules.js`
 * (`originConditionRule`, `conditionLands`), aqui só se rola, se avisa e se desenha.
 *
 * Por onde uma Condição pega num Ator, e quem consulta este guarda:
 *  - `applyEffectsToActor` (skills/effects-apply.js) — todo efeito de Skill com `conditionId`, efeito de
 *    elemento por chance, "ao acertar", reação elemental, superfície, duelo e Armadilha de Região com efeito;
 *  - `tickContagion` (combat/contagion.js) — quem iria pegar de um vizinho;
 *  - `applyCondition` com `guard: true` (environment/environment.js) — Armadilha que só põe a marca.
 * NÃO consultam (de propósito): a Condição marcada À MÃO pelo Mestre no HUD (aplica mesmo assim, com aviso:
 * `warnManualOverride`), o ambiente da cena/Região (sincronizado a cada movimento: rolaria sem parar) e as
 * Condições do próprio sistema que seguram alguém (Ancorado, Preso, Suprimido — para esses, o Validar Mundo
 * avisa quem tem Imunidade).
 *
 * Quando não pega: texto flutuante "Imune: X"/"Resistiu: X" sobre o Token (a mesa olha o mapa) e uma linha
 * no chat ("Veneno não pegou em Anão: resiste 30% (d100 = 12)"). A linha leva a flag `conditionResist`, e
 * todo cliente sobe o texto ao vê-la (como o nome da reação elemental).
 */
import { SYSTEM_ID, getActiveStatusConditions } from "../core/config.js";
import { originConditionRule, conditionLands, conditionBlockText, conditionFloatText } from "../species/species-rules.js";
import { applyLuckToFormula, luckOf } from "./luck-rules.js";
import { floatTextOnActor } from "./floating-numbers.js";
import { escapeHtml } from "../helpers/html.js";

const FLOAT_COLORS = { immune: "#6ee7ff", resist: "#e8c170" };

/** Camadas de origem do Ator (só Personagem tem; o resto nunca bloqueia). */
function layersOf(actor) {
  return actor?.type === "character" ? actor.system?.originLayers ?? [] : [];
}

/** O que a origem do Ator diz desta Condição (`immune`/`resist`), sem rolar nada. */
export function originConditionRuleFor(actor, conditionId) {
  return originConditionRule(layersOf(actor), conditionId);
}

/**
 * A Condição pega em `actor`? Rola o d100 da Resistência (a Sorte da VÍTIMA inclina o dado: positiva puxa
 * o resultado para cima, ou seja, para "não pega" — o mesmo critério do Contágio) e, quando não pega, avisa.
 * @param {Actor} actor
 * @param {string} conditionId
 * @param {{announce?: boolean, chat?: boolean}} [options] - `announce: false` só decide, sem texto nem chat
 * @returns {Promise<{lands:boolean, kind:string, amount:number, roll:number|null}>}
 */
export async function checkOriginCondition(actor, conditionId, { announce = true, chat = true } = {}) {
  const rule = originConditionRuleFor(actor, conditionId);
  if (!rule.immune && !(rule.resist > 0)) return { lands: true, kind: "none", amount: 0, roll: null };
  let roll = null;
  if (!rule.immune) {
    try {
      roll = (await new Roll(applyLuckToFormula("1d100", luckOf(actor, "chances"))).evaluate()).total;
    } catch (err) {
      console.warn(`${SYSTEM_ID} | d100 da Resistência a Condição falhou; a Condição pega.`, err);
      return { lands: true, kind: "resist", amount: rule.resist, roll: null };
    }
  }
  const outcome = conditionLands(rule, roll);
  if (!outcome.lands && announce) await announceConditionBlock(actor, conditionId, outcome, { chat });
  return outcome;
}

/** A linha de chat e o texto flutuante de uma Condição que não pegou. */
export async function announceConditionBlock(actor, conditionId, outcome, { chat = true } = {}) {
  const label = getActiveStatusConditions().find(c => c.id === conditionId)?.label ?? conditionId;
  const text = conditionBlockText({ conditionLabel: label, actorName: actor.name, outcome });
  const float = conditionFloatText(outcome.kind, label);
  // O Mestre vê tudo; se o Token está escondido, a linha também (o texto flutuante já respeita `isSecret`).
  // Sem chat: só o texto, neste cliente (quem não pede linha no chat não tem mensagem para espalhar o aviso).
  if (!chat) {
    floatTextOnActor(actor, float, { fill: FLOAT_COLORS[outcome.kind] ?? "#ffffff" });
    return;
  }
  const hidden = (actor.getActiveTokens?.(true) ?? []).some(t => t.document?.hidden);
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: hidden ? game.users.filter(u => u.isGM).map(u => u.id) : [],
      content: `<p class="nihility-condition-block">${escapeHtml(text)}.</p>`,
      flags: { [SYSTEM_ID]: { conditionResist: { actorUuid: actor.uuid, kind: outcome.kind, text: float, at: Date.now() } } }
    });
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Não foi possível postar o aviso de Condição que não pegou.`, err);
  }
}

/**
 * O Mestre marcou a Condição à mão no HUD: aplica mesmo assim, mas avisa quando a origem do Ator diria não.
 * Só o Mestre que clicou vê o aviso.
 */
export function warnManualOverride(actor, conditionId) {
  const rule = originConditionRuleFor(actor, conditionId);
  if (!rule.immune && !(rule.resist > 0)) return;
  const label = getActiveStatusConditions().find(c => c.id === conditionId)?.label ?? conditionId;
  const what = rule.immune ? "é imune a" : `resiste ${rule.resist}% a`;
  ui.notifications.warn(`${actor.name} ${what} ${label} (${rule.sources.join(", ")}), mas marcar à mão aplica mesmo assim.`);
}

/** Liga o texto flutuante: toda linha `conditionResist` recém-criada sobe o texto do Token. Chamado no `init`. */
export function registerConditionFloats() {
  Hooks.on("createChatMessage", message => {
    const info = message.flags?.[SYSTEM_ID]?.conditionResist;
    if (!info || !(Number(info.at) && Date.now() - Number(info.at) < 8000)) return;
    let actor = null;
    try {
      actor = fromUuidSync(info.actorUuid);
    } catch (err) {
      return;
    }
    floatTextOnActor(actor, info.text, { fill: FLOAT_COLORS[info.kind] ?? "#ffffff", fontSize: 30, delay: 400 });
  });
}
