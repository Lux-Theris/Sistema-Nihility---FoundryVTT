import { MEU_SISTEMA, getActiveDamageElements, getActiveStatusConditions, getActiveTraits, getAffinityConfig } from "../config.js";
import { cycleAffinityLevel, clampAffinityLevel, affinityMultiplier } from "../damage-rules.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";

/**
 * Editor dos Tipos de Dano. Cada elemento tem id, nome, cor, **Grupo** (organiza os seletores:
 * Físico, Fantasia, Energia, Exótico…) e uma lista opcional de **Efeitos ao acertar**, cada um de
 * um tipo fixo que o código entende (ELEMENT_EFFECT_TYPES em config.js):
 *  - Aplicar Condição (com chance) — usa o efeito padrão da Condição;
 *  - Dano extra contra Traço — ex.: Pólaron +20% contra Orgânico;
 *  - Dano por camada — % (pode ser negativo) contra Escudo, Casco ou Integridade: Phaser +20% no
 *    Escudo, Torpedo −50% no Escudo e +30% no Casco (o de Escudo vale também pro Escudo pessoal);
 *  - Dano extra em Escudo — o antigo, que continua funcionando como Escudo +X%;
 *  - Penetração — ex.: Transfásico ignora parte das defesas (nunca Imunidade);
 *  - Nave: derrubar Módulo, drenar energia, baixar resistência — com chance e rodadas, só com a
 *    parte do golpe que passou do Escudo, e menos chance contra Endurecimento.
 *
 * Um golpe com vários elementos é dividido em partes iguais; cada parte sofre só a Resistência
 * do seu elemento e dispara só os efeitos dele (ver damage-rules.js).
 */

function effectRowHtml(effect = {}) {
  const type = effect.type ?? "condition";
  const conditions = getActiveStatusConditions().map(c => [c.id, c.label]);
  const traits = getActiveTraits().map(t => [t.id, t.label]);
  const types = MEU_SISTEMA.ELEMENT_EFFECT_TYPES.map(t => [t, MEU_SISTEMA.ELEMENT_EFFECT_TYPE_LABELS[t]]);
  return `
    <div class="element-effect-row">
      <select data-effect-field="type">${optionsHtml(types, type)}</select>
      <select data-effect-field="conditionId" data-shows="condition">${optionsHtml(conditions, effect.conditionId)}</select>
      <select data-effect-field="trait" data-shows="traitBonus">${optionsHtml(traits, effect.trait)}</select>
      <select data-effect-field="layer" data-shows="layer">${optionsHtml(MEU_SISTEMA.DAMAGE_LAYERS.map(l => [l, MEU_SISTEMA.DAMAGE_LAYER_LABELS[l]]), effect.layer ?? "shield")}</select>
      <label data-shows="condition moduleDisable energyDrain resistanceDown">Chance % <input type="number" data-effect-field="chance" min="0" max="100" value="${effect.chance ?? 25}"/></label>
      <label data-shows="traitBonus shieldDrain penetration energyDrain resistanceDown">% <input type="number" data-effect-field="percent" min="0" value="${effect.percent ?? 20}"/></label>
      <label data-shows="layer" title="Negativo = fraqueza (o torpedo sofre −50% no Escudo)">% <input type="number" data-effect-field="layerPercent" value="${effect.type === "layer" ? effect.percent ?? 20 : 20}"/></label>
      <label data-shows="moduleDisable energyDrain resistanceDown">Rodadas <input type="number" data-effect-field="rounds" min="1" value="${effect.rounds ?? 2}"/></label>
      <a class="element-effect-remove" title="Remover efeito"><i class="fas fa-times"></i></a>
    </div>`;
}

function renderCard(values) {
  const groups = [...new Set(getActiveDamageElements().map(el => el.group).concat(["Físico", "Fantasia", "Energia", "Exótico"]))];
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: fire)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome exibido"/>
      <input type="color" data-field="color" value="${escapeHtml(values.color ?? "#c084fc")}"/>
      <input type="text" data-field="group" value="${escapeHtml(values.group ?? "")}" placeholder="Grupo" list="nihility-element-groups"/>
      <datalist id="nihility-element-groups">${groups.map(g => `<option value="${escapeHtml(g)}"></option>`).join("")}</datalist>
    </div>
    <input type="hidden" data-field="affinity" value="${escapeHtml(JSON.stringify(values.affinity ?? {}))}"/>
    <p class="affinity-summary hint-inline"></p>
    <div class="element-effect-list">${(values.effects ?? []).map(effectRowHtml).join("")}</div>
    <a class="element-effect-add">+ Efeito ao acertar</a>`;
}

function syncEffectRow(row) {
  const type = row.querySelector('[data-effect-field="type"]').value;
  row.querySelectorAll("[data-shows]").forEach(el => {
    el.hidden = !el.dataset.shows.split(" ").includes(type);
  });
}

/** "Efetivo contra: Gelo · Ineficaz contra: Fogo" no cartão, a partir da tabela guardada nele. */
function refreshAffinitySummary(card, labelOf = id => id) {
  const summary = card.querySelector(".affinity-summary");
  if (!summary) return;
  const affinity = readAffinity(card);
  const groups = {};
  for (const [defenseId, level] of Object.entries(affinity)) (groups[level] ??= []).push(labelOf(defenseId));
  const parts = [2, 1, -1, -2]
    .filter(level => groups[level]?.length)
    .map(level => `${MEU_SISTEMA.AFFINITY_LEVEL_LABELS[level]} contra: ${groups[level].join(", ")}`);
  summary.textContent = parts.length ? parts.join(" · ") : "Neutro contra todos (abra a Tabela para mudar).";
}

function readAffinity(card) {
  try {
    const parsed = JSON.parse(card.querySelector('[data-field="affinity"]')?.value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function wireCard(card) {
  refreshAffinitySummary(card, id => getActiveDamageElements().find(e => e.id === id)?.label ?? id);
  const list = card.querySelector(".element-effect-list");
  list.querySelectorAll(".element-effect-row").forEach(syncEffectRow);
  card.querySelector(".element-effect-add").addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", effectRowHtml());
    syncEffectRow(list.lastElementChild);
  });
  list.addEventListener("change", event => {
    if (event.target.matches('[data-effect-field="type"]')) syncEffectRow(event.target.closest(".element-effect-row"));
  });
  list.addEventListener("click", event => {
    if (event.target.closest(".element-effect-remove")) event.target.closest(".element-effect-row").remove();
  });
}

function readCard(card) {
  const get = field => card.querySelector(`[data-field="${field}"]`)?.value ?? "";
  const id = get("id").trim();
  if (!id) return null;
  const effects = Array.from(card.querySelectorAll(".element-effect-row")).map(row => {
    const read = field => row.querySelector(`[data-effect-field="${field}"]`)?.value ?? "";
    const type = read("type");
    if (type === "condition") return { type, conditionId: read("conditionId"), chance: Math.min(100, Math.max(0, Number(read("chance")) || 0)) };
    if (type === "traitBonus") return { type, trait: read("trait"), percent: Math.max(0, Number(read("percent")) || 0) };
    if (type === "layer") return { type, layer: read("layer") || "shield", percent: Math.max(-100, Number(read("layerPercent")) || 0) };
    const chance = Math.min(100, Math.max(0, Number(read("chance")) || 0));
    const rounds = Math.max(1, Math.round(Number(read("rounds")) || 1));
    if (type === "moduleDisable") return { type, chance, rounds };
    if (type === "energyDrain" || type === "resistanceDown") return { type, chance, percent: Math.max(0, Number(read("percent")) || 0), rounds };
    return { type, percent: Math.max(0, Number(read("percent")) || 0) };
  }).filter(e => (e.type !== "condition" || e.conditionId) && (e.type !== "traitBonus" || e.trait));
  const affinity = {};
  for (const [defenseId, level] of Object.entries(readAffinity(card))) {
    const value = clampAffinityLevel(level);
    if (value) affinity[defenseId] = value;
  }
  return { id, label: get("label").trim() || id, color: get("color") || "#c084fc", group: get("group").trim() || "Outros", effects, affinity };
}

const DamageElementsCards = createCardListConfigApp({
  id: "nihility-damage-elements-config",
  title: "Configurar Tipos de Dano",
  settingsKey: "damageElementsData",
  width: 700,
  addLabel: "+ Novo Tipo de Dano",
  hint:
    "Um golpe com vários elementos é <strong>dividido em partes iguais</strong>: cada parte sofre só a Resistência " +
    "do próprio elemento, e Imunidade zera só a parte dela (Fogo+Gelo contra alguém imune a Fogo ainda causa a metade " +
    "de Gelo). Os <strong>Efeitos ao acertar</strong> valem só para a parte daquele elemento, e quem é imune a ele não " +
    "sofre o efeito. Penetração nunca atravessa Imunidade. <strong>Tabela</strong> (botão no topo): vantagem de cada " +
    "elemento contra os outros, estilo Pokémon — vale contra quem É daquele elemento (Espécie, Skill, Condição), " +
    "contra Escudos e Estruturas daquele elemento.",
  getActiveList: getActiveDamageElements,
  renderCard,
  readCard,
  wireCard
});

const LEVEL_CLASS = { "-2": "immune", "-1": "weak", 0: "neutral", 1: "strong", 2: "super" };

/**
 * Tipos de Dano com duas visões: os cartões (elementos e efeitos) e a **Tabela** de vantagens,
 * linha = quem ataca, coluna = quem defende. Clique esquerdo sobe um nível, direito desce. A
 * tabela é montada dos cartões na tela (inclui os recém-criados) e grava no campo oculto
 * `affinity` de cada cartão, então o Salvar de sempre leva tudo.
 */
export class DamageElementsConfigApp extends DamageElementsCards {
  static DEFAULT_OPTIONS = {
    actions: { toggleAffinityView: DamageElementsConfigApp.#onToggleView }
  };

  _onRender(context, options) {
    super._onRender(context, options);
    // Redesenho volta à visão de cartões (a tabela é montada de novo quando pedida).
    this.element.classList.remove("affinity-mode");
    const list = this.element.querySelector(".card-config-list");
    if (!list || this.element.querySelector(".affinity-toolbar")) return;
    const bar = document.createElement("div");
    bar.className = "affinity-toolbar";
    bar.innerHTML = `<button type="button" data-action="toggleAffinityView"><i class="fas fa-table-cells"></i> <span>Tabela de vantagens</span></button>`;
    list.before(bar);
    const wrap = document.createElement("div");
    wrap.className = "affinity-matrix-wrap";
    wrap.hidden = true;
    list.after(wrap);
  }

  static #onToggleView(event, target) {
    event.preventDefault();
    const root = this.element;
    const showing = root.classList.toggle("affinity-mode");
    const wrap = root.querySelector(".affinity-matrix-wrap");
    wrap.hidden = !showing;
    target.querySelector("span").textContent = showing ? "Voltar aos elementos" : "Tabela de vantagens";
    if (showing) this._renderMatrix(wrap);
    else {
      const labels = this._currentElements().reduce((map, e) => map.set(e.id, e.label), new Map());
      root.querySelectorAll(".card-config-card").forEach(card => refreshAffinitySummary(card, id => labels.get(id) ?? id));
    }
  }

  /** Elementos como estão na tela agora (inclusive os que ainda não foram salvos). */
  _currentElements() {
    return Array.from(this.element.querySelectorAll(".card-config-card"))
      .map(card => ({
        card,
        id: card.querySelector('[data-field="id"]')?.value.trim() ?? "",
        label: card.querySelector('[data-field="label"]')?.value.trim() || card.querySelector('[data-field="id"]')?.value.trim() || "",
        color: card.querySelector('[data-field="color"]')?.value || "#9aa1c2"
      }))
      .filter(e => e.id);
  }

  _renderMatrix(wrap) {
    const elements = this._currentElements();
    const config = getAffinityConfig();
    const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    const mult = level => `×${String(affinityMultiplier(level, config)).replace(".", ",")}`;
    const cell = (attacker, defender) => {
      const level = clampAffinityLevel(readAffinity(attacker.card)[defender.id] ?? 0);
      const text = level ? mult(level) : "";
      return `<td><button type="button" class="affinity-cell level-${LEVEL_CLASS[level]}" data-attack="${esc(attacker.id)}" data-defense="${esc(defender.id)}"
        title="${esc(attacker.label)} contra ${esc(defender.label)}: ${MEU_SISTEMA.AFFINITY_LEVEL_LABELS[level]} ${mult(level)} — clique esquerdo sobe, direito desce">${text}</button></td>`;
    };
    const legend = [2, 1, 0, -1, -2]
      .map(level => `<span class="affinity-legend-item"><span class="affinity-cell level-${LEVEL_CLASS[level]}">${level ? mult(level) : "·"}</span> ${MEU_SISTEMA.AFFINITY_LEVEL_LABELS[level]}</span>`)
      .join("");
    wrap.innerHTML = elements.length
      ? `<p class="hint-inline">Linha = elemento que <strong>ataca</strong>; coluna = elemento que <strong>defende</strong> (o corpo, o Escudo ou a Estrutura). Defensor com dois elementos: os multiplicadores se multiplicam. Multiplicadores em Regras da Mesa.</p>
        <div class="affinity-scroll"><table class="affinity-matrix">
          <thead><tr><th class="affinity-corner">ataca ↓ · defende →</th>${elements
            .map(e => `<th class="affinity-col"><span style="border-color:${esc(e.color)}">${esc(e.label)}</span></th>`)
            .join("")}</tr></thead>
          <tbody>${elements
            .map(a => `<tr><th class="affinity-row"><span class="dot" style="background:${esc(a.color)}"></span>${esc(a.label)}</th>${elements.map(d => cell(a, d)).join("")}</tr>`)
            .join("")}</tbody>
        </table></div>
        <div class="affinity-legend">${legend}</div>`
      : `<p class="hint-inline">Crie elementos (com id) para montar a tabela.</p>`;

    const byId = new Map(elements.map(e => [e.id, e]));
    const step = (button, direction) => {
      const attacker = byId.get(button.dataset.attack);
      if (!attacker) return;
      const input = attacker.card.querySelector('[data-field="affinity"]');
      const affinity = readAffinity(attacker.card);
      const level = cycleAffinityLevel(affinity[button.dataset.defense] ?? 0, direction);
      if (level) affinity[button.dataset.defense] = level;
      else delete affinity[button.dataset.defense];
      input.value = JSON.stringify(affinity);
      button.className = `affinity-cell level-${LEVEL_CLASS[level]}`;
      button.textContent = level ? mult(level) : "";
      button.title = `${attacker.label} contra ${byId.get(button.dataset.defense)?.label ?? ""}: ${MEU_SISTEMA.AFFINITY_LEVEL_LABELS[level]} ${mult(level)} — clique esquerdo sobe, direito desce`;
    };
    wrap.querySelectorAll("button.affinity-cell").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        step(button, 1);
      });
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        step(button, -1);
      });
    });
  }
}
