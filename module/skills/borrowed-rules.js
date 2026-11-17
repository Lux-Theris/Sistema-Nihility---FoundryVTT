/**
 * Skills emprestadas (7a): o Corredor de alma (vínculo da Nomeação) e o Pacto. As contas PURAS
 * (testadas em test/borrowed-skills.test.mjs). Sem Foundry, sem imports.
 *
 * Vínculos, guardados em flags:
 *  - em quem USA: `borrowLinks = [{kind: "soul"|"pact", sourceUuid, since}]`;
 *  - no DONO:     `lendLinks   = [{kind, borrowerUuid, blocked, released: [skillIds], grantedTo: [userIds], since}]`.
 * `blocked` é a chave "Aceitar pedidos" desligada; `released` são as Skills que o patrono libera
 * (só no Pacto: o Corredor de alma empresta tudo o que passa). Quem o dono libera fica no flag do
 * DONO (e não no de quem usa) porque é o dono quem o escreve.
 */

const MECH_BLOCKING_TYPES = new Set(["form", "none", "analysis", "predation", "structure"]);

/** Alvos de Efeito que o Mestre refaz da ficha do DONO da Skill (empurrar, Antimagia/PEM em Estruturas, Marca): não passam. */
const OWNER_BOUND_EFFECT_TARGETS = new Set(["push", "antimagic", "emp", "mark"]);

/** Por que uma mecânica (Skill ou Sub-Skill) não pode ser emprestada, ou null. */
function mechBlock(mech) {
  if (!mech) return "sem mecânica";
  if (mech.hasUpkeep) return "é uma Habilidade Ativa";
  if (Number(mech.prepTurns) > 0) return "tem Preparo";
  if (MECH_BLOCKING_TYPES.has(mech.effectType)) return "o tipo de mecânica não passa";
  if (mech.targetType === "zone" || mech.targetType === "structure") return "deixa Zona ou Estrutura na cena";
  if ((mech.effects ?? []).some(e => OWNER_BOUND_EFFECT_TARGETS.has(e?.target))) return "tem um Efeito que só funciona na ficha do dono (empurrar, Antimagia/PEM ou Marca)";
  return null;
}

/**
 * Por que a Skill não pode ser emprestada, ou null. Passam só Skills de uso na hora: sem Ativa,
 * Preparo, Resistência, Maestria, Forma, Descritiva, Análise, Predação nem Skill de base; e (escolha
 * da implementação) sem Estrutura, Zona, empurrar, Antimagia/PEM nem Marca: o Mestre refaz esses da
 * ficha de quem lança, e quem lança aqui não é o dono.
 * @param {object} system - `skill.system` (ou um objeto parecido)
 */
export function borrowBlockReason(system) {
  if (!system) return "sem mecânica";
  if (system.resistanceTarget) return "é uma Resistência";
  if (system.weaponMastery) return "é uma Maestria";
  if (system.coreSkill) return "é uma Skill de base do sistema";
  const own = mechBlock(system);
  if (own) return own;
  for (const sub of system.subSkills ?? []) {
    const reason = mechBlock(sub);
    if (reason) return `um componente ${reason}`;
  }
  return null;
}

/** A Skill pode ser emprestada? */
export function borrowableSkill(system) {
  return borrowBlockReason(system) === null;
}

/**
 * As Skills do dono que o vínculo empresta. Corredor de alma: todas as que passam; Pacto: as
 * liberadas (`released`) que passam.
 * @param {"soul"|"pact"} kind
 * @param {Array<{id: string, system: object}>} skills - as Skills do dono
 * @param {string[]} [released]
 */
export function borrowedSkillList(kind, skills, released = []) {
  const allowed = new Set(released ?? []);
  return (skills ?? []).filter(skill => borrowableSkill(skill.system) && (kind !== "pact" || allowed.has(skill.id)));
}

/** "pelo Corredor de alma de Kaito" / "pelo Pacto com X". */
export function borrowedLabel(kind, ownerName) {
  return kind === "pact" ? `pelo Pacto com ${ownerName}` : `pelo Corredor de alma de ${ownerName}`;
}

/** O título da seção na ficha de quem usa. */
export function borrowedSectionTitle(kind, ownerName) {
  return kind === "pact" ? `Pacto: ${ownerName}` : `Corredor de alma: ${ownerName}`;
}

/* ------------------------------------------------------------------ Listas de vínculos (flags) */

const list = value => (Array.isArray(value) ? value.map(entry => ({ ...entry })) : []);

/** Acrescenta (ou troca, mesmo tipo e mesma outra ponta) um vínculo de quem usa. */
export function addBorrowLink(links, { kind, sourceUuid, since = 0 }) {
  return [...list(links).filter(l => !(l.kind === kind && l.sourceUuid === sourceUuid)), { kind, sourceUuid, since }];
}

/** Acrescenta (ou troca) um vínculo do dono. */
export function addLendLink(links, { kind, borrowerUuid, since = 0, released = [], grantedTo = [] }) {
  return [...list(links).filter(l => !(l.kind === kind && l.borrowerUuid === borrowerUuid)), { kind, borrowerUuid, blocked: false, released: [...released], grantedTo: [...grantedTo], since }];
}

export function removeBorrowLink(links, kind, sourceUuid) {
  return list(links).filter(l => !(l.kind === kind && l.sourceUuid === sourceUuid));
}

export function removeLendLink(links, kind, borrowerUuid) {
  return list(links).filter(l => !(l.kind === kind && l.borrowerUuid === borrowerUuid));
}

/** Liga/desliga o "Aceitar pedidos" (`blocked` = não aceita). */
export function setLendBlocked(links, kind, borrowerUuid, blocked) {
  return list(links).map(l => (l.kind === kind && l.borrowerUuid === borrowerUuid ? { ...l, blocked: Boolean(blocked) } : l));
}

/** Marca/desmarca uma Skill como liberada no Pacto. */
export function setLendReleased(links, borrowerUuid, skillId, released) {
  return list(links).map(l => {
    if (l.kind !== "pact" || l.borrowerUuid !== borrowerUuid) return l;
    const set = new Set(l.released ?? []);
    if (released) set.add(skillId);
    else set.delete(skillId);
    return { ...l, released: [...set] };
  });
}

/**
 * O vínculo vale agora? Os dois lados têm de concordar (quem usa aponta para o dono, o dono aponta
 * para quem usa) e o dono não pode ter parado de aceitar pedidos. Devolve o vínculo do dono.
 * @returns {{ok: boolean, reason: string, lend?: object}}
 */
export function linkUsable({ borrowLinks, lendLinks }, { kind, ownerUuid, borrowerUuid }) {
  const mine = list(borrowLinks).find(l => l.kind === kind && l.sourceUuid === ownerUuid);
  if (!mine) return { ok: false, reason: "este vínculo não existe na ficha de quem usa" };
  const lend = list(lendLinks).find(l => l.kind === kind && l.borrowerUuid === borrowerUuid);
  if (!lend) return { ok: false, reason: "o dono não reconhece este vínculo" };
  if (lend.blocked) return { ok: false, reason: "o dono não está aceitando pedidos", lend };
  return { ok: true, reason: "", lend };
}

/** A Skill do dono está liberada para este vínculo? (Corredor: toda que passa; Pacto: as `released`.) */
export function skillLent(kind, lend, skillId, system) {
  if (!borrowableSkill(system)) return false;
  return kind !== "pact" || (lend?.released ?? []).includes(skillId);
}

/** Quem tem de ganhar OBSERVER no patrono (donos do bruxo cujo nível é menor): `{userId: level}` → ids. */
export function pactObserversToGrant(borrowerOwners, patronOwnership, observerLevel = 2) {
  const out = [];
  for (const userId of borrowerOwners ?? []) {
    if ((Number(patronOwnership?.[userId]) || Number(patronOwnership?.default) || 0) < observerLevel) out.push(userId);
  }
  return out;
}
