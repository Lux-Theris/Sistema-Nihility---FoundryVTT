import { MEU_SISTEMA, getStructures } from "../config.js";
import { pickerFieldHtml, readPickerField, wireElementPickerField } from "./checklist-picker.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";
import { openLightConfigDialog, describeLight } from "../lights.js";

/**
 * Editor do catálogo de Estruturas (Parede de Pedra, Bloco de Gelo, Barreira de Mana…) que as
 * Skills com Mecânica "Estrutura" erguem no mapa. Regras em structures.js; luz em lights.js.
 */

function renderStructure(values) {
  const shapes = MEU_SISTEMA.STRUCTURE_SHAPES.map(s => [s, MEU_SISTEMA.STRUCTURE_SHAPE_LABELS[s]]);
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: stone-wall)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome (ex: Parede de Pedra)"/>
      <input type="color" data-field="color" value="${escapeHtml(values.color ?? "#9aa1c2")}"/>
    </div>
    <div class="card-config-row">
      <label>Forma <select data-field="shape">${optionsHtml(shapes, values.shape ?? "line")}</select></label>
      <label title="Linha e forma livre: comprimento máximo. Círculo: raio. Quadrado: lado.">Tamanho (m) <input type="number" step="0.5" min="0.5" data-field="size" value="${values.size ?? 5}"/></label>
      <label title="0 = barreira de mana: o dano sai da Mana de quem conjurou">Vida <input type="number" min="0" data-field="hp" value="${values.hp ?? 30}"/></label>
      <label title="0 = sem prazo">Duração (rodadas) <input type="number" min="0" data-field="durationRounds" value="${values.durationRounds ?? 0}"/></label>
    </div>
    <div class="card-config-row">
      <label><input type="checkbox" data-field="blocksMove" ${values.blocksMove !== false ? "checked" : ""}/> Bloqueia movimento</label>
      <label><input type="checkbox" data-field="blocksSight" ${values.blocksSight ? "checked" : ""}/> Bloqueia visão</label>
      <input type="text" data-field="img" value="${escapeHtml(values.img ?? "")}" placeholder="Imagem (opcional, círculo/quadrado)"/>
      <a class="card-config-pick" data-action="pickIcon" data-field="img" title="Escolher imagem"><i class="fas fa-image"></i></a>
    </div>
    <div class="card-config-row">
      <label title="Desmarcado: a Estrutura não segura golpes entre quem ataca e o alvo (campo antimagia, Muralha de Fogo)"><input type="checkbox" data-field="blocksAttacks" ${values.blocksAttacks !== false ? "checked" : ""}/> Segura golpes</label>
      <label title="Para a Antimagia: Estrutura mágica dentro de um campo antimagia custa Mana extra por rodada a quem conjurou, ou se desfaz"><input type="checkbox" data-field="magic" ${values.magic ? "checked" : ""}/> Mágica</label>
      <label title="Campo antimagia: 0 = não é. Magia que atravessa, sai de dentro ou mira alguém dentro paga Mana extra (maior quanto maior o nível) ou é anulada">Antimagia (nível) <input type="number" min="0" data-field="antimagicLevel" value="${values.antimagicLevel ?? 0}"/></label>
      <label title="Fórmula rolada contra quem atravessa ou termina o movimento dentro (ex: 2d6). Vazio = nenhum">Dano ao contato <input type="text" data-field="contactDamage" value="${escapeHtml(values.contactDamage ?? "")}" placeholder="ex: 2d6"/></label>
    </div>
    <div class="card-config-row structure-elements-row">
      <span class="hint-inline" title="Golpes contra ela seguem 'Dano extra contra elemento' (Fogo +50% contra Gelo), e o dano ao contato é destes elementos">Elementos:</span>
      ${pickerFieldHtml(values.elements ?? [], "structure-elements")}
    </div>
    <div class="card-config-row">
      <input type="hidden" data-field="light" value="${escapeHtml(JSON.stringify(values.light ?? null))}"/>
      <span class="structure-light-summary"><i class="fas fa-lightbulb"></i> Luz: <span class="structure-light-text">${escapeHtml(describeLight(values.light))}</span></span>
      <button type="button" class="structure-light-edit">Configurar luz…</button>
    </div>`;
}

/** Botão "Configurar luz…": abre o editor (com pré-visualização no mapa) e guarda no campo oculto. */
function wireStructure(card) {
  wireElementPickerField(card.querySelector(".structure-elements"));
  const field = card.querySelector('[data-field="light"]');
  const text = card.querySelector(".structure-light-text");
  card.querySelector(".structure-light-edit")?.addEventListener("click", async event => {
    event.preventDefault();
    let current = null;
    try {
      current = JSON.parse(field.value || "null");
    } catch (err) {
      current = null;
    }
    const size = Number(card.querySelector('[data-field="size"]')?.value) || 3;
    const name = card.querySelector('[data-field="label"]')?.value || "Estrutura";
    const light = await openLightConfigDialog(current, {
      title: `Luz — ${name}`,
      autoHint: "Raio 0 = automático: cobre a forma (círculo/quadrado) ou brilha ao longo da parede",
      previewRadius: { dim: size + 1, bright: size / 2 }
    });
    if (!light) return;
    const stored = light.enabled ? light : null;
    field.value = JSON.stringify(stored);
    text.textContent = describeLight(stored);
  });
}

function readStructure(card) {
  const el = f => card.querySelector(`[data-field="${f}"]`);
  const id = el("id")?.value.trim();
  if (!id) return null;
  return {
    id,
    label: el("label").value.trim() || id,
    color: el("color").value || "#9aa1c2",
    shape: el("shape").value,
    size: Math.max(0.5, Number(el("size").value) || 1),
    hp: Math.max(0, Math.round(Number(el("hp").value) || 0)),
    durationRounds: Math.max(0, Math.round(Number(el("durationRounds").value) || 0)),
    blocksMove: el("blocksMove").checked,
    blocksSight: el("blocksSight").checked,
    img: el("img").value.trim(),
    blocksAttacks: el("blocksAttacks").checked,
    magic: el("magic").checked,
    antimagicLevel: Math.max(0, Math.round(Number(el("antimagicLevel").value) || 0)),
    contactDamage: el("contactDamage").value.trim(),
    elements: readPickerField(card.querySelector(".structure-elements")),
    light: (() => {
      try {
        return JSON.parse(el("light")?.value || "null");
      } catch (err) {
        return null;
      }
    })()
  };
}

export const StructuresConfigApp = createCardListConfigApp({
  id: "nihility-structures-config",
  title: "Configurar Estruturas",
  settingsKey: "structuresData",
  width: 680,
  addLabel: "+ Nova Estrutura",
  hint:
    "Estruturas viram <strong>Paredes de verdade</strong> no mapa (bloqueiam movimento e, se marcado, visão). " +
    "<strong>Vida 0</strong> = barreira de mana: o dano sai da Mana de quem conjurou. <strong>Duração 0</strong> = sem prazo: " +
    "com Skill Ativa, fica até desligar; senão, até o Mestre derrubar ou a Vida/Mana de quem conjurou chegar a 0. " +
    "<strong>Forma livre</strong>: quem usa a Skill desenha clicando ponto a ponto, até o tamanho máximo. " +
    "<strong>Elementos</strong>: golpes contra ela seguem o \"Dano extra contra elemento\" de quem ataca. " +
    "<strong>Antimagia</strong>: magia que cruza o campo paga Mana extra ou é anulada.",
  getActiveList: getStructures,
  renderCard: renderStructure,
  readCard: readStructure,
  wireCard: wireStructure
});
