import { MEU_SISTEMA, getActiveDamageElements } from "../config.js";
import { computeResistanceName, computeResistancePercent, resistanceMaxLevel } from "../skill-effects.js";

const { DialogV2 } = foundry.applications.api;

/** Escapa texto pra uso seguro dentro de atributos/conteúdo HTML (nome/descrição vêm de texto livre do GM). */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** Alvos de Resistência: Geral + cada Elemento ativo — mesma lista usada na ficha completa de Skill. */
function resistanceTargetOptions() {
  return [{ value: "general", label: "Geral" }, ...getActiveDamageElements().map(el => ({ value: el.id, label: el.label }))];
}

function buildEffectRowHtml(entry) {
  const options = MEU_SISTEMA.EFFECT_TARGETS.map(
    t => `<option value="${t}" ${t === entry.target ? "selected" : ""}>${MEU_SISTEMA.EFFECT_TARGET_LABELS[t]}</option>`
  ).join("");
  return `
    <select class="se-effect-target">${options}</select>
    <input type="number" class="se-effect-amount" value="${entry.amount}" placeholder="Qtd."/>
    <input type="number" class="se-effect-duration" value="${entry.durationRounds}" min="0" placeholder="Rounds"/>
    <a class="se-effect-delete" title="Remover"><i class="fas fa-trash"></i></a>
  `;
}

/**
 * Editor ÚNICO de Skill (Nome/Tier/Nível/Custo/Descrição/Resistência/Mecânica ao Usar),
 * reaproveitado em todo lugar onde uma Skill precisa ser criada ou ter sua mecânica editada,
 * fora da manual/automática por IA:
 *  - Skills Raciais de um Preset de Espécie (species-config.js) — dados "soltos", sem Item.
 *  - "+ Nova Habilidade (direto)" na ficha de Ator (actor-sheet.js) — coleta tudo antes de
 *    criar o Item, em vez de nascer em branco e forçar preencher campo a campo na ficha.
 *  - Botão "Editar Skill" na aba Detalhes da ficha de Item (item-sheet.js) — mesmo editor,
 *    populado com os dados atuais, grava de volta com `item.update()`.
 * Não inclui Sub-Skills nem linhagem de fusão (não fazem sentido fora de um Item de verdade)
 * nem a Descrição rica em HTML de uma Skill já existente (isso mora na aba própria da ficha,
 * ver `hideDescription`). Os painéis de Dano/Efeito Temporário/Resistência só aparecem quando
 * escolhidos, e trocar de opção antes de Salvar apaga de verdade os dados do modo anterior
 * (nunca fica "fantasma" no documento salvo).
 *
 * @param {object} [initialData] - dados atuais (name, level, cost, description, effectType,
 *   damageFormula, isMagicDamage, damageElements, effects, resistanceTarget)
 * @param {object} [options]
 * @param {string} [options.lockTier] - se informado, esconde o seletor de Tier e sempre usa
 *   esse valor (ex: "racial", já que Skills Raciais nunca têm outro tier).
 * @param {string[]} [options.tierChoices] - lista de Tiers selecionáveis quando `lockTier` não
 *   é usado (default: todo SKILL_TIERS exceto "racial" — Racial só entra via `lockTier`).
 * @param {boolean} [options.hideDescription] - esconde o campo Descrição (usado ao editar uma
 *   Skill que já é um Item de verdade — a Descrição rica em HTML vive na aba própria da ficha,
 *   e reaproveitar o textarea simples daqui por cima dela destruiria a formatação).
 * @param {boolean} [options.levelReadonly] - trava o campo Nível (mesma regra da ficha: só o
 *   Mestre sobe nível à mão — jogador usa o botão de Level Up, GM-only, fora deste modal).
 * @returns {Promise<object|null>} os dados editados, ou null se cancelado
 */
export async function openSkillEditorDialog(initialData = {}, options = {}) {
  const { lockTier = null, tierChoices = null, hideDescription = false, levelReadonly = false } = options;
  const data = {
    name: initialData.name ?? "",
    tier: initialData.tier ?? lockTier ?? MEU_SISTEMA.SKILL_TIERS[0],
    level: initialData.level ?? 1,
    cost: initialData.cost ?? 0,
    description: initialData.description ?? "",
    resistanceTarget: initialData.resistanceTarget ?? "",
    effectType: initialData.effectType ?? "none",
    damageFormula: initialData.damageFormula ?? "",
    isMagicDamage: Boolean(initialData.isMagicDamage),
    damageElements: Array.isArray(initialData.damageElements) ? initialData.damageElements : [],
    effects: Array.isArray(initialData.effects) ? foundry.utils.deepClone(initialData.effects) : []
  };

  const tierField = lockTier
    ? `<div class="skill-editor-tier-lock"><i class="fas fa-lock"></i> Tier travado: ${MEU_SISTEMA.SKILL_TIER_LABELS[lockTier] ?? lockTier}</div>`
    : `<div class="form-group"><label>Tier</label><select name="tier">
        ${(tierChoices ?? MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial"))
          .map(t => `<option value="${t}" ${t === data.tier ? "selected" : ""}>${MEU_SISTEMA.SKILL_TIER_LABELS[t]}</option>`)
          .join("")}
      </select></div>`;

  const descriptionField = hideDescription
    ? ""
    : `<div class="form-group"><label>Descrição</label><textarea name="description" rows="3">${escapeHtml(data.description)}</textarea></div>`;

  const effectTypeOptions = MEU_SISTEMA.SKILL_EFFECT_TYPES.map(
    t => `<option value="${t}" ${t === data.effectType ? "selected" : ""}>${MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS[t]}</option>`
  ).join("");

  const elementChips = getActiveDamageElements()
    .map(
      el =>
        `<label class="element-chip ${data.damageElements.includes(el.id) ? "checked" : ""}">
          <input type="checkbox" name="damageElements" value="${el.id}" ${data.damageElements.includes(el.id) ? "checked" : ""}/>
          <span class="dot" style="background:${el.color}"></span>${el.label}
        </label>`
    )
    .join("");

  const resistChips = resistanceTargetOptions()
    .map(
      opt =>
        `<label class="element-chip resist-chip ${data.resistanceTarget === opt.value ? "checked" : ""}">
          <input type="radio" name="resistTarget" value="${opt.value}" ${data.resistanceTarget === opt.value ? "checked" : ""}/>${opt.label}
        </label>`
    )
    .join("");

  const content = `
    <form class="skill-editor-form">
      <div class="form-group"><label>Nome</label><input type="text" name="name" value="${escapeHtml(data.name)}"/></div>
      ${tierField}
      <div class="row-2">
        <div class="form-group"><label>Nível</label><input type="number" name="level" value="${data.level}" min="1" ${levelReadonly ? "readonly" : ""}/></div>
        <div class="form-group"><label>Custo</label><input type="number" name="cost" value="${data.cost}" min="0"/></div>
      </div>
      ${descriptionField}

      <label class="checkbox-line">
        <input type="checkbox" name="resistEnable" ${data.resistanceTarget ? "checked" : ""}/>
        Esta Skill concede Resistência/Imunidade passiva
        <span class="hint-inline">(independente da Mecânica ao Usar abaixo — pode ter as duas)</span>
      </label>
      <div class="mechanic-panel resist se-resist-panel">
        <div class="field-hint-label">Alvo <span class="hint-inline" style="display:inline;">(escolha um — Geral cobre qualquer dano, Elemento só aquele tipo)</span></div>
        <div class="element-grid">${resistChips}</div>
        <p class="hint-inline se-resist-info">&nbsp;</p>
      </div>

      <hr/>

      <div class="form-group"><label>Mecânica ao Usar</label><select name="effectType">${effectTypeOptions}</select></div>

      <div class="mechanic-panel se-damage-panel">
        <div class="form-group"><label>Fórmula de Dano</label><input type="text" name="damageFormula" value="${escapeHtml(data.damageFormula)}" placeholder="2d6+3"/></div>
        <label class="checkbox-line"><input type="checkbox" name="isMagicDamage" ${data.isMagicDamage ? "checked" : ""}/> Dano Mágico (reduzido pela Defesa Mágica do alvo)</label>
        <div class="form-group"><label>Elemento(s)</label><div class="element-grid">${elementChips || "<span class=\"hint-inline\">Nenhum elemento configurado.</span>"}</div></div>
      </div>

      <div class="mechanic-panel se-temp-panel">
        <div class="field-hint-label">Efeitos <span class="hint-inline" style="display:inline;">(pode combinar quantos alvos quiser)</span></div>
        <div class="effect-list-header"><span>Alvo</span><span>Quantidade</span><span>Duração (rounds)</span><span></span></div>
        <ol class="sub-list effect-list se-effect-list"></ol>
        <a class="config-add-row se-add-effect">+ Efeito</a>
        <p class="hint-inline">Quantidade negativa = debuff/drawback. Escudo ignora Duração (some só ao absorver dano).</p>
      </div>
    </form>`;

  return DialogV2.wait({
    window: { title: initialData.name ? `Editar Skill: ${initialData.name}` : "Nova Skill" },
    position: { width: 500 },
    content,
    render: (event, dialog) => setupSkillEditorInteractivity(dialog.element, data),
    buttons: [
      {
        action: "save",
        label: "Salvar",
        default: true,
        callback: (event, button, dialog) => readSkillEditorForm(dialog.element, lockTier)
      },
      { action: "cancel", label: "Cancelar", callback: () => null }
    ],
    rejectClose: false
  });
}

/** Liga a interatividade do modal: mostrar/esconder painéis, linhas de Efeito, e o resumo de Resistência. */
function setupSkillEditorInteractivity(root, data) {
  const mechanicSelect = root.querySelector('[name="effectType"]');
  const damagePanel = root.querySelector(".se-damage-panel");
  const tempPanel = root.querySelector(".se-temp-panel");
  const resistEnable = root.querySelector('[name="resistEnable"]');
  const resistPanel = root.querySelector(".se-resist-panel");
  const effectList = root.querySelector(".se-effect-list");
  const levelInput = root.querySelector('[name="level"]');

  function applyMechanic() {
    const value = mechanicSelect.value;
    damagePanel.style.display = value === "damage" ? "flex" : "none";
    tempPanel.style.display = value === "temporary" ? "flex" : "none";
  }
  mechanicSelect.addEventListener("change", applyMechanic);
  applyMechanic();

  function applyResistEnable() {
    resistPanel.style.display = resistEnable.checked ? "flex" : "none";
  }
  resistEnable.addEventListener("change", applyResistEnable);
  applyResistEnable();

  function updateResistInfo() {
    const checked = root.querySelector('[name="resistTarget"]:checked');
    const info = root.querySelector(".se-resist-info");
    if (!checked) return;
    const target = checked.value;
    const level = Number(levelInput.value) || 1;
    const maxLevel = resistanceMaxLevel(target);
    const percent = Math.round(computeResistancePercent(target, level) * 100);
    const nextName = target !== "general" ? computeResistanceName(target, maxLevel) : null;
    info.innerHTML =
      `Redução atual: <b>${percent}%</b> (nível ${level}/${maxLevel}).` +
      (nextName ? ` Ao chegar no teto, o nome muda sozinho pra "${nextName}".` : ` Resistência Geral nunca vira Imunidade (ficaria forte demais).`);
  }
  root.querySelectorAll('[name="resistTarget"]').forEach(radio => {
    radio.addEventListener("change", () => {
      root.querySelectorAll(".resist-chip").forEach(chip => chip.classList.toggle("checked", chip.querySelector("input").checked));
      updateResistInfo();
    });
  });
  levelInput.addEventListener("input", updateResistInfo);
  updateResistInfo();

  root.querySelectorAll('[name="damageElements"]').forEach(cb => {
    cb.addEventListener("change", () => cb.closest(".element-chip")?.classList.toggle("checked", cb.checked));
  });

  function addEffectRow(entry = { target: MEU_SISTEMA.EFFECT_TARGETS[0], amount: 1, durationRounds: 1 }) {
    const li = document.createElement("li");
    li.className = "effect-row";
    li.innerHTML = buildEffectRowHtml(entry);
    li.querySelector(".se-effect-delete").addEventListener("click", event => {
      event.preventDefault();
      li.remove();
    });
    effectList.appendChild(li);
  }
  root.querySelector(".se-add-effect").addEventListener("click", event => {
    event.preventDefault();
    addEffectRow();
  });
  data.effects.forEach(addEffectRow);
}

/**
 * Lê o estado atual do formulário — só devolve os campos do modo de Mecânica/Resistência que
 * estão ativos no momento do Salvar. `description` vem `null` quando `hideDescription` escondeu
 * o campo (editando uma Skill que já é Item — quem chama sabe que deve ignorar essa chave).
 */
function readSkillEditorForm(root, lockTier) {
  const effectType = root.querySelector('[name="effectType"]').value;
  const resistEnabled = root.querySelector('[name="resistEnable"]').checked;
  const resistChecked = root.querySelector('[name="resistTarget"]:checked');
  const descriptionEl = root.querySelector('[name="description"]');

  return {
    name: root.querySelector('[name="name"]').value.trim() || "Skill Sem Nome",
    tier: lockTier ?? root.querySelector('[name="tier"]').value,
    level: Number(root.querySelector('[name="level"]').value) || 1,
    cost: Number(root.querySelector('[name="cost"]').value) || 0,
    description: descriptionEl ? descriptionEl.value.trim() : null,
    resistanceTarget: resistEnabled ? resistChecked?.value ?? "general" : "",
    effectType,
    damageFormula: effectType === "damage" ? root.querySelector('[name="damageFormula"]').value.trim() : "",
    isMagicDamage: effectType === "damage" && root.querySelector('[name="isMagicDamage"]').checked,
    damageElements:
      effectType === "damage" ? Array.from(root.querySelectorAll('[name="damageElements"]:checked')).map(el => el.value) : [],
    effects:
      effectType === "temporary"
        ? Array.from(root.querySelectorAll(".se-effect-list .effect-row")).map(row => ({
            target: row.querySelector(".se-effect-target").value,
            amount: Number(row.querySelector(".se-effect-amount").value) || 0,
            durationRounds: Number(row.querySelector(".se-effect-duration").value) || 0
          }))
        : []
  };
}
