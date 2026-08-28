import { MEU_SISTEMA, getActiveDamageElements } from "../config.js";

const { DialogV2 } = foundry.applications.api;

/** Escapa texto pra uso seguro dentro de atributos/conteúdo HTML (nome/descrição vêm de texto livre do GM). */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/**
 * Modal reaproveitável pra criar/editar os dados de uma Skill fora da ficha de Item de
 * verdade — usado onde uma Skill precisa ser definida "solta" (ex: Skills Raciais de um
 * Preset de Espécie, em species-config.js), sem passar pela regra completa de fusão/pontos.
 * Cobre os campos que uma Skill de verdade tem (tier/nível/custo/descrição/mecânica de uso/
 * dano) — só não inclui Sub-Skills nem linhagem de fusão, que não fazem sentido aqui.
 *
 * @param {object} [initialData] - dados atuais (name, level, cost, description, effectType,
 *   damageFormula, isMagicDamage, damageElements)
 * @param {object} [options]
 * @param {string} [options.lockTier] - se informado, esconde o seletor de Tier e sempre usa
 *   esse valor (ex: "racial", já que Skills Raciais nunca têm outro tier).
 * @returns {Promise<object|null>} os dados editados, ou null se cancelado
 */
export async function openSkillEditorDialog(initialData = {}, options = {}) {
  const { lockTier = null } = options;
  const data = {
    name: initialData.name ?? "",
    tier: initialData.tier ?? lockTier ?? MEU_SISTEMA.SKILL_TIERS[0],
    level: initialData.level ?? 1,
    cost: initialData.cost ?? 0,
    description: initialData.description ?? "",
    effectType: initialData.effectType ?? "none",
    damageFormula: initialData.damageFormula ?? "",
    isMagicDamage: Boolean(initialData.isMagicDamage),
    damageElements: Array.isArray(initialData.damageElements) ? initialData.damageElements : []
  };

  const tierField = lockTier
    ? `<input type="hidden" name="tier" value="${lockTier}"/>`
    : `<div class="form-group"><label>Tier</label><select name="tier">
        ${MEU_SISTEMA.SKILL_TIERS.map(t => `<option value="${t}" ${t === data.tier ? "selected" : ""}>${MEU_SISTEMA.SKILL_TIER_LABELS[t]}</option>`).join("")}
      </select></div>`;

  const effectTypeOptions = MEU_SISTEMA.SKILL_EFFECT_TYPES.map(
    t => `<option value="${t}" ${t === data.effectType ? "selected" : ""}>${MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS[t]}</option>`
  ).join("");

  const elementCheckboxes = getActiveDamageElements()
    .map(
      el =>
        `<label class="inline-checkbox"><input type="checkbox" name="damageElements" value="${el.id}" ${data.damageElements.includes(el.id) ? "checked" : ""}/> ${el.label}</label>`
    )
    .join("");

  const content = `
    <form class="skill-editor-form">
      <div class="form-group"><label>Nome</label><input type="text" name="name" value="${escapeHtml(data.name)}"/></div>
      ${tierField}
      <div class="form-group"><label>Nível</label><input type="number" name="level" value="${data.level}" min="1"/></div>
      <div class="form-group"><label>Custo</label><input type="number" name="cost" value="${data.cost}" min="0"/></div>
      <div class="form-group"><label>Descrição</label><textarea name="description" rows="3">${escapeHtml(data.description)}</textarea></div>
      <div class="form-group"><label>Mecânica ao Usar</label><select name="effectType">${effectTypeOptions}</select></div>
      <p class="hint-inline">Os campos abaixo só valem quando a Mecânica é "Dano".</p>
      <div class="form-group"><label>Fórmula de Dano</label><input type="text" name="damageFormula" value="${escapeHtml(data.damageFormula)}" placeholder="2d6+3"/></div>
      <div class="form-group"><label><input type="checkbox" name="isMagicDamage" ${data.isMagicDamage ? "checked" : ""}/> Dano Mágico (reduzido pela Defesa Mágica do alvo)</label></div>
      <div class="form-group"><label>Elemento(s)</label><div class="skill-editor-elements">${elementCheckboxes || "<span class=\"hint-inline\">Nenhum elemento configurado.</span>"}</div></div>
    </form>`;

  return DialogV2.wait({
    window: { title: initialData.name ? `Editar Skill: ${initialData.name}` : "Nova Skill" },
    content,
    buttons: [
      {
        action: "save",
        label: "Salvar",
        default: true,
        callback: (event, button, dialog) => {
          const form = dialog.element.querySelector(".skill-editor-form");
          return {
            name: form.querySelector('[name="name"]').value.trim() || "Skill Sem Nome",
            tier: lockTier ?? form.querySelector('[name="tier"]').value,
            level: Number(form.querySelector('[name="level"]').value) || 1,
            cost: Number(form.querySelector('[name="cost"]').value) || 0,
            description: form.querySelector('[name="description"]').value.trim(),
            effectType: form.querySelector('[name="effectType"]').value,
            damageFormula: form.querySelector('[name="damageFormula"]').value.trim(),
            isMagicDamage: form.querySelector('[name="isMagicDamage"]').checked,
            damageElements: Array.from(form.querySelectorAll('[name="damageElements"]:checked')).map(el => el.value)
          };
        }
      },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
}
