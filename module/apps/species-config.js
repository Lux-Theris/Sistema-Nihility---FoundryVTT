import { SYSTEM_ID, MEU_SISTEMA, getActiveSpeciesPresets } from "../config.js";
import { openSkillEditorDialog } from "./skill-editor-dialog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Editor visual dos Presets de Anatomia E Skills Raciais por Espécie (substitui
 * o campo de JSON cru). Cada Espécie é um bloco com nome + lista de Partes do
 * Corpo (chave, nome, slot, HP, tags) + lista de Skills Raciais (nome, tier fixo
 * "racial", nível, custo, descrição, mecânica de uso/dano — mesmos campos de uma
 * Skill de verdade, editados via modal em vez de linha crua) concedidas
 * automaticamente ao selecionar a espécie. Salvar grava o conjunto completo
 * exibido na tela, que passa a ser a fonte da verdade (ver `getActiveSpeciesPresets`
 * em config.js).
 */
export class SpeciesConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-species-config",
    tag: "form",
    window: { title: "Configurar Presets de Anatomia por Espécie", resizable: true },
    classes: [SYSTEM_ID, "nihility-config-app"],
    position: { width: 720, height: 700 },
    form: {
      handler: SpeciesConfigApp.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    },
    actions: {
      addSpecies: SpeciesConfigApp.#onAddSpecies,
      deleteSpecies: SpeciesConfigApp.#onDeleteSpecies,
      addPart: SpeciesConfigApp.#onAddPart,
      deletePart: SpeciesConfigApp.#onDeletePart,
      addRacialSkill: SpeciesConfigApp.#onAddRacialSkill,
      editRacialSkill: SpeciesConfigApp.#onEditRacialSkill,
      deleteRacialSkill: SpeciesConfigApp.#onDeleteRacialSkill
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/species-config.hbs`, scrollable: [""] }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const presets = getActiveSpeciesPresets();
    const species = {};
    for (const [key, def] of Object.entries(presets)) {
      species[key] = {
        label: def.label ?? key,
        parts: (def.parts ?? []).map(p => ({ ...p, tagsText: (p.tags ?? []).join(", ") })),
        skills: (def.skills ?? []).map(s => ({ ...s, dataJson: JSON.stringify(s) }))
      };
    }
    context.species = species;
    console.log(`${SYSTEM_ID} | SpeciesConfigApp._prepareContext:`, Object.keys(species).length, "espécie(s).");
    return context;
  }

  static #onAddSpecies(event, target) {
    event.preventDefault();
    const key = `nova_especie_${foundry.utils.randomID(4)}`;
    const block = document.createElement("fieldset");
    block.className = "species-block";
    block.innerHTML = `
      <legend>
        <input type="text" class="species-key-input" value="${key}" placeholder="chave (ex: humano)"/>
        <input type="text" class="species-label-input" value="Nova Espécie" placeholder="Nome exibido"/>
        <a class="species-delete" data-action="deleteSpecies" title="Remover Espécie"><i class="fas fa-trash"></i></a>
      </legend>
      <div class="config-list-header part-header">
        <span>Chave</span><span>Nome</span><span>Slot</span><span>HP</span><span>Tags</span><span></span>
      </div>
      <div class="part-list"></div>
      <a class="config-add-row" data-action="addPart">+ Nova Parte do Corpo</a>

      <p class="species-block-subtitle">Skills Raciais (concedidas ao selecionar a espécie)</p>
      <div class="racial-skill-list"></div>
      <a class="config-add-row" data-action="addRacialSkill">+ Nova Skill Racial</a>
    `;
    this.element.querySelector(".species-list")?.appendChild(block);
  }

  static #onDeleteSpecies(event, target) {
    event.preventDefault();
    target.closest(".species-block")?.remove();
  }

  static #onAddPart(event, target) {
    event.preventDefault();
    const row = document.createElement("div");
    row.className = "part-row";
    row.innerHTML = `
      <input type="text" data-field="key" value="" placeholder="chave"/>
      <input type="text" data-field="label" value="" placeholder="Nome"/>
      <input type="text" data-field="slot" value="body" placeholder="slot"/>
      <input type="number" data-field="hpMax" value="10" placeholder="HP"/>
      <input type="text" data-field="tags" value="" placeholder="tags (vírgula)"/>
      <a class="part-delete" data-action="deletePart" title="Remover Parte"><i class="fas fa-trash"></i></a>
    `;
    target.closest(".species-block")?.querySelector(".part-list")?.appendChild(row);
  }

  static #onDeletePart(event, target) {
    event.preventDefault();
    target.closest(".part-row")?.remove();
  }

  /** Monta a linha-resumo (nome + nível/custo/mecânica) de uma Skill Racial, guardando os dados completos em `dataset.skill`. */
  static #buildRacialSkillRow(skill) {
    const tags = [];
    if (skill.effectType === "damage") tags.push("Dano");
    if (skill.effectType === "temporary") tags.push("Efeito Temporário");
    if (skill.resistanceTarget) tags.push("Resistência");

    const row = document.createElement("div");
    row.className = "racial-skill-row";
    row.dataset.skill = JSON.stringify(skill);
    row.innerHTML = `
      <span class="racial-skill-summary">${skill.name} <span class="hint-inline">(nível ${skill.level} · custo ${skill.cost}${tags.length ? ` · ${tags.join(", ")}` : ""})</span></span>
      <a class="racial-skill-edit" data-action="editRacialSkill" title="Editar"><i class="fas fa-edit"></i></a>
      <a class="racial-skill-delete" data-action="deleteRacialSkill" title="Remover"><i class="fas fa-trash"></i></a>
    `;
    return row;
  }

  static async #onAddRacialSkill(event, target) {
    event.preventDefault();
    const data = await openSkillEditorDialog({}, { lockTier: "racial" });
    if (!data) return;
    const row = SpeciesConfigApp.#buildRacialSkillRow(data);
    target.closest(".species-block")?.querySelector(".racial-skill-list")?.appendChild(row);
  }

  static async #onEditRacialSkill(event, target) {
    event.preventDefault();
    const row = target.closest(".racial-skill-row");
    const current = JSON.parse(row.dataset.skill || "{}");
    const data = await openSkillEditorDialog(current, { lockTier: "racial" });
    if (!data) return;
    row.replaceWith(SpeciesConfigApp.#buildRacialSkillRow(data));
  }

  static #onDeleteRacialSkill(event, target) {
    event.preventDefault();
    target.closest(".racial-skill-row")?.remove();
  }

  static async #onSubmit(event, form, formData) {
    const result = {};
    this.element.querySelectorAll(".species-block").forEach(block => {
      const key = block.querySelector(".species-key-input")?.value.trim();
      if (!key) return;
      const label = block.querySelector(".species-label-input")?.value.trim() || key;

      const parts = [];
      block.querySelectorAll(".part-row").forEach(row => {
        const partKey = row.querySelector('[data-field="key"]')?.value.trim();
        if (!partKey) return;
        const tags = (row.querySelector('[data-field="tags"]')?.value || "")
          .split(",")
          .map(t => t.trim())
          .filter(Boolean);
        parts.push({
          key: partKey,
          label: row.querySelector('[data-field="label"]')?.value.trim() || partKey,
          slot: row.querySelector('[data-field="slot"]')?.value.trim() || "body",
          hpMax: Number(row.querySelector('[data-field="hpMax"]')?.value) || 1,
          tags
        });
      });

      const skills = [];
      block.querySelectorAll(".racial-skill-row").forEach(row => {
        const skill = JSON.parse(row.dataset.skill || "{}");
        if (!skill.name) return;
        skills.push(skill);
      });

      result[key] = { label, parts, skills };
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.speciesPresetsData, JSON.stringify(result, null, 2));
    ui.notifications.info("Presets de Espécie atualizados.");
    console.log(`${SYSTEM_ID} | SpeciesConfigApp: ${Object.keys(result).length} espécie(s) salva(s).`, result);
  }
}
