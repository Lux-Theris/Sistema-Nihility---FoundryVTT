/**
 * Skill Combinada, Estrutura em volta, Magia enfraquecida e as regras do duelo (item 8c.2). Tudo puro
 * e testado em test/combined-duel.test.mjs; quem pergunta ao usuário e escreve nos documentos é
 * skill-use-flow.js / skill-effects.js / duel.js.
 *
 * Combinada (`combined: true` numa Skill com Sub-Skills): um uso dispara TODAS as Sub-Skills em ordem,
 * nos mesmos alvos; o Custo da Skill-mãe é pago uma vez e as escolhas (o alvo, a posição da área) são
 * feitas uma vez. Os efeitos das partes ficam ancorados à Skill-mãe, então desligá-la solta tudo.
 */
import { skillUseMode } from "./skill-use-mode.js";
import { shapeIsFree } from "../combat/range-rules.js";
import { resolveWeaponStrike } from "../combat/weapon-mastery-rules.js";

/** Valores de `structurePlace` (de onde a Estrutura sai, sem pedir clique quando não for "click"). */
export const STRUCTURE_PLACES = ["click", "caster", "target"];
export const STRUCTURE_PLACE_OPTIONS = [
  ["click", "Clicar no mapa", "Quem usa desenha ou põe a Estrutura no mapa, como sempre."],
  ["caster", "Em volta de quem usa", "Sem clique: a Estrutura sai com o centro em quem usa (forma e tamanho do catálogo)."],
  ["target", "Em volta do alvo", "Sem clique: a Estrutura sai com o centro no alvo escolhido (forma e tamanho do catálogo)."]
];

/** Regra de quem entra no duelo (`intruderRule`): "" = nada, "break" desliga a Skill, "include" também o atinge. */
export const INTRUDER_RULES = ["", "break", "include"];
export const INTRUDER_RULE_OPTIONS = [
  ["", "Nada acontece", "Quem entrar na Estrutura do duelo só fica preso."],
  ["break", "Quebra o duelo (desliga a Skill)", "Se alguém além de quem usa e do alvo terminar um movimento dentro da Estrutura, a Skill desliga."],
  ["include", "Entra no duelo (recebe o que atinge o alvo)", "Quem entrar recebe as partes que miram o alvo (ex.: a Magia enfraquecida), presas à Skill."]
];

/** A Skill é uma Combinada de verdade (tem a marca e pelo menos uma Sub-Skill)? */
export function isCombinedSkill(system) {
  return Boolean(system?.combined) && Array.isArray(system?.subSkills) && system.subSkills.length > 0;
}

/** Os dados de um objeto (DataModel ou simples) como objeto simples. */
function plain(object) {
  return typeof object?.toObject === "function" ? object.toObject() : { ...(object ?? {}) };
}

/** Uma forma de área de uma parte que sai de quem lança e é círculo: não pede clique (o centro é quem usa). */
export function isCasterBoundCircle(part, level = 1) {
  if (!part || part.areaShape !== "circle") return false;
  return !shapeIsFree({ areaOrigin: part.areaOrigin, areaFreeLevel: part.areaFreeLevel, level });
}

/**
 * O que um uso de Combinada precisa perguntar, uma vez:
 * - `needsTarget`: alguma parte mira um alvo único, ou a Skill-mãe precisa dele (desliga se ele cai, regra
 *   de intruso, "Só se…" sobre o alvo);
 * - `areaClickIndex`: a primeira parte de área (Emissão/Zona) que pede clique (forma livre, cone, linha), ou
 *   -1; as outras partes de área reaproveitam a posição;
 * - `modes[i]`: o modo de cada parte (`skillUseMode`, sem o "ligada", que não vale dentro da Combinada).
 * @param {object} parent - `system` da Skill
 * @param {object[]} parts - as Sub-Skills
 * @param {{areaEnabled?: boolean, areaSupported?: boolean}} [env]
 */
export function combinedPlan(parent, parts, env = {}) {
  const level = Number(parent?.level) || 1;
  const modes = parts.map(part => skillUseMode({ ...plain(part), hasUpkeep: false, active: false }, env));
  let areaClickIndex = -1;
  parts.forEach((part, i) => {
    if ((modes[i] === "emission" || modes[i] === "zone") && areaClickIndex < 0 && !isCasterBoundCircle(part, level)) areaClickIndex = i;
  });
  const onlyIfOnTarget = String(parent?.onlyIf?.kind ?? "").startsWith("other");
  const needsTarget =
    modes.includes("targeted") || Boolean(parent?.endsWhenTargetFalls) || Boolean(parent?.intruderRule) || onlyIfOnTarget ||
    parts.some((part, i) => modes[i] === "structure" && part.structurePlace === "target");
  return { modes, needsTarget, areaClickIndex };
}

/**
 * A mecânica de uma parte, pronta para rodar dentro da Skill-mãe: nível, Ativa e natureza da mãe, sem Custo,
 * manutenção, Recarga nem Preparo próprios (a mãe paga uma vez).
 * @param {object} parent - `system` da Skill
 * @param {object} part - a Sub-Skill
 * @param {{magic?: boolean, tech?: boolean}} [nature] - a natureza da mãe, para a parte que não escolheu a dela
 */
export function combinedPartMech(parent, part, nature = {}) {
  const base = plain(part);
  return {
    ...base,
    level: Number(parent?.level) || 1,
    tier: parent?.tier ?? base.tier,
    cost: 0,
    upkeepCost: 0,
    cooldown: 0,
    prepTurns: 0,
    variableMana: false,
    hasUpkeep: Boolean(parent?.hasUpkeep),
    isMagic: typeof base.isMagic === "boolean" ? base.isMagic : Boolean(nature.magic),
    isTech: typeof base.isTech === "boolean" ? base.isTech : Boolean(nature.tech),
    weaponStrike: resolveWeaponStrike(base.weaponStrike, parent?.weaponStrike)
  };
}

/** "Combinada: A + B + C". Vazio quando não é Combinada. */
export function combinedSentence(system) {
  if (!isCombinedSkill(system)) return "";
  return `Combinada: ${system.subSkills.map(s => s?.name || "sem nome").join(" + ")}`;
}

/** Um parágrafo para a ficha: o que a Combinada faz, com o número de partes. */
export function combinedHint(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `As ${n} Sub-Skills disparam em ordem, nos mesmos alvos, e o Custo é pago uma vez.`;
}

/**
 * Pontos de uma Estrutura sem clique, centrados em `center`: círculo e quadrado são um ponto só; linha e
 * forma livre viram um traço horizontal com o comprimento do catálogo.
 * @param {string} shape
 * @param {{x: number, y: number}} center
 * @param {number} sizePx - o tamanho da Estrutura em pixels
 * @returns {number[][]}
 */
export function centeredStructurePoints(shape, center, sizePx) {
  const x = Number(center?.x) || 0;
  const y = Number(center?.y) || 0;
  if (shape === "circle" || shape === "rect") return [[x, y]];
  const half = (Number(sizePx) || 0) / 2;
  return [[x - half, y], [x + half, y]];
}

/**
 * Quanto uma Estrutura leva de um golpe, conforme o lado de onde vem: quem ataca está DENTRO da forma fechada
 * (insidePercent) ou fora (outsidePercent)? Padrão 100 dos dois lados. Devolve o fator (0 = não leva dano).
 */
export function structureSideFactor({ inside = false, outsidePercent = 100, insidePercent = 100 } = {}) {
  const pct = Number(inside ? insidePercent : outsidePercent);
  return Math.max(0, Number.isFinite(pct) ? pct : 100) / 100;
}

/** Os dois percentuais do catálogo, saneados (inteiros ≥ 0; ausente = 100). */
export function normalizeSidePercents(entry) {
  const clean = value => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 100;
  };
  return { outsideDamagePercent: clean(entry?.outsideDamagePercent), insideDamagePercent: clean(entry?.insideDamagePercent) };
}

/**
 * Magia enfraquecida (`magicDampen`): o efeito carrega `chance` (%) e `percent` (força que sobra). Em cada uso
 * mágico de quem o tem, rola a chance; se pega, a força do uso é multiplicada por percent/100. Vários efeitos
 * (de fontes diferentes) pegam cada um a sua chance e os fatores se multiplicam.
 * @param {{chance?: number, percent?: number}[]} dampens
 * @param {() => number} roll - devolve 1..100 (injetado para testar)
 * @returns {{factor: number, applied: {chance: number, percent: number, roll: number}[], missed: number}}
 */
export function resolveMagicDampen(dampens, roll) {
  let factor = 1;
  const applied = [];
  let missed = 0;
  for (const d of dampens ?? []) {
    const chance = Math.min(100, Math.max(0, Number(d?.chance ?? 100)));
    const percent = Math.min(1000, Math.max(0, Number(d?.percent ?? 100)));
    const rolled = chance >= 100 ? 1 : Number(roll());
    if (rolled <= chance) {
      factor *= percent / 100;
      applied.push({ chance, percent, roll: rolled });
    } else missed += 1;
  }
  return { factor, applied, missed };
}

/** A linha de chat de uma Magia enfraquecida ("saiu enfraquecida: 50%"), ou "" se nada pegou. */
export function dampenLine(result) {
  if (!result?.applied?.length) return "";
  return `saiu enfraquecida: ${Math.round(result.factor * 100)}%`;
}

/**
 * Quem entrou na Estrutura do duelo? Quem usa e o alvo não contam. `rule`: "break" desliga a Skill,
 * "include" também o atinge, "" nada.
 * @returns {"none"|"break"|"include"}
 */
export function intruderOutcome({ rule = "", isCaster = false, isTarget = false, inside = false } = {}) {
  if (!inside || isCaster || isTarget) return "none";
  return rule === "break" || rule === "include" ? rule : "none";
}

/** O alvo caiu? Caído/Inconsciente, morto, ou (com o bloco Vida 0 desligado) com a Vida em 0. */
export function targetHasFallen({ incapacitated = false, dead = false, hp = null } = {}) {
  return Boolean(incapacitated) || Boolean(dead) || (hp !== null && Number(hp) <= 0);
}

/**
 * Problemas de uma Combinada para o aviso do editor: sem Sub-Skills não faz nada (hard); uma parte de Forma
 * não funciona dentro dela (hard); uma parte de Zona também não (a Zona relê a mãe); Preparo é ignorado (soft).
 * @returns {{code: string, level: "hard"|"soft", text: string}[]}
 */
export function combinedIssues(system) {
  if (!system?.combined) return [];
  const out = [];
  const subs = Array.isArray(system.subSkills) ? system.subSkills : [];
  if (!subs.length) out.push({ code: "combinedEmpty", level: "hard", text: "Combinada sem Sub-Skills: não há nada para disparar. Adicione as partes na aba Sub-Skills ou volte para “Escolher uma Sub-Skill”." });
  if (subs.some(s => s?.effectType === "form")) out.push({ code: "combinedForm", level: "hard", text: "Uma parte com a Mecânica Forma não funciona dentro de uma Combinada: a Forma liga e desliga sozinha." });
  if (subs.some(s => s?.targetType === "zone" && (s.effectType === "damage" || s.effectType === "temporary"))) out.push({ code: "combinedZone", level: "hard", text: "Uma parte com Zona não age dentro de uma Combinada: a Zona relê a Skill-mãe a cada turno e não acha a mecânica da parte. Use Emissão (na hora) ou uma Skill de Zona à parte." });
  if ((Number(system.prepTurns) || 0) > 0) out.push({ code: "combinedPrep", level: "soft", text: "Uma Combinada não espera o Preparo: ela dispara na hora. Tire o Preparo ou use outra Skill." });
  return out;
}

/**
 * Migração dos itens de fábrica do duelo: acrescenta a uma lista salva só o que falta (por id), sem tocar no
 * que o Mestre editou. `defaults` = os de fábrica; `wanted` = os ids novos.
 * @returns {{list: object[], changed: boolean}}
 */
export function addMissingById(list, defaults, wanted) {
  const out = Array.isArray(list) ? [...list] : [];
  let changed = false;
  for (const id of wanted) {
    if (out.some(e => e?.id === id)) continue;
    const found = (defaults ?? []).find(e => e?.id === id);
    if (!found) continue;
    out.push(structuredClone(found));
    changed = true;
  }
  return { list: out, changed };
}
