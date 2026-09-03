import { MEU_SISTEMA, getActiveDamageElements, getActiveStatusConditions, getResistanceTargetOptions } from "../config.js";
import { computeResistanceName, computeResistancePercent, resistanceMaxLevel } from "../skill-effects.js";

const { DialogV2 } = foundry.applications.api;

/** Escapa texto pra uso seguro dentro de atributos/conteúdo HTML (nome/descrição vêm de texto livre do GM). */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** true = alvo aceita "Periódico" (veneno/cura contínua) — só faz sentido pra HP/Energia. */
function targetAcceptsPeriodic(target) {
  return target === "hp" || target === "energy";
}

function buildEffectRowHtml(entry) {
  const options = MEU_SISTEMA.EFFECT_TARGETS.map(
    t => `<option value="${t}" ${t === entry.target ? "selected" : ""}>${MEU_SISTEMA.EFFECT_TARGET_LABELS[t]}</option>`
  ).join("");
  const conditionOptions =
    `<option value="">— sem Condição —</option>` +
    getActiveStatusConditions()
      .map(c => `<option value="${c.id}" ${c.id === entry.conditionId ? "selected" : ""}>${c.label}</option>`)
      .join("");
  const tickUnitOptions = MEU_SISTEMA.PERIODIC_TICK_UNITS.map(
    u => `<option value="${u}" ${u === entry.tickUnit ? "selected" : ""}>${MEU_SISTEMA.PERIODIC_TICK_UNIT_LABELS[u]}</option>`
  ).join("");
  const modifierTypeOptions = MEU_SISTEMA.EFFECT_MODIFIER_TYPES.map(
    m => `<option value="${m}" ${m === (entry.modifierType || "flat") ? "selected" : ""}>${MEU_SISTEMA.EFFECT_MODIFIER_TYPE_LABELS[m]}</option>`
  ).join("");
  const periodicVisible = targetAcceptsPeriodic(entry.target);
  const modifierTypeVisible = MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(entry.target);
  const entryElements = Array.isArray(entry.damageElements) ? entry.damageElements : [];
  const elementChipsHtml = getActiveDamageElements()
    .map(
      el =>
        `<label class="element-chip se-effect-element-chip ${entryElements.includes(el.id) ? "checked" : ""}">
          <input type="checkbox" class="se-effect-element" value="${el.id}" ${entryElements.includes(el.id) ? "checked" : ""}/>
          <span class="dot" style="background:${el.color}"></span>${el.label}
        </label>`
    )
    .join("");

  return `
    <div class="effect-row-main">
      <select class="se-effect-target">${options}</select>
      <input type="number" class="se-effect-amount" value="${entry.amount}" placeholder="Qtd."/>
      <input type="number" class="se-effect-duration" value="${entry.durationRounds}" min="0" placeholder="Rounds/Ticks"/>
      <a class="se-effect-delete" title="Remover"><i class="fas fa-trash"></i></a>
    </div>
    <div class="effect-row-extra">
      <select class="se-effect-condition" title="Condição nomeada (ícone de status no token — opcional)">${conditionOptions}</select>
      <label class="checkbox-line small se-effect-periodic-line" style="display:${periodicVisible ? "inline-flex" : "none"};">
        <input type="checkbox" class="se-effect-periodic" ${entry.periodic ? "checked" : ""}/> Periódico
      </label>
      <select class="se-effect-tick-unit" style="display:${periodicVisible && entry.periodic ? "inline-block" : "none"};">${tickUnitOptions}</select>
      <select class="se-effect-modifier-type" style="display:${modifierTypeVisible ? "inline-block" : "none"};" title="Fixo soma direto no resultado; Multiplicador lê Quantidade como percentual (20 = ×1.20)">${modifierTypeOptions}</select>
    </div>
    <div class="effect-row-periodic-extra" style="display:${periodicVisible && entry.periodic ? "flex" : "none"};">
      <span class="hint-inline" style="display:inline;">Elemento(s) do tick de dano (ignorado se o tick for cura):</span>
      <div class="element-grid">${elementChipsHtml || "<span class=\"hint-inline\">Nenhum elemento configurado.</span>"}</div>
    </div>
  `;
}

/** Resumo de uma linha de mecânica (Sub-Skill ou Skill inteira) pra mostrar na lista só-leitura. */
function mechanicSummaryFor(mech) {
  if (mech.effectType === "damage") {
    const elLabels = (mech.damageElements ?? [])
      .map(id => getActiveDamageElements().find(el => el.id === id)?.label)
      .filter(Boolean);
    return `Dano: ${mech.damageFormula || "(sem fórmula)"}${mech.isMagicDamage ? " · Mágico" : ""}${elLabels.length ? ` · ${elLabels.join("+")}` : ""}`;
  }
  if (mech.effectType === "temporary") {
    const count = (mech.effects ?? []).length;
    return `Efeito Temporário: ${count} efeito${count === 1 ? "" : "s"}`;
  }
  return "Descritiva (sem mecânica)";
}

/**
 * Editor ÚNICO de Skill (Nome/Tier/Nível/Custo/Descrição/Resistência/Mecânica ao Usar/Alcance),
 * reaproveitado em todo lugar onde uma Skill precisa ser criada ou ter sua mecânica editada,
 * fora da manual/automática por IA:
 *  - Skills Raciais de um Preset de Espécie (species-config.js) — dados "soltos", sem Item.
 *  - "+ Nova Habilidade (direto)" na ficha de Ator (actor-sheet.js) — coleta tudo antes de
 *    criar o Item, em vez de nascer em branco e forçar preencher campo a campo na ficha.
 *  - Botão "Editar Skill" na aba Detalhes da ficha de Item (item-sheet.js) — mesmo editor,
 *    populado com os dados atuais, grava de volta com `item.update()`.
 * Sub-Skills, Linhagem de Fusão e "Evoluiu de" são sempre só-leitura aqui (nunca digitados à
 * mão): só existem quando `initialData` já os traz — vêm de uma Fusão/Evolução de verdade
 * (skill-economy.js), não de algo definido neste modal. Os painéis de Dano/Efeito Temporário/
 * Resistência/Alcance só aparecem quando escolhidos, e trocar de opção antes de Salvar apaga
 * de verdade os dados do modo anterior (nunca fica "fantasma" no documento salvo).
 *
 * @param {object} [initialData] - dados atuais (name, level, cost, description, effectType,
 *   damageFormula, isMagicDamage, damageElements, effects, resistanceTarget, targetType,
 *   areaShape, areaDistance, areaAngle, subSkills?, fusionSources?, evolvedFrom?)
 * @param {object} [options]
 * @param {string} [options.lockTier] - se informado, esconde o seletor de Tier e sempre usa
 *   esse valor (ex: "racial", já que Skills Raciais nunca têm outro tier).
 * @param {string[]} [options.tierChoices] - lista de Tiers selecionáveis quando `lockTier` não
 *   é usado (default: todo SKILL_TIERS exceto "racial" — Racial só entra via `lockTier`).
 * @param {boolean} [options.levelReadonly] - trava o campo Nível (mesma regra da ficha: só o
 *   Mestre sobe nível à mão — jogador usa o botão de Level Up, GM-only, fora deste modal).
 * @returns {Promise<object|null>} os dados editados, ou null se cancelado
 */
export async function openSkillEditorDialog(initialData = {}, options = {}) {
  const { lockTier = null, tierChoices = null, levelReadonly = false } = options;
  const data = {
    name: initialData.name ?? "",
    tier: initialData.tier ?? lockTier ?? MEU_SISTEMA.SKILL_TIERS[0],
    level: initialData.level ?? 1,
    cost: initialData.cost ?? 0,
    hasUpkeep: Boolean(initialData.hasUpkeep),
    upkeepCost: initialData.upkeepCost ?? 0,
    animationPath: initialData.animationPath ?? "",
    description: initialData.description ?? "",
    resistanceTarget: initialData.resistanceTarget ?? "",
    effectType: initialData.effectType ?? "none",
    damageFormula: initialData.damageFormula ?? "",
    isMagicDamage: Boolean(initialData.isMagicDamage),
    damageElements: Array.isArray(initialData.damageElements) ? initialData.damageElements : [],
    effects: Array.isArray(initialData.effects) ? foundry.utils.deepClone(initialData.effects) : [],
    targetType: initialData.targetType ?? "targeted",
    areaShape: initialData.areaShape ?? "",
    areaDistance: initialData.areaDistance ?? 0,
    areaAngle: initialData.areaAngle ?? 53,
    subSkills: Array.isArray(initialData.subSkills) ? initialData.subSkills : [],
    fusionSources: Array.isArray(initialData.fusionSources) ? initialData.fusionSources : [],
    evolvedFrom: initialData.evolvedFrom ?? ""
  };

  const tierField = lockTier
    ? `<div class="skill-editor-tier-lock"><i class="fas fa-lock"></i> Tier travado: ${MEU_SISTEMA.SKILL_TIER_LABELS[lockTier] ?? lockTier}</div>`
    : `<div class="form-group"><label>Tier</label><select name="tier">
        ${(tierChoices ?? MEU_SISTEMA.SKILL_TIERS.filter(t => t !== "racial"))
          .map(t => `<option value="${t}" ${t === data.tier ? "selected" : ""}>${MEU_SISTEMA.SKILL_TIER_LABELS[t]}</option>`)
          .join("")}
      </select></div>`;

  const evolvedField = data.evolvedFrom
    ? `<div class="evolved-lock"><i class="fas fa-level-up-alt"></i> Evoluiu de: ${escapeHtml(data.evolvedFrom)}
        <span class="hint-inline">(só um vínculo histórico — a skill antiga não existe mais, essa aqui foi definida do zero)</span>
      </div>`
    : "";

  const effectTypeOptions = MEU_SISTEMA.SKILL_EFFECT_TYPES.map(
    t => `<option value="${t}" ${t === data.effectType ? "selected" : ""}>${MEU_SISTEMA.SKILL_EFFECT_TYPE_LABELS[t]}</option>`
  ).join("");

  const targetTypeOptions = MEU_SISTEMA.SKILL_TARGET_TYPES.map(
    t => `<option value="${t}" ${t === data.targetType ? "selected" : ""}>${MEU_SISTEMA.SKILL_TARGET_TYPE_LABELS[t]}</option>`
  ).join("");

  const areaShapeOptions = MEU_SISTEMA.SKILL_AREA_SHAPES.map(
    s => `<option value="${s}" ${s === data.areaShape ? "selected" : ""}>${MEU_SISTEMA.SKILL_AREA_SHAPE_LABELS[s]}</option>`
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

  const resistChips = getResistanceTargetOptions()
    .map(
      opt =>
        `<label class="element-chip resist-chip ${data.resistanceTarget === opt.value ? "checked" : ""}">
          <input type="radio" name="resistTarget" value="${opt.value}" ${data.resistanceTarget === opt.value ? "checked" : ""}/>${opt.label}
        </label>`
    )
    .join("");

  const subSkillsField = data.subSkills.length
    ? `<div class="form-group sub-skills-block">
        <label>Sub-Skills <span class="hint-inline" style="display:inline;">(componentes desta Fusão — cada um com o efeito que ele mesmo tinha; clique pra ver a Descrição original)</span></label>
        <div class="subskill-mini-list">
          ${data.subSkills
            .map(
              (sub, i) => `
            <div class="subskill-mini-item">
              <div class="subskill-mini-row" data-i="${i}">
                <span class="subskill-tier-chip tier-${sub.tier}">${MEU_SISTEMA.SKILL_TIER_LABELS[sub.tier] ?? sub.tier}</span>
                <span class="subskill-mini-name">${escapeHtml(sub.name)}</span>
                <span class="subskill-mini-mechanic">${mechanicSummaryFor(sub)}</span>
                <svg class="subskill-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg>
              </div>
              <div class="subskill-mini-desc">${sub.description || "<i>Sem descrição.</i>"}</div>
            </div>`
            )
            .join("")}
        </div>
      </div>`
    : "";

  const fusionLineageField = data.fusionSources.length
    ? `<div class="form-group fusion-lineage">
        <label>Linhagem de Fusão <span class="hint-inline" style="display:inline;">(só leitura — quais Skills foram consumidas pra gerar esta)</span></label>
        <p class="hint-inline" style="margin:0;">${data.fusionSources.map(escapeHtml).join(" · ")}</p>
      </div>`
    : "";

  const content = `
    <form class="skill-editor-form">
      <div class="form-group"><label>Nome</label><input type="text" name="name" value="${escapeHtml(data.name)}"/></div>
      ${tierField}
      ${evolvedField}
      <div class="row-2">
        <div class="form-group"><label>Nível</label><input type="number" name="level" value="${data.level}" min="1" ${levelReadonly ? "readonly" : ""}/></div>
        <div class="form-group"><label>Custo de Energia <span class="hint-inline" style="display:inline;">(pra "Usar" — não é Ponto de Habilidade)</span></label><input type="number" name="cost" value="${data.cost}" min="0"/></div>
      </div>
      <label class="checkbox-line">
        <input type="checkbox" name="hasUpkeep" ${data.hasUpkeep ? "checked" : ""}/>
        Habilidade Ativa <span class="hint-inline" style="display:inline;">("Usar" liga/desliga — drena Energia por rodada enquanto ligada, além do Custo de Energia acima. Se a Mecânica for Efeito Temporário, os buffs/debuffs duram até desativar em vez da Duração (rounds) de cada Efeito)</span>
      </label>
      <div class="form-group se-upkeep-field" style="display:${data.hasUpkeep ? "flex" : "none"};">
        <label>Custo de Energia por Rodada</label>
        <input type="number" name="upkeepCost" value="${data.upkeepCost}" min="0"/>
      </div>
      <div class="form-group">
        <label>Animação <span class="hint-inline" style="display:inline;">(opcional — caminho de vídeo/imagem/som tocado via módulo Sequencer; sem ele instalado, este campo não faz nada)</span></label>
        <input type="text" name="animationPath" value="${escapeHtml(data.animationPath)}" placeholder="modules/jb2a_patreon/Library/.../explosion.webm"/>
      </div>
      <div class="form-group">
        <label>Descrição</label>
        <prose-mirror name="description" value="${escapeHtml(data.description)}"></prose-mirror>
      </div>

      ${subSkillsField}
      ${fusionLineageField}

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

      <div class="se-range-section">
        <div class="form-group"><label>Tipo de Alvo</label><select name="targetType">${targetTypeOptions}</select></div>
        <div class="mechanic-panel se-emission-panel">
          <div class="form-group"><label>Formato de Área</label><select name="areaShape">${areaShapeOptions}</select></div>
          <div class="row-2">
            <div class="form-group"><label>Distância <span class="hint-inline" style="display:inline;">(unidades de grid)</span></label><input type="number" name="areaDistance" value="${data.areaDistance}" min="0"/></div>
            <div class="form-group se-area-angle-field"><label>Ângulo <span class="hint-inline" style="display:inline;">(graus)</span></label><input type="number" name="areaAngle" value="${data.areaAngle}" min="1" max="360"/></div>
          </div>
        </div>
      </div>

      <div class="mechanic-panel se-damage-panel">
        <div class="form-group"><label>Fórmula de Dano</label><input type="text" name="damageFormula" value="${escapeHtml(data.damageFormula)}" placeholder="2d6+3"/></div>
        <label class="checkbox-line"><input type="checkbox" name="isMagicDamage" ${data.isMagicDamage ? "checked" : ""}/> Dano Mágico</label>
        <div class="form-group"><label>Elemento(s)</label><div class="element-grid">${elementChips || "<span class=\"hint-inline\">Nenhum elemento configurado.</span>"}</div></div>
      </div>

      <div class="mechanic-panel se-temp-panel">
        <div class="field-hint-label">Efeitos <span class="hint-inline" style="display:inline;">(pode combinar quantos alvos quiser)</span></div>
        <p class="hint-inline se-temp-upkeep-note" style="display:${data.hasUpkeep ? "block" : "none"};">
          Habilidade Ativa marcada acima: todo Efeito abaixo (buff/debuff comum OU Periódico/
          Veneno/cura) dura até desativar em vez da "Duração (rounds)" configurada — Periódico
          continua tickando normalmente (por rodada ou manual), só não conta pra expirar sozinho.
        </p>
        <div class="effect-list-header"><span>Alvo</span><span>Quantidade</span><span>Duração (rounds)</span><span></span></div>
        <ol class="sub-list effect-list se-effect-list"></ol>
        <a class="config-add-row se-add-effect">+ Efeito</a>
        <p class="hint-inline">
          Quantidade negativa = debuff/drawback. Escudo ignora Duração (some só ao absorver dano).
          Condição dá ícone reconhecível no token (opcional). "Periódico" (só HP/Energia) aplica a
          Quantidade a CADA tick em vez de uma vez só — Duração vira "quantos ticks". Reaplicar a
          MESMA Condição em quem já a tem apenas ESTENDE a duração/ticks (soma), não duplica.
        </p>
      </div>
    </form>`;

  return DialogV2.wait({
    window: {
      title: initialData.name ? `Editar Skill: ${initialData.name}` : "Nova Skill",
      resizable: true
    },
    classes: ["nihility-skill-editor-dialog"],
    // `height: "auto"` mede o `scrollHeight` do conteúdo pra dimensionar a janela — isso
    // ignora o `max-height: 70vh; overflow-y: auto` do CSS de `.skill-editor-form` (scrollHeight
    // sempre reporta a altura TOTAL, mesmo do que está clipado/rolável), então a janela crescia
    // pro tamanho do formulário inteiro e empurrava Salvar/Cancelar pra fora da tela. Altura fixa
    // faz o form realmente rolar dentro do limite, deixando os botões sempre visíveis embaixo.
    position: { width: 520, height: 700 },
    content,
    render: (event, dialog) => setupSkillEditorInteractivity(dialog.element, data),
    buttons: [
      {
        action: "save",
        label: "Salvar",
        default: true,
        callback: (event, button, dialog) => readSkillEditorForm(dialog.element, lockTier)
      },
      // DialogV2.wait faz `result ?? button.action`: se o callback devolve null/undefined,
      // ele substitui pela STRING "cancel" (o `action`), não por um valor falsy de verdade —
      // "cancel" é truthy, então `if (!data) return;` no chamador nunca dispara. `false`
      // sobrevive ao `??` (só null/undefined são substituídos) e continua falsy.
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
}

/** Liga a interatividade do modal: mostrar/esconder painéis, linhas de Efeito, Sub-Skills expansíveis e o resumo de Resistência. */
function setupSkillEditorInteractivity(root, data) {
  // Aplica o layout de rolagem direto via JS (inline style), em vez de confiar só no CSS de
  // `.nihility-skill-editor-dialog .window-content`/`.skill-editor-form` — não dá pra ter
  // certeza de que a classe passada em `DialogV2.wait({ classes: [...] })` realmente chega no
  // elemento raiz do jeito que `DEFAULT_OPTIONS.classes` chegaria numa Application V2 normal
  // (esse é o único lugar do sistema que passa `classes` direto pro `.wait()`, sem precedente
  // confirmado). Fazendo aqui, contra o `root` (`dialog.element`) que o `render` já garante
  // estar correto, o scroll funciona sempre, com ou sem o CSS por classe realmente aplicando.
  const windowContent = root.querySelector(".window-content");
  if (windowContent) {
    windowContent.style.display = "flex";
    windowContent.style.flexDirection = "column";
  }
  const form = root.querySelector(".skill-editor-form");
  if (form) {
    form.style.flex = "1 1 auto";
    form.style.minHeight = "0";
    form.style.overflowY = "auto";
  }

  const mechanicSelect = root.querySelector('[name="effectType"]');
  const rangeSection = root.querySelector(".se-range-section");
  const damagePanel = root.querySelector(".se-damage-panel");
  const tempPanel = root.querySelector(".se-temp-panel");
  const resistEnable = root.querySelector('[name="resistEnable"]');
  const resistPanel = root.querySelector(".se-resist-panel");
  const effectList = root.querySelector(".se-effect-list");
  const levelInput = root.querySelector('[name="level"]');

  function applyMechanic() {
    const value = mechanicSelect.value;
    rangeSection.style.display = value === "none" ? "none" : "flex";
    damagePanel.style.display = value === "damage" ? "flex" : "none";
    tempPanel.style.display = value === "temporary" ? "flex" : "none";
  }
  mechanicSelect.addEventListener("change", applyMechanic);
  applyMechanic();

  const targetTypeSelect = root.querySelector('[name="targetType"]');
  const emissionPanel = root.querySelector(".se-emission-panel");
  const areaShapeSelect = root.querySelector('[name="areaShape"]');
  const angleField = root.querySelector(".se-area-angle-field");

  function applyTargetType() {
    emissionPanel.style.display = targetTypeSelect.value === "emission" ? "flex" : "none";
  }
  function applyAreaShape() {
    angleField.style.display = areaShapeSelect.value === "cone" ? "flex" : "none";
  }
  targetTypeSelect.addEventListener("change", applyTargetType);
  areaShapeSelect.addEventListener("change", applyAreaShape);
  applyTargetType();
  applyAreaShape();

  function applyResistEnable() {
    resistPanel.style.display = resistEnable.checked ? "flex" : "none";
  }
  resistEnable.addEventListener("change", applyResistEnable);
  applyResistEnable();

  const upkeepEnable = root.querySelector('[name="hasUpkeep"]');
  const upkeepField = root.querySelector(".se-upkeep-field");
  const tempUpkeepNote = root.querySelector(".se-temp-upkeep-note");
  function applyUpkeepEnable() {
    upkeepField.style.display = upkeepEnable.checked ? "flex" : "none";
    tempUpkeepNote.style.display = upkeepEnable.checked ? "block" : "none";
  }
  upkeepEnable.addEventListener("change", applyUpkeepEnable);
  applyUpkeepEnable();

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

  // Sub-Skills: clicar no nome/linha abre a Descrição rica original daquele componente (só leitura).
  root.querySelectorAll(".subskill-mini-row").forEach(row => {
    row.addEventListener("click", () => {
      const desc = row.nextElementSibling;
      const opening = !desc.classList.contains("open");
      desc.classList.toggle("open", opening);
      row.classList.toggle("open", opening);
    });
  });

  function addEffectRow(entry = { target: MEU_SISTEMA.EFFECT_TARGETS[0], amount: 1, modifierType: "flat", durationRounds: 1, conditionId: "", periodic: false, tickUnit: "combatRound", damageElements: [] }) {
    const li = document.createElement("li");
    li.className = "effect-row";
    li.innerHTML = buildEffectRowHtml(entry);
    li.querySelector(".se-effect-delete").addEventListener("click", event => {
      event.preventDefault();
      li.remove();
    });

    // Mostra "Periódico" só pra HP/Energia; some (e desliga) sozinho pra qualquer outro alvo —
    // "Unidade de Tick" e o Elemento(s) do tick de dano só aparecem quando Periódico está marcado.
    const targetSelect = li.querySelector(".se-effect-target");
    const periodicLine = li.querySelector(".se-effect-periodic-line");
    const periodicCheckbox = li.querySelector(".se-effect-periodic");
    const tickUnitSelect = li.querySelector(".se-effect-tick-unit");
    const periodicExtra = li.querySelector(".effect-row-periodic-extra");
    const modifierTypeSelect = li.querySelector(".se-effect-modifier-type");

    function applyPeriodicVisibility() {
      const accepts = targetAcceptsPeriodic(targetSelect.value);
      periodicLine.style.display = accepts ? "inline-flex" : "none";
      if (!accepts) periodicCheckbox.checked = false;
      const periodicOn = accepts && periodicCheckbox.checked;
      tickUnitSelect.style.display = periodicOn ? "inline-block" : "none";
      periodicExtra.style.display = periodicOn ? "flex" : "none";
    }
    // Fixo/Multiplicador só existe pros alvos "de Nave" (Dano/Penetração de Arma) — some sozinho
    // (volta pro padrão "flat") pra qualquer outro alvo, mesmo padrão de applyPeriodicVisibility.
    function applyModifierTypeVisibility() {
      const isShipTarget = MEU_SISTEMA.SHIP_EFFECT_TARGETS.includes(targetSelect.value);
      modifierTypeSelect.style.display = isShipTarget ? "inline-block" : "none";
      if (!isShipTarget) modifierTypeSelect.value = "flat";
    }
    targetSelect.addEventListener("change", applyPeriodicVisibility);
    targetSelect.addEventListener("change", applyModifierTypeVisibility);
    periodicCheckbox.addEventListener("change", applyPeriodicVisibility);

    li.querySelectorAll(".se-effect-element").forEach(cb => {
      cb.addEventListener("change", () => cb.closest(".se-effect-element-chip")?.classList.toggle("checked", cb.checked));
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
 * estão ativos no momento do Salvar. Sub-Skills/Linhagem de Fusão/"Evoluiu de" não estão aqui
 * porque são só-leitura (o modal nunca os cria/edita — quem chama já os tinha em `initialData`
 * e não precisa deles de volta).
 */
function readSkillEditorForm(root, lockTier) {
  const effectType = root.querySelector('[name="effectType"]').value;
  const resistEnabled = root.querySelector('[name="resistEnable"]').checked;
  const resistChecked = root.querySelector('[name="resistTarget"]:checked');
  const hasRange = effectType !== "none";
  const targetType = hasRange ? root.querySelector('[name="targetType"]').value : "targeted";
  const isEmission = hasRange && targetType === "emission";
  const hasUpkeep = root.querySelector('[name="hasUpkeep"]').checked;

  return {
    name: root.querySelector('[name="name"]').value.trim() || "Skill Sem Nome",
    tier: lockTier ?? root.querySelector('[name="tier"]').value,
    level: Number(root.querySelector('[name="level"]').value) || 1,
    cost: Number(root.querySelector('[name="cost"]').value) || 0,
    hasUpkeep,
    upkeepCost: hasUpkeep ? Number(root.querySelector('[name="upkeepCost"]').value) || 0 : 0,
    animationPath: root.querySelector('[name="animationPath"]').value.trim(),
    description: root.querySelector('prose-mirror[name="description"]').value,
    resistanceTarget: resistEnabled ? resistChecked?.value ?? "general" : "",
    effectType,
    targetType,
    areaShape: isEmission ? root.querySelector('[name="areaShape"]').value : "",
    areaDistance: isEmission ? Number(root.querySelector('[name="areaDistance"]').value) || 0 : 0,
    areaAngle: isEmission ? Number(root.querySelector('[name="areaAngle"]').value) || 53 : 53,
    damageFormula: effectType === "damage" ? root.querySelector('[name="damageFormula"]').value.trim() : "",
    isMagicDamage: effectType === "damage" && root.querySelector('[name="isMagicDamage"]').checked,
    damageElements:
      effectType === "damage" ? Array.from(root.querySelectorAll('[name="damageElements"]:checked')).map(el => el.value) : [],
    effects:
      effectType === "temporary"
        ? Array.from(root.querySelectorAll(".se-effect-list .effect-row")).map(row => ({
            target: row.querySelector(".se-effect-target").value,
            amount: Number(row.querySelector(".se-effect-amount").value) || 0,
            modifierType: row.querySelector(".se-effect-modifier-type").value,
            durationRounds: Number(row.querySelector(".se-effect-duration").value) || 0,
            conditionId: row.querySelector(".se-effect-condition").value || "",
            periodic: row.querySelector(".se-effect-periodic").checked,
            tickUnit: row.querySelector(".se-effect-tick-unit").value,
            damageElements: Array.from(row.querySelectorAll(".se-effect-element:checked")).map(el => el.value)
          }))
        : []
  };
}
