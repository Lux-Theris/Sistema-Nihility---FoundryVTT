/**
 * Complexidade de uma Skill (item 8c.1): o Tier diz quanto de "regra" uma Skill pode carregar.
 * "Uma Skill Extra nunca poderia sonhar em fazer o que uma Única faz" (dono, 19/11). A pontuação é
 * contada sozinha pelo editor; passar do teto do Tier é só aviso, nunca trava (o Mestre aprova assim mesmo).
 * Pura e testada em test/marks-onhit.test.mjs; os tetos vêm das Regras da Mesa (`complexityCap*`).
 *
 * Pesos (os números do dono servem para começar): 1 por efeito, +1 se tem Condição, +2 "Só se…" (no
 * efeito ou na Skill), +2 empurrão, +2 área ou Zona, +3 Estrutura, +1 Ativa, +1 "ao acertar", +1 por
 * Sub-Skill (uma Combinada conta +2 por parte, no lugar do +1).
 */
import { hasOnlyIf } from "./only-if-rules.js";

export const COMPLEXITY_WEIGHTS = {
  effect: 1,
  condition: 1,
  onlyIf: 2,
  push: 2,
  area: 2,
  structure: 3,
  active: 1,
  onHit: 1,
  subSkill: 1,
  combinedPart: 2
};

/**
 * Tetos por Tier (`null` = sem teto: Ultimate e Racial). `caps` = `{extra, normal, unique}`.
 * @param {string} tier
 * @param {{extra?:number, normal?:number, unique?:number}} caps
 */
export function complexityCap(tier, caps = {}) {
  const map = { extra: caps.extra, normal: caps.normal, unique: caps.unique };
  const cap = map[tier];
  return Number.isFinite(Number(cap)) && Number(cap) > 0 ? Number(cap) : null;
}

/**
 * Pontuação e a conta por partes (para a linha "Complexidade 11 / 12" e o card do pedido).
 * @param {object} mech - a Skill (system) no formato do schema
 * @returns {{score:number, parts:{label:string, points:number}[]}}
 */
export function skillComplexity(mech) {
  const m = mech ?? {};
  const W = COMPLEXITY_WEIGHTS;
  const parts = [];
  const add = (label, points) => {
    if (points > 0) parts.push({ label, points });
  };
  const effectType = m.effectType ?? "none";
  const effects = effectType === "temporary" && Array.isArray(m.effects) ? m.effects : [];
  add("efeitos", effects.length * W.effect);
  add("Condições", effects.filter(e => e?.conditionId).length * W.condition);
  add("“Só se…” nos efeitos", effects.filter(e => e?.target !== "push" && hasOnlyIf(e?.onlyIf)).length * W.onlyIf);
  add("empurrão", effects.filter(e => e?.target === "push").length * W.push);
  if (hasOnlyIf(m.onlyIf)) add("“Só se…” da Skill", W.onlyIf);
  if ((effectType === "damage" || effectType === "temporary") && (m.targetType === "emission" || m.targetType === "zone")) add("área ou Zona", W.area);
  if (effectType === "structure" || m.targetType === "structure") add("Estrutura", W.structure);
  if (m.hasUpkeep) add("Ativa", W.active);
  if (m.onHit?.conditionId) add("“ao acertar”", W.onHit);
  const subs = Array.isArray(m.subSkills) ? m.subSkills.length : 0;
  if (subs) add(m.combined ? "partes da Combinada" : "Sub-Skills", subs * (m.combined ? W.combinedPart : W.subSkill));
  return { score: parts.reduce((sum, p) => sum + p.points, 0), parts };
}

/**
 * Veredito: `{score, cap, over, text}`. `cap` null = Tier sem teto. `text` é a linha da ficha
 * ("Complexidade 11 / 12", "Complexidade 9 (sem teto neste Tier)").
 */
export function complexityVerdict(mech, tier, caps) {
  const { score, parts } = skillComplexity(mech);
  const cap = complexityCap(tier, caps);
  return {
    score,
    cap,
    parts,
    over: cap !== null && score > cap,
    text: cap === null ? `Complexidade ${score}` : `Complexidade ${score} / ${cap}`
  };
}
