/**
 * Regras puras do pedido "aplique estes Efeitos por mim" (relay `applySkillEffects`): um jogador
 * usa uma Skill de Efeito (buff, debuff, Condição) num personagem que não é dele — um NPC, o
 * personagem de outro jogador — e o Foundry não deixa o cliente dele gravar ali. O Mestre aplica.
 *
 * Aqui fica só o que dá para testar sem Foundry: limpar o pedido que veio do outro cliente e
 * repetir no Mestre as escolhas feitas na hora de usar (parte focada da cura, parte do bloqueio).
 */

/** Teto de alvos num pedido (uma Emissão grande); além disso, o resto fica de fora. */
export const MAX_RELAYED_TARGETS = 50;

/** Força do investimento de Mana: sem teto de regra, mas um número absurdo não passa. */
function cleanPower(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(1000, Math.max(0.01, n)) : 1;
}

function cleanId(value) {
  return typeof value === "string" ? value.slice(0, 64) : "";
}

/**
 * Pedido vindo de outro cliente → só os campos esperados, limitados. `null` se não serve.
 * @param {object} payload
 * @returns {{sourceUuid: string, subSkillIndex: number|null, targetUuids: string[], investPower: number, focusPartId: string, healBlockPartId: string}|null}
 */
export function normalizeEffectRequest(payload) {
  const sourceUuid = typeof payload?.sourceUuid === "string" ? payload.sourceUuid : "";
  const targetUuids = Array.isArray(payload?.targetUuids)
    ? [...new Set(payload.targetUuids.filter(u => typeof u === "string" && u))].slice(0, MAX_RELAYED_TARGETS)
    : [];
  if (!sourceUuid || !targetUuids.length) return null;
  const index = payload?.subSkillIndex;
  return {
    sourceUuid,
    subSkillIndex: Number.isInteger(index) && index >= 0 ? index : null,
    targetUuids,
    investPower: cleanPower(payload?.investPower),
    focusPartId: cleanId(payload?.focusPartId),
    healBlockPartId: cleanId(payload?.healBlockPartId)
  };
}

/**
 * Põe nas entradas de Efeito as escolhas feitas ao usar: a parte focada vai nas curas de Vida, a
 * parte do bloqueio nas Condições cujo bloqueio de cura é "numa parte". Devolve uma lista nova.
 * @param {object[]} effects
 * @param {{focusPartId?: string, healBlockPartId?: string}} choices
 * @param {{isHeal: (entry: object) => boolean, blocksPart: (entry: object) => boolean}} tests
 */
export function applyEffectChoices(effects, { focusPartId = "", healBlockPartId = "" } = {}, { isHeal, blocksPart }) {
  return (effects ?? []).map(entry => {
    let next = entry;
    if (focusPartId && isHeal(entry)) next = { ...next, focusPartId };
    if (healBlockPartId && blocksPart(entry)) next = { ...next, healBlockPartId };
    return next;
  });
}

/**
 * Separa os alvos entre os que este cliente pode gravar e os que vão para o Mestre.
 * @template T
 * @param {T[]} targets
 * @param {(target: T) => boolean} canWrite
 */
export function splitByWriteAccess(targets, canWrite) {
  const local = [];
  const remote = [];
  for (const target of targets ?? []) (canWrite(target) ? local : remote).push(target);
  return { local, remote };
}
