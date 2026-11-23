/**
 * Parado no tempo (8e.4), só a LEITURA do estado: quem está Parado e o aviso de uma ação recusada. Fica à parte de
 * `time-stop.js` (que escreve, tem os ganchos e a saída) para que `incapacitation.js`, `damage-apply.js`,
 * `forced-movement.js` e `world-time.js` possam perguntar sem puxar o resto.
 *
 * O Parado é um Active Effect com `flags.<sistema>.timeStop = {rounds, forever, casterUuid, casterName}`, FORA do
 * `incapacitates` do catálogo de Condições: o incapacitado desliga as Ativas e falha o Preparo; o Parado congela.
 */
import { SYSTEM_ID } from "../core/config.js";
import { STOP_FLAG, stopActionText } from "./time-stop-rules.js";

/** Os efeitos de Parado ligados no Ator. */
export function timeStopEffectsOf(actor) {
  return actor?.effects?.filter(e => !e.disabled && e.flags?.[SYSTEM_ID]?.[STOP_FLAG]) ?? [];
}

/** O Ator está Parado no tempo? Nave/Veículo nunca. */
export function isTimeStopped(actor) {
  if (!actor || ["starship", "vehicle"].includes(actor.type)) return false;
  return timeStopEffectsOf(actor).length > 0;
}

/** O que diz o Parado (o prazo que mais falta, de quem lançou), ou null. */
export function stopInfoOf(actor) {
  const list = timeStopEffectsOf(actor).map(e => ({ ...e.flags[SYSTEM_ID][STOP_FLAG], effectId: e.id }));
  if (!list.length) return null;
  const forever = list.find(s => s.forever);
  if (forever) return { ...forever, forever: true };
  return list.reduce((best, s) => ((Number(s.rounds) || 0) > (Number(best.rounds) || 0) ? s : best), list[0]);
}

/** O texto da recusa se o Ator está Parado, senão "". */
export function actionBlockReason(actor, what = "agir") {
  return isTimeStopped(actor) ? stopActionText(actor.name, what) : "";
}

/** Avisa e devolve true se o Ator está Parado (Skill, ataque, consumível, Correr). */
export function blockIfTimeStopped(actor, what = "agir") {
  const reason = actionBlockReason(actor, what);
  if (!reason) return false;
  globalThis.ui?.notifications?.warn(reason);
  return true;
}
