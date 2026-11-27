/**
 * Condições na origem (1.117.0, refeita na 1.119.0): Espécie, Linhagem e Herança podem dar Imunidade ou Resistência a
 * uma Condição (`passives.conditions = [{conditionId, mode: "resist"|"immune", amount}]`). Este é o ponto único que
 * decide se a Condição pega num Ator; as regras puras ficam em `species-rules.js` (`originConditionRule`) e em
 * `condition-resist-rules.js` (contador de exposição, força e duração reduzidas, textos); aqui só se guarda o
 * contador, se avisa e se desenha.
 *
 * **Resistência não é imunidade (dono, 24/11):** cada exposição soma `1 − X` num contador por Ator e por Condição
 * (flag `conditionExposure`); a Condição pega quando o contador chega a 1 e, ao pegar, vem com força e duração × (1 − X).
 * Imune nunca pega. Um efeito com `piercesCondition` ("Fura imunidade e resistência a Condição") ignora tudo isto.
 *
 * Por onde uma Condição pega num Ator, e quem consulta este guarda:
 *  - `applyEffectsToActor` (skills/effects-apply.js) — todo efeito de Skill com `conditionId`, efeito de
 *    elemento por chance, "ao acertar", reação elemental, superfície, duelo e Armadilha de Região com efeito;
 *  - `tickContagion` (combat/contagion.js) — quem iria pegar de um vizinho;
 *  - `applyCondition` com `guard: true` (environment/environment.js) — Armadilha que só põe a marca;
 *  - o ambiente da cena/Região (`syncNow`, environment.js), **uma exposição por rodada** (`dedupe`): entrar e andar na
 *    área não conta de novo na mesma rodada.
 * NÃO consultam (de propósito): a Condição marcada À MÃO pelo Mestre no HUD (aplica mesmo assim, com aviso:
 * `warnManualOverride`) e as Condições do próprio sistema que seguram alguém (Ancorado, Preso, Suprimido — para esses,
 * o Validar Mundo avisa quem tem Imunidade).
 *
 * Quem já tem a Condição não conta exposição (é renovação): só a força e a duração saem × (1 − X).
 * Quando não pega: texto flutuante "Resistindo: Veneno (1/2)" ou "Imune: X" sobre o Token (a mesa olha o mapa) e uma
 * linha no chat. A linha leva a flag `conditionResist`, e todo cliente sobe o texto ao vê-la.
 */
import { SYSTEM_ID, getActiveStatusConditions, getFeatureOption } from "../core/config.js";
import { originConditionRule } from "../species/species-rules.js";
import { stepExposure, resistExposureText, resistFloatText, immuneBlockText, resistLandedText, resistFraction, DEFAULT_RESET_ROUNDS } from "./condition-resist-rules.js";
import { floatTextOnActor } from "./floating-numbers.js";
import { deleteKeyUpdate } from "../helpers/foundry-compat.js";
import { escapeHtml } from "../helpers/html.js";

const FLOAT_COLORS = { immune: "#6ee7ff", resist: "#e8c170" };
const FLAG = "conditionExposure";

/** Camadas de origem do Ator (só Personagem tem; o resto nunca bloqueia). */
function layersOf(actor) {
  return actor?.type === "character" ? actor.system?.originLayers ?? [] : [];
}

/** O que a origem do Ator diz desta Condição (`immune`/`resist`), sem contar nada. */
export function originConditionRuleFor(actor, conditionId) {
  return originConditionRule(layersOf(actor), conditionId);
}

/** O "agora" do contador: o combate em andamento (id e rodada) e o relógio real. */
function exposureNow() {
  const combat = game.combat;
  const live = combat?.started ? combat : null;
  return { combatId: live?.id ?? "", round: live?.round ?? 0, time: Date.now() };
}

function conditionLabelOf(conditionId) {
  return getActiveStatusConditions().find(c => c.id === conditionId)?.label ?? conditionId;
}

/**
 * A Condição pega em `actor`? Soma a exposição (ou diz que é imune) e, quando não pega, avisa.
 * @param {Actor} actor
 * @param {string} conditionId
 * @param {{announce?: boolean, chat?: boolean, pierce?: boolean, dedupe?: boolean}} [options]
 *   `announce: false` só decide, sem texto nem chat; `chat: false` só o texto flutuante; `pierce` fura Imunidade e
 *   Resistência (o efeito "fura"); `dedupe` conta uma exposição por rodada (ambiente).
 * @returns {Promise<{lands:boolean, kind:"none"|"immune"|"resist"|"pierced", amount:number, factor:number, hits:number, needed:number, duplicate:boolean}>}
 *   `factor` = o que a força e a duração levam quando pega (1 − X; 1 sem resistência).
 */
export async function checkOriginCondition(actor, conditionId, { announce = true, chat = true, pierce = false, dedupe = false } = {}) {
  const rule = originConditionRuleFor(actor, conditionId);
  const none = { lands: true, kind: "none", amount: 0, factor: 1, hits: 1, needed: 1, duplicate: false };
  if (!rule.immune && !(rule.resist > 0)) return none;
  if (pierce) return { ...none, kind: "pierced", amount: rule.resist };
  if (rule.immune) {
    const outcome = { lands: false, kind: "immune", amount: 100, factor: 0, hits: 0, needed: Infinity, duplicate: false };
    // No ambiente (`dedupe`) a imunidade é silenciosa: o aviso a cada passo e a cada rodada só poluiria o chat.
    if (announce && !dedupe) await announceConditionBlock(actor, conditionId, outcome, { chat });
    return outcome;
  }
  // Já tem a Condição: é renovação, não conta exposição; só a força e a duração saem reduzidas.
  const fraction = resistFraction(rule.resist);
  if (actor.statuses?.has?.(conditionId)) return { lands: true, kind: "resist", amount: rule.resist, factor: 1 - fraction, hits: 1, needed: 1, duplicate: false, renewal: true };
  const prev = foundry.utils.getProperty(actor, `flags.${SYSTEM_ID}.${FLAG}.${conditionId}`) ?? null;
  const resetRounds = getFeatureOption("environment", "conditionResistResetRounds") ?? DEFAULT_RESET_ROUNDS;
  const step = stepExposure(prev, exposureNow(), { resistPercent: rule.resist, resetRounds, dedupe });
  const outcome = { lands: step.lands, kind: "resist", amount: rule.resist, factor: step.factor, hits: step.hits, needed: step.needed, count: step.count, duplicate: step.duplicate };
  if (step.duplicate) return outcome;
  await saveExposure(actor, conditionId, step.next);
  if (!step.lands && announce) await announceConditionBlock(actor, conditionId, outcome, { chat });
  return outcome;
}

/** Grava (ou apaga) o contador de exposição de uma Condição. Falha de permissão não impede a Skill. */
async function saveExposure(actor, conditionId, state) {
  const path = `flags.${SYSTEM_ID}.${FLAG}.${conditionId}`;
  try {
    if (state) await actor.update({ [path]: state });
    else if (foundry.utils.getProperty(actor, path)) await actor.update(deleteKeyUpdate(path));
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Não foi possível guardar a exposição a ${conditionId} em ${actor?.name}.`, err);
  }
}

/**
 * Zera o contador de exposição (Resistência a Condição) das Condições `conditionIds` em `actor` (Purificar, 1.123.0: a próxima
 * exposição recomeça do zero). Escreve uma vez só; sem contador nenhum, não escreve.
 */
export async function clearConditionExposure(actor, conditionIds) {
  const stored = foundry.utils.getProperty(actor ?? {}, `flags.${SYSTEM_ID}.${FLAG}`) ?? {};
  const present = (conditionIds ?? []).filter(id => stored?.[id]);
  if (!present.length) return;
  try {
    const update = {};
    for (const id of present) Object.assign(update, deleteKeyUpdate(`flags.${SYSTEM_ID}.${FLAG}.${id}`));
    await actor.update(update);
  } catch (err) {
    console.warn(`${SYSTEM_ID} | Não foi possível zerar a exposição em ${actor?.name}.`, err);
  }
}

/** A linha de chat e o texto flutuante de uma Condição que não pegou (imunidade ou exposição que ainda não bastou). */
export async function announceConditionBlock(actor, conditionId, outcome, { chat = true } = {}) {
  const label = conditionLabelOf(conditionId);
  const text = outcome.kind === "immune"
    ? immuneBlockText({ conditionLabel: label, actorName: actor.name })
    : resistExposureText({ actorName: actor.name, conditionLabel: label, resistPercent: outcome.amount, count: outcome.count, hits: outcome.hits, needed: outcome.needed });
  const float = resistFloatText({ kind: outcome.kind, conditionLabel: label, hits: outcome.hits, needed: outcome.needed });
  // Sem chat: só o texto, neste cliente (quem não pede linha no chat não tem mensagem para espalhar o aviso).
  if (!chat) {
    floatTextOnActor(actor, float, { fill: FLOAT_COLORS[outcome.kind] ?? "#ffffff" });
    return;
  }
  await postLine(actor, `${text}.`.replace(/\.\.$/, "."), { kind: outcome.kind, text: float });
}

/** A Condição pegou depois de resistir: uma linha de chat com a força e a duração que sobraram (quadro 6). */
export async function announceConditionLanded(actor, conditionId, { resistPercent, before, after, periodic = false }) {
  const text = resistLandedText({ actorName: actor.name, conditionLabel: conditionLabelOf(conditionId), resistPercent, before, after, periodic });
  await postLine(actor, text, null);
}

/** Posta a linha (sussurrada ao Mestre se o Token está escondido); `float` leva o texto que sobe do Token em todo cliente. */
async function postLine(actor, text, float) {
  const hidden = (actor.getActiveTokens?.(true) ?? []).some(t => t.document?.hidden);
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: hidden ? game.users.filter(u => u.isGM).map(u => u.id) : [],
      content: `<p class="nihility-condition-block">${escapeHtml(text)}</p>`,
      ...(float ? { flags: { [SYSTEM_ID]: { conditionResist: { actorUuid: actor.uuid, kind: float.kind, text: float.text, at: Date.now() } } } } : {})
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
  const what = rule.immune ? "é imune a" : `resiste ${rule.resist}% a`;
  ui.notifications.warn(`${actor.name} ${what} ${conditionLabelOf(conditionId)} (${rule.sources.join(", ")}), mas marcar à mão aplica mesmo assim.`);
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
