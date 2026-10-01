/**
 * Escudo mantido por Habilidade Ativa: registra, regenera no turno de quem mantém e remove ao desligar.
 * (Separado de skill-effects.js na reorganização de pastas — mesma lógica de antes.)
 */
import { SYSTEM_ID } from "../core/config.js";
import { addShieldToPool, removeShieldPool } from "../combat/shield-pools.js";

/* ------------------------------------------------------------------ Escudo mantido */

/**
 * Onde fica o registro dos Escudos mantidos: no Ator que MANTÉM a Skill (é o turno dele que
 * regenera, e é a Skill dele que desliga), com o alvo por uuid — o Escudo pode estar num aliado.
 */
const SUSTAINED_SHIELD_FLAG = "sustainedShields";

/** Guarda (ou atualiza) o registro de um Escudo mantido por esta Skill neste alvo. */
export async function recordSustainedShield(holder, { targetUuid, skillId, subSkillIndex, regen, cap, label, elements = [] }) {
  const list = foundry.utils.deepClone(holder.getFlag(SYSTEM_ID, SUSTAINED_SHIELD_FLAG) ?? []);
  const same = r => r.targetUuid === targetUuid && r.skillId === skillId && (r.subSkillIndex ?? null) === (subSkillIndex ?? null);
  const existing = list.find(same);
  if (existing) Object.assign(existing, { regen, cap, label, elements });
  else list.push({ targetUuid, skillId, subSkillIndex: subSkillIndex ?? null, regen, cap, label, elements });
  await holder.setFlag(SYSTEM_ID, SUSTAINED_SHIELD_FLAG, list);
}

/**
 * Início do turno de quem mantém (ou o botão "Regenerar agora" fora de combate): cada Escudo
 * mantido regenera até o teto. Registro de Skill que não está mais ligada é descartado.
 * @returns {Promise<string[]>} linhas pro chat
 */
export async function regenerateSustainedShields(holder) {
  const list = holder?.getFlag(SYSTEM_ID, SUSTAINED_SHIELD_FLAG) ?? [];
  if (!list.length) return [];
  const kept = [];
  const rows = [];
  for (const record of list) {
    const skill = holder.items.get(record.skillId);
    const mech = record.subSkillIndex != null ? skill?.system?.subSkills?.[record.subSkillIndex] : skill?.system;
    if (!mech?.active) continue; // desligou por fora: o registro vai embora
    kept.push(record);
    const target = await fromUuid(record.targetUuid);
    if (!target?.system?.attributes?.shield || !(record.regen > 0)) continue;
    // O pool DESTA Skill regenera até o teto dele (os outros pools do alvo não contam).
    const source = { holderUuid: holder.uuid, skillId: record.skillId, subSkillIndex: record.subSkillIndex ?? null, label: record.label, elements: record.elements ?? [] };
    const gain = await addShieldToPool(target, source, record.regen, { cap: record.cap });
    if (!gain) continue;
    rows.push(`${record.label}: Escudo de ${target.name} +${gain}`);
  }
  await holder.setFlag(SYSTEM_ID, SUSTAINED_SHIELD_FLAG, kept);
  if (rows.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: holder }),
      content: `<p><strong>${holder.name}</strong> — Escudos mantidos regeneram:</p><ul>${rows.map(r => `<li>${r}</li>`).join("")}</ul>`
    });
  }
  return rows;
}

/** A Skill desligou: as camadas somem de cada alvo (até o teto) e o registro sai. */
export async function dropSustainedShields(holder, skillId, subSkillIndex) {
  const list = holder?.getFlag(SYSTEM_ID, SUSTAINED_SHIELD_FLAG) ?? [];
  const isThis = r => r.skillId === skillId && (r.subSkillIndex ?? null) === (subSkillIndex ?? null);
  const mine = list.filter(isThis);
  if (!mine.length) return;
  for (const record of mine) {
    const target = await fromUuid(record.targetUuid);
    // As camadas desta Skill somem inteiras: o pool dela sai do alvo (os outros pools ficam).
    if (target) await removeShieldPool(target, { holderUuid: holder.uuid, skillId: record.skillId, subSkillIndex: record.subSkillIndex ?? null });
  }
  await holder.setFlag(SYSTEM_ID, SUSTAINED_SHIELD_FLAG, list.filter(r => !isThis(r)));
}
