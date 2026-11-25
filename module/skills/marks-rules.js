/**
 * Marcas e "ao acertar" (item 8c.1). Pura, sem imports — testada em test/marks-onhit.test.mjs.
 *
 * - `onHit`: passivo de uma Skill. Todo golpe de dano de quem a tem põe a Condição no alvo (no Aplicar do
 *   card, como as Condições de elemento). `when` diz em que estado da Skill Ativa vale.
 * - `appliedBy`: o Active Effect guarda o uuid de quem o pôs; "o alvo tem a Condição posta por mim" lê isso.
 */

export const ON_HIT_WHEN = ["always", "on", "off"];
export const ON_HIT_WHEN_LABELS = { always: "Sempre", on: "Só ligada", off: "Só desligada" };

/** `{conditionId, chance, rounds, when, pierce}` limpo, ou `null` (sem "ao acertar"). */
export function normalizeOnHit(raw) {
  const conditionId = String(raw?.conditionId ?? "").trim();
  if (!conditionId) return null;
  const chance = Number(raw?.chance);
  return {
    conditionId,
    chance: Number.isFinite(chance) ? Math.min(100, Math.max(0, chance)) : 100,
    rounds: Math.max(0, Math.floor(Number(raw?.rounds)) || 0),
    when: ON_HIT_WHEN.includes(raw?.when) ? raw.when : "always",
    pierce: Boolean(raw?.pierce)
  };
}

/** O "ao acertar" vale agora? Numa Skill que não é Ativa vale sempre (o `when` só importa para Ativas). */
export function onHitApplies(onHit, { hasUpkeep = false, active = false } = {}) {
  const clean = normalizeOnHit(onHit);
  if (!clean) return false;
  if (!hasUpkeep || clean.when === "always") return true;
  return clean.when === "on" ? Boolean(active) : !active;
}

/**
 * Condições que os golpes de quem ataca disparam pelas Skills dele.
 * @param {{name?:string, level?:number, magic?:boolean, hasUpkeep?:boolean, active?:boolean, onHit?:object}[]} skills
 * @param {(chance:number) => boolean} roll - `rollChance` (chance em %)
 * @returns {{conditionId:string, rounds:number, level:number, magic:boolean, skillName:string}[]}
 */
export function onHitPicks(skills, roll) {
  const picks = [];
  for (const skill of skills ?? []) {
    if (!onHitApplies(skill?.onHit, skill)) continue;
    const clean = normalizeOnHit(skill.onHit);
    if (!roll(clean.chance)) continue;
    picks.push({ conditionId: clean.conditionId, rounds: clean.rounds, level: Math.max(1, Number(skill.level) || 1), magic: Boolean(skill.magic), skillName: skill.name ?? "", pierce: clean.pierce });
  }
  return picks;
}

/** Ids das Condições de uma lista de efeitos postas por `byUuid` (efeito = `{disabled, statuses, flags:{conditionId, appliedBy}}`). */
export function conditionIdsPostedBy(effects, byUuid, systemId) {
  const ids = new Set();
  if (!byUuid) return ids;
  for (const effect of effects ?? []) {
    if (effect.disabled) continue;
    const flags = effect.flags?.[systemId];
    if (flags?.appliedBy !== byUuid) continue;
    for (const status of effect.statuses ?? []) ids.add(status);
    if (flags.conditionId) ids.add(flags.conditionId);
  }
  return ids;
}
