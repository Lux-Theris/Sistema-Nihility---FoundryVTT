import { MEU_SISTEMA, getActiveDamageElements, getActiveStatusConditions, getActiveTraits, getAffinityConfig, isSurfacesEnabled } from "../core/config.js";
import { normalizeSurface } from "../environment/surface-rules.js";
import { cycleAffinityLevel, clampAffinityLevel, affinityMultiplier } from "../combat/damage-rules.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";
import { normalizeReaction, normalizeReactions, reactionTag, reactionSentence, permanentMarkSources, timedConditionIds } from "../combat/reaction-rules.js";

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
 *  - Decepar — com chance: a parte do corpo atingida que chega no 0 vira Perdida (Ferimentos por parte);
 *  - Impede regeneração — com chance, por N rodadas (0 = até ser removida): aplica uma Condição
 *    marcada "Impede regeneração" (Fogo/Ácido cauterizando);
 *  - Nave: derrubar Módulo, drenar energia, baixar resistência — com chance e rodadas, só com a
 *    parte do golpe que passou do Escudo, e menos chance contra Endurecimento.
 *
 * Um golpe com vários elementos é dividido em partes iguais; cada parte sofre só a Resistência
 * do seu elemento e dispara só os efeitos dele (ver damage-rules.js).
 *
 * **Subtipo de** (`parent`): Cortante é subtipo de Físico. A parte de Cortante passa pela
 * Resistência a Cortante e pela Resistência Física (uma depois da outra; Imunidade em qualquer uma
 * imuniza), herda os efeitos do Físico que não tiver e a linha dele na tabela de vantagens.
 */

function effectRowHtml(effect = {}) {
  const type = effect.type ?? "condition";
  const conditions = getActiveStatusConditions().map(c => [c.id, c.label]);
  const traits = getActiveTraits().map(t => [t.id, t.label]);
  const types = MEU_SISTEMA.ELEMENT_EFFECT_TYPES.map(t => [t, MEU_SISTEMA.ELEMENT_EFFECT_TYPE_LABELS[t]]);
  // Só Condições com a marca "Impede regeneração" (vazio = a padrão, "Regeneração bloqueada").
  const blocking = [["", "Regeneração bloqueada (padrão)"], ...getActiveStatusConditions().filter(c => (c.healBlock || c.blocksRegeneration) && c.id !== "regen-blocked").map(c => [c.id, c.label])];
  return `
    <div class="element-effect-row">
      <select data-effect-field="type">${optionsHtml(types, type)}</select>
      <select data-effect-field="conditionId" data-shows="condition">${optionsHtml(conditions, effect.conditionId)}</select>
      <select data-effect-field="trait" data-shows="traitBonus">${optionsHtml(traits, effect.trait)}</select>
      <select data-effect-field="layer" data-shows="layer">${optionsHtml(MEU_SISTEMA.DAMAGE_LAYERS.map(l => [l, MEU_SISTEMA.DAMAGE_LAYER_LABELS[l]]), effect.layer ?? "shield")}</select>
      <select data-effect-field="blockConditionId" data-shows="blockRegen" title="A Condição aplicada (precisa ter a marca Impede regeneração no catálogo de Condições)">${optionsHtml(blocking, effect.type === "blockRegen" ? effect.conditionId ?? "" : "")}</select>
      <label data-shows="condition" title="0 = a duração que a própria Condição já tem (uma marca como Molhado precisa de duração).">Rodadas <input type="number" data-effect-field="condRounds" min="0" value="${effect.type === "condition" ? effect.rounds ?? 0 : 0}"/></label>
      <label data-shows="condition sever blockRegen moduleDisable energyDrain resistanceDown">Chance % <input type="number" data-effect-field="chance" min="0" max="100" value="${effect.chance ?? (effect.type === "blockRegen" ? 100 : 25)}"/></label>
      <label data-shows="blockRegen" title="0 = até ser removida (uma maldição). Ácido: 2 rodadas.">Rodadas <input type="number" data-effect-field="blockRounds" min="0" value="${effect.type === "blockRegen" ? effect.rounds ?? 2 : 2}"/></label>
      <label data-shows="traitBonus shieldDrain penetration energyDrain resistanceDown">% <input type="number" data-effect-field="percent" min="0" value="${effect.percent ?? 20}"/></label>
      <label data-shows="layer" title="Negativo = fraqueza (o torpedo sofre −50% no Escudo)">% <input type="number" data-effect-field="layerPercent" value="${effect.type === "layer" ? effect.percent ?? 20 : 20}"/></label>
      <label data-shows="moduleDisable energyDrain resistanceDown">Rodadas <input type="number" data-effect-field="rounds" min="1" value="${effect.rounds ?? 2}"/></label>
      <a class="element-effect-remove" title="Remover efeito"><i class="fas fa-times"></i></a>
    </div>`;
}

/**
 * A seção "Deixa no chão" do cartão (8.2; só com o bloco Superfícies ligado). Segue o quadro aprovado:
 * nome no mapa, chance, raio, o que faz a quem pisa (dano + Condição), altura alcançada, natureza e a
 * duração em rodadas (combate) e minutos (fora dele).
 */
function surfaceSectionHtml(surface) {
  const s = normalizeSurface(surface ?? {}) ?? normalizeSurface({});
  const conditions = [["", "— nenhuma —"], ...getActiveStatusConditions().map(c => [c.id, c.label])];
  const traits = getActiveTraits();
  const group = `surface-nature-${Math.random().toString(36).slice(2, 8)}`;
  const nature = [["matter", "Matéria", "Poça comum: a Antimagia não toca."], ["magic", "Mágica", "Um campo ou Selo de Antimagia a desfaz."], ["origin", "Da origem", "Nasce mágica se veio de uma Skill mágica."]]
    .map(([value, label, title]) => `<label class="surface-nature" title="${escapeHtml(title)}"><input type="radio" name="${group}" data-surface-field="nature" value="${value}" ${s.nature === value ? "checked" : ""}/> ${label}</label>`)
    .join("");
  return `
    <fieldset class="surface-section">
      <legend>Deixa no chão</legend>
      <label class="surface-enable"><input type="checkbox" data-surface-field="enabled" ${s.enabled ? "checked" : ""}/> Este elemento deixa superfície</label>
      <div class="card-config-row">
        <label>Nome no mapa <input type="text" data-surface-field="label" value="${escapeHtml(s.label)}" placeholder="ex.: Poça d'água"/></label>
        <label>Chance <input type="number" data-surface-field="chance" min="0" max="100" value="${s.chance}"/> %</label>
        <label>Raio <input type="number" data-surface-field="radius" min="0" step="0.5" value="${s.radius}"/> m</label>
      </div>
      <div class="card-config-row">
        <span>Quem pisa:</span>
        <label>dano <input type="text" data-surface-field="damageFormula" value="${escapeHtml(s.damageFormula)}" placeholder="ex.: 1d6 (vazio = sem dano)"/></label>
        <label>aplica <select data-surface-field="conditionId">${optionsHtml(conditions, s.conditionId)}</select></label>
        <label>por <input type="number" data-surface-field="conditionRounds" min="0" value="${s.conditionRounds}"/> rodada(s)</label>
      </div>
      <div class="card-config-row">
        <label title="0 = só quem está no chão. Quem voa acima disso não pisa.">Alcança até <input type="number" data-surface-field="height" min="0" step="0.5" value="${s.height}"/> m de altura <span class="hint-inline">(0 = só o chão)</span></label>
        <label title="Quem tem estes Traços não sofre o que a superfície faz.">Imunes <select multiple size="2" data-surface-field="immuneTraits">${traits.map(t => `<option value="${escapeHtml(t.id)}" ${s.immuneTraits.includes(t.id) ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("")}</select></label>
      </div>
      <div class="card-config-row"><span>Natureza</span>${nature}</div>
      <div class="card-config-row">
        <label>Dura <input type="number" data-surface-field="rounds" min="0" value="${s.rounds}"/> rodadas</label>
        <label>· <input type="number" data-surface-field="minutes" min="0" value="${s.minutes}"/> min fora de combate</label>
        <span class="hint-inline">0 rodadas = só pelo relógio; 0 min = só pelas rodadas.</span>
      </div>
      <p class="hint-inline">Quem está de pé numa superfície carrega o elemento dela para as Reações. Bloco Superfícies ligado em Módulos do Sistema.</p>
    </fieldset>`;
}

/** Lê a seção do cartão: dos campos da tela (bloco ligado) ou do JSON escondido (bloco desligado: nada se perde). */
function readSurface(card) {
  const section = card.querySelector(".surface-section");
  if (!section) {
    try {
      return normalizeSurface(JSON.parse(card.querySelector('[data-field="surface"]')?.value || "null"));
    } catch (err) {
      return null;
    }
  }
  const q = field => section.querySelector(`[data-surface-field="${field}"]`);
  return normalizeSurface({
    enabled: q("enabled")?.checked,
    label: q("label")?.value,
    chance: q("chance")?.value,
    radius: q("radius")?.value,
    damageFormula: q("damageFormula")?.value,
    conditionId: q("conditionId")?.value,
    conditionRounds: q("conditionRounds")?.value,
    height: q("height")?.value,
    nature: section.querySelector('[data-surface-field="nature"]:checked')?.value,
    rounds: q("rounds")?.value,
    minutes: q("minutes")?.value,
    immuneTraits: Array.from(q("immuneTraits")?.selectedOptions ?? []).map(o => o.value)
  });
}

/** "—" + os outros elementos do catálogo (um elemento não é subtipo de si mesmo). */
function parentOptions(selfId) {
  return [["", "— (nenhum)"], ...getActiveDamageElements().filter(el => el.id !== selfId).map(el => [el.id, el.label])];
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
    <div class="card-config-row">
      <label title="Cortante é subtipo de Físico: a Resistência Física também vale contra ele (e a dele entra depois), e ele herda os efeitos e as vantagens do Físico que não tiver.">Subtipo de <select data-field="parent">${optionsHtml(parentOptions(values.id), values.parent ?? "")}</select></label>
    </div>
    <input type="hidden" data-field="affinity" value="${escapeHtml(JSON.stringify(values.affinity ?? {}))}"/>
    <input type="hidden" data-field="reactions" value="${escapeHtml(JSON.stringify(values.reactions ?? {}))}"/>
    <input type="hidden" data-field="surface" value="${escapeHtml(JSON.stringify(values.surface ?? null))}"/>
    <p class="affinity-summary hint-inline"></p>
    <div class="element-effect-list">${(values.effects ?? []).map(effectRowHtml).join("")}</div>
    <a class="element-effect-add">+ Efeito ao acertar</a>
    ${isSurfacesEnabled() ? surfaceSectionHtml(values.surface) : ""}`;
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

function readReactions(card) {
  try {
    const parsed = JSON.parse(card.querySelector('[data-field="reactions"]')?.value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
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
    if (type === "condition") {
      const out = { type, conditionId: read("conditionId"), chance: Math.min(100, Math.max(0, Number(read("chance")) || 0)) };
      const rounds = Math.max(0, Math.round(Number(read("condRounds")) || 0));
      if (rounds) out.rounds = rounds;
      return out;
    }
    if (type === "traitBonus") return { type, trait: read("trait"), percent: Math.max(0, Number(read("percent")) || 0) };
    if (type === "layer") return { type, layer: read("layer") || "shield", percent: Math.max(-100, Number(read("layerPercent")) || 0) };
    const chance = Math.min(100, Math.max(0, Number(read("chance")) || 0));
    if (type === "sever") return { type, chance };
    if (type === "blockRegen") {
      const out = { type, chance, rounds: Math.max(0, Math.round(Number(read("blockRounds")) || 0)) };
      if (read("blockConditionId")) out.conditionId = read("blockConditionId");
      return out;
    }
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
  const row = { id, label: get("label").trim() || id, color: get("color") || "#c084fc", group: get("group").trim() || "Outros", effects, affinity };
  // Reações elementais (8.1): a Tabela de reações grava no campo oculto; só as válidas vão para o catálogo.
  const reactions = normalizeReactions(readReactions(card));
  if (Object.keys(reactions).length) row.reactions = reactions;
  // Superfícies (8.2): "Deixa no chão". Só guarda quando há o que guardar (ligada ou com nome).
  const surface = readSurface(card);
  if (surface && (surface.enabled || surface.label)) row.surface = surface;
  const parent = get("parent").trim();
  if (parent && parent !== id) row.parent = parent;
  return row;
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
    actions: { toggleAffinityView: DamageElementsConfigApp.#onToggleView, toggleReactionView: DamageElementsConfigApp.#onToggleReactionView }
  };

  _onRender(context, options) {
    super._onRender(context, options);
    // Redesenho volta à visão de cartões (a tabela é montada de novo quando pedida).
    this.element.classList.remove("affinity-mode", "reaction-mode");
    const list = this.element.querySelector(".card-config-list");
    if (!list || this.element.querySelector(".affinity-toolbar")) return;
    const bar = document.createElement("div");
    bar.className = "affinity-toolbar";
    bar.innerHTML = `<button type="button" data-action="toggleAffinityView"><i class="fas fa-table-cells"></i> <span>Tabela de vantagens</span></button>
      <button type="button" data-action="toggleReactionView" class="reaction-toggle"><i class="fas fa-bolt"></i> <span>Tabela de reações</span></button>`;
    list.before(bar);
    const wrap = document.createElement("div");
    wrap.className = "affinity-matrix-wrap";
    wrap.hidden = true;
    list.after(wrap);
    const reactionWrap = document.createElement("div");
    reactionWrap.className = "reaction-matrix-wrap";
    reactionWrap.hidden = true;
    wrap.after(reactionWrap);
  }

  /** Visão atual: "cards" | "affinity" | "reactions". Os dois botões são exclusivos. */
  _setMode(mode) {
    const root = this.element;
    root.classList.toggle("affinity-mode", mode === "affinity");
    root.classList.toggle("reaction-mode", mode === "reactions");
    const affinityWrap = root.querySelector(".affinity-matrix-wrap");
    const reactionWrap = root.querySelector(".reaction-matrix-wrap");
    affinityWrap.hidden = mode !== "affinity";
    reactionWrap.hidden = mode !== "reactions";
    root.querySelector('[data-action="toggleAffinityView"] span').textContent = mode === "affinity" ? "Voltar aos elementos" : "Tabela de vantagens";
    root.querySelector('[data-action="toggleReactionView"] span').textContent = mode === "reactions" ? "Voltar aos elementos" : "Tabela de reações";
    if (mode === "affinity") this._renderMatrix(affinityWrap);
    else if (mode === "reactions") this._renderReactionMatrix(reactionWrap);
    else {
      const labels = this._currentElements().reduce((map, e) => map.set(e.id, e.label), new Map());
      root.querySelectorAll(".card-config-card").forEach(card => refreshAffinitySummary(card, id => labels.get(id) ?? id));
    }
  }

  static #onToggleView(event) {
    event.preventDefault();
    this._setMode(this.element.classList.contains("affinity-mode") ? "cards" : "affinity");
  }

  static #onToggleReactionView(event) {
    event.preventDefault();
    this._setMode(this.element.classList.contains("reaction-mode") ? "cards" : "reactions");
  }

  /**
   * Tabela de reações (8.1): linha = elemento do GOLPE, coluna = o que o alvo carrega. A célula mostra
   * o nome e uma etiqueta curta; tocar abre o popup. Grava no campo oculto `reactions` de cada cartão.
   */
  _renderReactionMatrix(wrap) {
    const elements = this._currentElements();
    const esc = value => escapeHtml(value);
    const cellHtml = (attacker, defender) => {
      const reaction = normalizeReaction(readReactions(attacker.card)[defender.id]);
      const inner = reaction ? `<span class="rc-name">${esc(reaction.label)}</span><span class="rc-tag">${esc(reactionTag(reaction))}</span>` : "—";
      return `<td><button type="button" class="reaction-cell ${reaction ? "has-reaction" : ""}" data-attack="${esc(attacker.id)}" data-carried="${esc(defender.id)}" title="${esc(attacker.label)} contra quem carrega ${esc(defender.label)}">${inner}</button></td>`;
    };
    wrap.innerHTML = elements.length
      ? `<p class="hint-inline">Linha = elemento do <strong>golpe</strong>; coluna = o que o alvo <strong>carrega</strong> (uma marca: Condição com "Elemento do corpo"). Toque numa célula para editar. O elemento da Espécie só conduz, quando a célula diz "conduz".</p>
        <div class="affinity-scroll"><table class="affinity-matrix reaction-matrix">
          <thead><tr><th class="affinity-corner">golpe ↓ · alvo carrega →</th>${elements.map(e => `<th class="affinity-col"><span style="border-color:${esc(e.color)}">${esc(e.label)}</span></th>`).join("")}</tr></thead>
          <tbody>${elements.map(a => `<tr><th class="affinity-row"><span class="dot" style="background:${esc(a.color)}"></span>${esc(a.label)}</th>${elements.map(d => cellHtml(a, d)).join("")}</tr>`).join("")}</tbody>
        </table></div>`
      : `<p class="hint-inline">Crie elementos (com id) para montar a tabela.</p>`;
    const byId = new Map(elements.map(e => [e.id, e]));
    wrap.querySelectorAll("button.reaction-cell").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        const attacker = byId.get(button.dataset.attack);
        const carried = byId.get(button.dataset.carried);
        if (!attacker || !carried) return;
        const changed = await this._editReaction(attacker, carried, elements);
        if (changed) this._renderReactionMatrix(wrap);
      });
    });
  }

  /** O popup de uma célula. Devolve true se gravou. Sem `<form>` (o DialogV2 já tem o dele). */
  async _editReaction(attacker, carried, elements) {
    const input = attacker.card.querySelector('[data-field="reactions"]');
    const table = readReactions(attacker.card);
    const current = normalizeReaction(table[carried.id]);
    const conditions = getActiveStatusConditions();
    const elementLabels = id => elements.find(e => e.id === id)?.label ?? id;
    const conditionLabel = id => conditions.find(c => c.id === id)?.label ?? id;
    const timed = timedConditionIds(elements.map(e => readCard(e.card)).filter(Boolean));
    const permanent = permanentMarkSources(carried.id, conditions, timed);
    const r = current ?? { label: "", damagePercent: 0, spread: null, applyCondition: null, removeCondition: "", leaveSurface: "", shieldDrain: 0, consume: true, bodyConducts: false, against: { character: true, ship: false, structure: false } };
    const condOptions = value => optionsHtml([["", "— escolha —"], ...conditions.map(c => [c.id, c.label])], value);
    const surfacesOn = isSurfacesEnabled();
    const surfaceOptions = optionsHtml([["", "— nenhum —"], ...elements.map(e => [e.id, e.label])], r.leaveSurface);
    const row = (key, title, body, open) => `<div class="rx-row" data-rx-row="${key}" ${open ? "" : "hidden"}><span class="rx-row-title">${title}</span>${body}</div>`;
    const content = `
      <div class="nihility-reaction-dialog">
        <p class="rx-head"><strong>${escapeHtml(attacker.label)}</strong> em quem carrega <strong>${escapeHtml(carried.label)}</strong></p>
        <label class="rx-field">Nome <input type="text" class="rx-label" value="${escapeHtml(r.label)}" placeholder="ex.: Eletrocutado"/></label>
        <div class="rx-section">Então</div>
        <label class="rx-field">Dano desta parte (%) <input type="number" class="rx-percent" value="${r.damagePercent}" min="-100" step="5"/></label>
        <label class="rx-field">Espalhar até (m) <input type="number" class="rx-spread" value="${r.spread?.radius ?? 0}" min="0" step="0.5"/></label>
        <label class="rx-check"><input type="checkbox" class="rx-same" ${r.spread?.sameElement !== false ? "checked" : ""}/> o mesmo dano em quem estiver perto e também carregar ${escapeHtml(carried.label)} (desmarcado: só a Condição vai para quem está perto)</label>
        ${row("apply", "Aplica Condição", `<select class="rx-apply">${condOptions(r.applyCondition?.conditionId ?? "")}</select><label class="rx-inline">por <input type="number" class="rx-apply-rounds" min="0" value="${r.applyCondition?.rounds ?? 1}"/> rodada(s)</label>`, Boolean(r.applyCondition))}
        ${row("remove", "Tira Condição", `<select class="rx-remove">${condOptions(r.removeCondition)}</select>`, Boolean(r.removeCondition))}
        ${row("drain", "Dreno no Escudo", `<label class="rx-inline"><input type="number" class="rx-drain" min="0" value="${r.shieldDrain}"/> % de dano extra só no Escudo</label>`, Boolean(r.shieldDrain))}
        ${row("surface", "Deixa superfície", surfacesOn ? `<select class="rx-surface">${surfaceOptions}</select>` : `<select class="rx-surface" disabled>${surfaceOptions}</select><span class="hint-inline">com o bloco Superfícies ligado</span>`, Boolean(r.leaveSurface))}
        <div class="rx-adders">
          <a data-rx-add="apply">+ Aplica Condição</a><a data-rx-add="surface">+ Deixa superfície</a><a data-rx-add="drain">+ Dreno no Escudo</a><a data-rx-add="remove">+ Tira Condição</a>
        </div>
        <label class="rx-check"><input type="checkbox" class="rx-consume" ${r.consume ? "checked" : ""}/> Consome a marca (tira a Condição que dá ${escapeHtml(carried.label)})</label>
        <label class="rx-check"><input type="checkbox" class="rx-conducts" ${r.bodyConducts ? "checked" : ""}/> O corpo conduz: quem é ${escapeHtml(carried.label)} pela Espécie também espalha (sem levar o multiplicador)</label>
        <div class="rx-section">Vale contra</div>
        <div class="rx-against">
          <label class="rx-check"><input type="checkbox" class="rx-against-character" ${r.against.character ? "checked" : ""}/> Personagem</label>
          <label class="rx-check"><input type="checkbox" class="rx-against-ship" ${r.against.ship ? "checked" : ""}/> Nave (só no Escudo)</label>
          <label class="rx-check"><input type="checkbox" class="rx-against-structure" ${r.against.structure ? "checked" : ""}/> Estrutura (em breve)</label>
        </div>
        <p class="rx-warn hint-inline" ${permanent.length ? "" : "hidden"}>Atenção: ${escapeHtml(permanent.join(", "))} dá a marca ${escapeHtml(carried.label)} sem duração: ela será consumida no primeiro golpe que reagir (ou fica para sempre).</p>
        <p class="rx-sentence hint-inline"></p>
      </div>`;
    const read = root => {
      const q = sel => root.querySelector(sel);
      const radius = Number(q(".rx-spread")?.value) || 0;
      return normalizeReaction({
        label: q(".rx-label")?.value,
        damagePercent: q(".rx-percent")?.value,
        spread: radius > 0 ? { radius, sameElement: q(".rx-same")?.checked } : null,
        applyCondition: !q('[data-rx-row="apply"]')?.hidden && q(".rx-apply")?.value ? { conditionId: q(".rx-apply").value, rounds: q(".rx-apply-rounds")?.value } : null,
        removeCondition: !q('[data-rx-row="remove"]')?.hidden ? q(".rx-remove")?.value : "",
        leaveSurface: surfacesOn && !q('[data-rx-row="surface"]')?.hidden ? q(".rx-surface")?.value ?? "" : r.leaveSurface,
        shieldDrain: !q('[data-rx-row="drain"]')?.hidden ? q(".rx-drain")?.value : 0,
        consume: q(".rx-consume")?.checked,
        bodyConducts: q(".rx-conducts")?.checked,
        against: { character: q(".rx-against-character")?.checked, ship: q(".rx-against-ship")?.checked, structure: q(".rx-against-structure")?.checked }
      });
    };
    const { DialogV2 } = foundry.applications.api;
    const result = await DialogV2.wait({
      window: { title: `Reação — ${attacker.label} × ${carried.label}` },
      classes: ["nihility-reaction-dialog-window"],
      position: { width: 460 },
      content,
      buttons: [
        { action: "save", label: "Salvar", default: true, callback: (event, button, dialog) => ({ reaction: read(dialog.element) }) },
        { action: "remove", label: "Tirar a reação", callback: () => ({ reaction: null }) },
        { action: "cancel", label: "Cancelar", callback: () => false }
      ],
      rejectClose: false,
      render: (event, dialog) => {
        const root = dialog?.element ?? dialog;
        const update = () => {
          const reaction = read(root);
          const sentence = root.querySelector(".rx-sentence");
          if (sentence) sentence.textContent = reaction ? `Na mesa: ${reactionSentence(attacker.id, carried.id, reaction, { element: elementLabels, condition: conditionLabel })}` : "Sem reação: o golpe segue normal.";
        };
        root.addEventListener("input", update);
        root.addEventListener("change", update);
        root.querySelectorAll("[data-rx-add]").forEach(link =>
          link.addEventListener("click", event => {
            event.preventDefault();
            root.querySelector(`[data-rx-row="${link.dataset.rxAdd}"]`)?.removeAttribute("hidden");
            update();
          })
        );
        update();
      }
    });
    if (!result) return false;
    if (result.reaction) table[carried.id] = result.reaction;
    else delete table[carried.id];
    input.value = JSON.stringify(table);
    return true;
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
