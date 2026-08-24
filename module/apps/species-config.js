import { SYSTEM_ID, MEU_SISTEMA, getActiveSpeciesPresets } from "../config.js";

/**
 * Editor visual dos Presets de Anatomia E Skills Raciais por Espécie (substitui
 * o campo de JSON cru). Cada Espécie é um bloco com nome + lista de Partes do
 * Corpo (chave, nome, slot, HP, tags) + lista de Skills Raciais (nome, nível,
 * custo, descrição) concedidas automaticamente ao selecionar a espécie.
 * Salvar grava o conjunto completo exibido na tela, que passa a ser a fonte da
 * verdade (ver `getActiveSpeciesPresets` em config.js).
 */
export class SpeciesConfigApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-species-config",
      title: "Configurar Presets de Anatomia por Espécie",
      template: `systems/${SYSTEM_ID}/templates/apps/species-config.hbs`,
      classes: [SYSTEM_ID, "nihility-config-app"],
      width: 720,
      height: 700,
      resizable: true,
      closeOnSubmit: true
    });
  }

  /** @override */
  getData() {
    const presets = getActiveSpeciesPresets();
    const species = {};
    for (const [key, def] of Object.entries(presets)) {
      species[key] = {
        label: def.label ?? key,
        parts: (def.parts ?? []).map(p => ({ ...p, tagsText: (p.tags ?? []).join(", ") })),
        skills: def.skills ?? []
      };
    }
    return { species };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".species-add").on("click", this._onAddSpecies.bind(this));
    this._bindSpeciesBlock(html.find(".species-block"));
  }

  _bindSpeciesBlock(blocks) {
    blocks.find(".species-delete").on("click", this._onDeleteSpecies.bind(this));
    blocks.find(".part-add").on("click", this._onAddPart.bind(this));
    blocks.find(".part-delete").on("click", this._onDeletePart.bind(this));
    blocks.find(".racial-skill-add").on("click", this._onAddRacialSkill.bind(this));
    blocks.find(".racial-skill-delete").on("click", this._onDeleteRacialSkill.bind(this));
  }

  _onAddSpecies(event) {
    event.preventDefault();
    const key = `nova_especie_${foundry.utils.randomID(4)}`;
    const block = $(`
      <fieldset class="species-block">
        <legend>
          <input type="text" class="species-key-input" value="${key}" placeholder="chave (ex: humano)"/>
          <input type="text" class="species-label-input" value="Nova Espécie" placeholder="Nome exibido"/>
          <a class="species-delete" title="Remover Espécie"><i class="fas fa-trash"></i></a>
        </legend>
        <div class="config-list-header part-header">
          <span>Chave</span><span>Nome</span><span>Slot</span><span>HP</span><span>Tags</span><span></span>
        </div>
        <div class="part-list"></div>
        <a class="config-add-row part-add">+ Nova Parte do Corpo</a>

        <p class="species-block-subtitle">Skills Raciais (concedidas ao selecionar a espécie)</p>
        <div class="config-list-header racial-skill-header">
          <span>Nome</span><span>Nível</span><span>Custo</span><span>Descrição</span><span></span>
        </div>
        <div class="racial-skill-list"></div>
        <a class="config-add-row racial-skill-add">+ Nova Skill Racial</a>
      </fieldset>
    `);
    this._bindSpeciesBlock(block);
    this.element.find(".species-list").append(block);
  }

  _onDeleteSpecies(event) {
    event.preventDefault();
    $(event.currentTarget).closest(".species-block").remove();
  }

  _onAddPart(event) {
    event.preventDefault();
    const row = $(`
      <div class="part-row">
        <input type="text" data-field="key" value="" placeholder="chave"/>
        <input type="text" data-field="label" value="" placeholder="Nome"/>
        <input type="text" data-field="slot" value="body" placeholder="slot"/>
        <input type="number" data-field="hpMax" value="10" placeholder="HP"/>
        <input type="text" data-field="tags" value="" placeholder="tags (vírgula)"/>
        <a class="part-delete" title="Remover Parte"><i class="fas fa-trash"></i></a>
      </div>
    `);
    row.find(".part-delete").on("click", this._onDeletePart.bind(this));
    $(event.currentTarget).closest(".species-block").find(".part-list").append(row);
  }

  _onDeletePart(event) {
    event.preventDefault();
    $(event.currentTarget).closest(".part-row").remove();
  }

  _onAddRacialSkill(event) {
    event.preventDefault();
    const row = $(`
      <div class="racial-skill-row">
        <input type="text" data-field="name" value="" placeholder="Nome"/>
        <input type="number" data-field="level" value="1" placeholder="Nível"/>
        <input type="number" data-field="cost" value="0" placeholder="Custo"/>
        <input type="text" data-field="description" value="" placeholder="Descrição"/>
        <a class="racial-skill-delete" title="Remover"><i class="fas fa-trash"></i></a>
      </div>
    `);
    row.find(".racial-skill-delete").on("click", this._onDeleteRacialSkill.bind(this));
    $(event.currentTarget).closest(".species-block").find(".racial-skill-list").append(row);
  }

  _onDeleteRacialSkill(event) {
    event.preventDefault();
    $(event.currentTarget).closest(".racial-skill-row").remove();
  }

  /** @override */
  async _updateObject() {
    const result = {};
    this.element.find(".species-block").each((_, block) => {
      const $block = $(block);
      const key = $block.find(".species-key-input").val()?.trim();
      if (!key) return;
      const label = $block.find(".species-label-input").val()?.trim() || key;

      const parts = [];
      $block.find(".part-row").each((__, row) => {
        const $row = $(row);
        const partKey = $row.find('[data-field="key"]').val()?.trim();
        if (!partKey) return;
        const tags = ($row.find('[data-field="tags"]').val() || "")
          .split(",")
          .map(t => t.trim())
          .filter(Boolean);
        parts.push({
          key: partKey,
          label: $row.find('[data-field="label"]').val()?.trim() || partKey,
          slot: $row.find('[data-field="slot"]').val()?.trim() || "body",
          hpMax: Number($row.find('[data-field="hpMax"]').val()) || 1,
          tags
        });
      });

      const skills = [];
      $block.find(".racial-skill-row").each((__, row) => {
        const $row = $(row);
        const name = $row.find('[data-field="name"]').val()?.trim();
        if (!name) return;
        skills.push({
          name,
          level: Number($row.find('[data-field="level"]').val()) || 1,
          cost: Number($row.find('[data-field="cost"]').val()) || 0,
          description: $row.find('[data-field="description"]').val()?.trim() || ""
        });
      });

      result[key] = { label, parts, skills };
    });

    await game.settings.set(SYSTEM_ID, MEU_SISTEMA.SETTINGS.speciesPresetsData, JSON.stringify(result, null, 2));
    ui.notifications.info("Presets de Espécie atualizados.");
  }
}
