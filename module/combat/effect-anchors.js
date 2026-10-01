/**
 * Âncoras de Skill Ativa — o que segura um efeito vivo "até desligar a Skill". Puro (sem Foundry),
 * testado em test/rules.test.mjs; skill-effects.js só lê e grava as flags.
 *
 * Um efeito (buff/debuff comum OU periódico) vive enquanto tiver PELO MENOS UMA âncora OU duração
 * finita sobrando. Cada Skill Ativa que aplica a mesma Condição vira uma âncora a mais; desligar
 * uma tira só a dela. Antes, o buff comum guardava um dono só (`tiedToActive` + `sourceSkillId`):
 * a segunda Skill Ativa não ficava registrada e, ao desligar a primeira, o efeito sumia com a
 * segunda ainda ligada.
 *
 * A âncora identifica a Skill pelo **uuid** (`skillUuid`). Dois Tokens não vinculados da mesma
 * ficha têm Skills com o mesmo id; só o uuid os distingue (ver "compare por uuid" no CLAUDE.md).
 * Âncoras gravadas antes disso só têm `sourceSkillId` e continuam valendo, comparadas por id.
 */

/** Duração "sem prazo" de um efeito comum (aplicado com 0 rodadas e sem Skill Ativa). */
export const PERMANENT = Infinity;

/**
 * @param {{skillUuid?: string|null, skillId?: string|null, subSkillIndex?: number|null}} source
 * @returns {{skillUuid: string|null, sourceSkillId: string|null, sourceSubSkillIndex: number|null}}
 */
export function makeAnchor({ skillUuid = null, skillId = null, subSkillIndex = null } = {}) {
  return {
    skillUuid: skillUuid || null,
    sourceSkillId: skillId || null,
    sourceSubSkillIndex: Number.isInteger(subSkillIndex) ? subSkillIndex : null
  };
}

/** Mesma Skill (e mesmo componente)? Por uuid quando os dois lados têm; senão, por id (legado). */
export function sameAnchor(a, b) {
  if (!a || !b) return false;
  if ((a.sourceSubSkillIndex ?? null) !== (b.sourceSubSkillIndex ?? null)) return false;
  if (a.skillUuid && b.skillUuid) return a.skillUuid === b.skillUuid;
  return Boolean(a.sourceSkillId) && a.sourceSkillId === b.sourceSkillId;
}

/** Acrescenta a âncora (sem duplicar). Devolve uma lista nova. */
export function addAnchor(anchors, anchor) {
  const list = Array.isArray(anchors) ? anchors : [];
  return list.some(a => sameAnchor(a, anchor)) ? [...list] : [...list, anchor];
}

/** Tira a âncora. Devolve `{ anchors, removed }` (removed = esta Skill segurava o efeito). */
export function removeAnchor(anchors, anchor) {
  const list = Array.isArray(anchors) ? anchors : [];
  const remaining = list.filter(a => !sameAnchor(a, anchor));
  return { anchors: remaining, removed: remaining.length !== list.length };
}

/**
 * As âncoras de um efeito, entendendo o formato antigo do buff comum (`tiedToActive` +
 * `sourceSkillId`, sem lista): vira uma âncora só, com o uuid tirado do `origin` do efeito
 * (o uuid da Skill que o criou).
 * @param {object} flags - flags do sistema no Active Effect
 * @param {string|null} [origin] - `effect.origin`
 */
export function effectAnchors(flags, origin = null) {
  if (!flags) return [];
  if (Array.isArray(flags.activeAnchors)) return flags.activeAnchors;
  if (flags.tiedToActive) {
    return [makeAnchor({ skillUuid: origin, skillId: flags.sourceSkillId, subSkillIndex: flags.sourceSubSkillIndex })];
  }
  return [];
}

/**
 * Rodadas finitas que ainda restam da parte "com prazo" de um efeito comum ancorado. Enquanto há
 * âncora, a duração do Foundry fica vazia (senão ela derrubaria o efeito com a Skill ligada) e o
 * prazo das fontes finitas é guardado na flag `finite`, contando em paralelo, como os ticks do
 * periódico.
 * @param {{rounds:number, fromRound?:number|null, combatId?:string|null}|null} finite
 * @param {{round?:number|null, combatId?:string|null}} [now]
 * @returns {number} rodadas (PERMANENT quando `rounds` é -1)
 */
export function finiteRemaining(finite, now = {}) {
  if (!finite) return 0;
  const rounds = Number(finite.rounds);
  if (rounds === -1) return PERMANENT;
  if (!(rounds > 0)) return 0;
  const sameCombat = finite.combatId && now.combatId && finite.combatId === now.combatId;
  const elapsed = sameCombat ? Math.max(0, (now.round ?? 0) - (finite.fromRound ?? 0)) : 0;
  return Math.max(0, rounds - elapsed);
}

/**
 * Rodadas que restam na duração do Foundry de um efeito comum NÃO ancorado. Sem `rounds` (ou 0)
 * o efeito é permanente — antes isso era lido como 0, e reaplicar um buff de 3 rodadas por cima
 * de um permanente o tornava finito.
 * @param {{rounds?:number|null, startRound?:number|null}} duration
 * @param {number|null} [currentRound] - rodada do combate atual, se houver
 */
export function durationRemaining(duration, currentRound = null) {
  const rounds = Number(duration?.rounds) || 0;
  if (!(rounds > 0)) return PERMANENT;
  const elapsed = currentRound == null ? 0 : Math.max(0, currentRound - (Number(duration?.startRound) || 0));
  return Math.max(0, rounds - elapsed);
}

/**
 * Reaplicar com prazo renova, sem somar (a maior entre o que restava e a nova — mesma regra de
 * refreshReapplication). Aplicação com 0 rodadas é permanente e vence qualquer prazo.
 */
export function refreshFiniteRounds(current, incomingRounds) {
  const incoming = Number(incomingRounds) > 0 ? Number(incomingRounds) : PERMANENT;
  return Math.max(Number(current) || 0, incoming);
}

/** Inverso de `finiteRemaining` para gravar: PERMANENT vira -1 (JSON não tem Infinity). */
export function serializeFinite(rounds, now = {}) {
  if (rounds === PERMANENT) return { rounds: -1, fromRound: null, combatId: null };
  return { rounds: Math.max(0, Math.round(Number(rounds) || 0)), fromRound: now.round ?? null, combatId: now.combatId ?? null };
}

/**
 * Situação de um efeito: vivo? mostra "até desligar"? O "até desligar" só aparece quando não há
 * prazo finito correndo junto — enquanto há, o número de rodadas é o que interessa.
 * @param {{anchors: Array, finite: number}} state
 */
export function anchorLifetime({ anchors = [], finite = 0 } = {}) {
  const anchored = anchors.length > 0;
  return {
    alive: anchored || finite > 0,
    untilOff: anchored && !(finite > 0),
    permanent: finite === PERMANENT
  };
}
