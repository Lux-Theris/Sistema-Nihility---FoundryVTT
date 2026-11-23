import { NIHILITY, getStructures } from "../core/config.js";
import { pickerFieldHtml, readPickerField, wireElementPickerField } from "./checklist-picker.js";
import { createCardListConfigApp, escapeHtml, optionsHtml } from "./card-list-config-factory.js";
import { openLightConfigDialog, describeLight } from "../combat/lights.js";

/**
 * Editor do catálogo de Estruturas (Parede de Pedra, Bloco de Gelo, Barreira de Mana…) que as
 * Skills com Mecânica "Estrutura" erguem no mapa. Regras em structures.js; luz em lights.js.
 */

function renderStructure(values) {
  const shapes = NIHILITY.STRUCTURE_SHAPES.map(s => [s, NIHILITY.STRUCTURE_SHAPE_LABELS[s]]);
  return `
    <div class="card-config-row card-config-row-main">
      <input type="text" data-field="id" value="${escapeHtml(values.id)}" placeholder="id (ex: stone-wall)"/>
      <input type="text" data-field="label" value="${escapeHtml(values.label)}" placeholder="Nome (ex: Parede de Pedra)"/>
      <input type="color" data-field="color" value="${escapeHtml(values.color ?? "#9aa1c2")}"/>
    </div>
    <div class="card-config-row">
      <label>Forma <select data-field="shape">${optionsHtml(shapes, values.shape ?? "line")}</select></label>
      <label title="Linha e forma livre: comprimento máximo. Círculo: raio. Quadrado: lado.">Tamanho (m) <input type="number" step="0.5" min="0.5" data-field="size" value="${values.size ?? 5}"/></label>
      <label title="Vida da Estrutura (ignorada se a Vida for a Mana de quem ergueu)">Vida <input type="number" min="0" data-field="hp" value="${values.hp ?? 30}"/></label>
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
      <label title="Para o PEM: Estrutura tecnológica dentro de um campo de interferência custa energia extra por rodada a quem conjurou, ou se desfaz. Mágica e Tecnológica juntas = tecnomágica"><input type="checkbox" data-field="tech" ${values.tech ? "checked" : ""}/> Tecnológica</label>
      <label title="Campo de interferência (o PEM): 0 = não é. Uso tecnológico que atravessa, sai de dentro ou mira alguém dentro paga energia extra (maior quanto maior o nível) ou é anulado; arma tecnológica não dispara através. Não afeta o mágico">Interferência (nível) <input type="number" min="0" data-field="interferenceLevel" value="${values.interferenceLevel ?? 0}"/></label>
      <label title="Campo antimagia: 0 = não é. Magia que atravessa, sai de dentro ou mira alguém dentro paga Mana extra (maior quanto maior o nível) ou é anulada">Antimagia (nível) <input type="number" min="0" data-field="antimagicLevel" value="${values.antimagicLevel ?? 0}"/></label>
      <label title="Fórmula rolada contra quem atravessa ou termina o movimento dentro (ex: 2d6). Vazio = nenhum">Dano ao contato <input type="text" data-field="contactDamage" value="${escapeHtml(values.contactDamage ?? "")}" placeholder="ex: 2d6"/></label>
    </div>
    <div class="card-config-row">
      <label title="Física (pedra, gelo, ferro): segura o golpe, inclusive Dano Absoluto. Etérea (mana, fogo, água): o Dano Absoluto a desfaz e passa inteiro">Material <select data-field="material">${optionsHtml([["physical", "Física"], ["ethereal", "Etérea"]], values.material ?? "physical")}</select></label>
      <label title="Marcado: o dano que ela leva sai da Mana de quem ergueu, e ela cai quando essa Mana chega a 0 (Barreira de Mana). Desmarcado: usa a Vida acima"><input type="checkbox" data-field="manaPowered" ${values.manaPowered ? "checked" : ""}/> A Vida é a Mana de quem ergueu</label>
    </div>
    <div class="card-config-row">
      <label title="Dano que ela leva de golpes que vêm de FORA da forma fechada, em % (100 = normal, 25 = só um quarto)">Dano de fora (%) <input type="number" min="0" data-field="outsideDamagePercent" value="${values.outsideDamagePercent ?? 100}"/></label>
      <label title="Dano que ela leva de golpes de quem está DENTRO da forma fechada (círculo/quadrado), em % (200 = o dobro)">Dano de dentro (%) <input type="number" min="0" data-field="insideDamagePercent" value="${values.insideDamagePercent ?? 100}"/></label>
      <label title="Quando a Skill Ativa que a sustenta desliga, ela some junto, mesmo sendo física (em vez de ficar de pé com Vida 1)"><input type="checkbox" data-field="vanishWithSkill" ${values.vanishWithSkill ? "checked" : ""}/> Some com a Skill</label>
      <label title="Se for destruída, a Skill Ativa que a sustentava desliga (e o debuff 'só desligada' volta)"><input type="checkbox" data-field="endsSkillOnDestroy" ${values.endsSkillOnDestroy ? "checked" : ""}/> Destruída, desliga a Skill</label>
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
    tech: el("tech").checked,
    interferenceLevel: Math.max(0, Math.round(Number(el("interferenceLevel").value) || 0)),
    material: el("material").value === "ethereal" ? "ethereal" : "physical",
    manaPowered: el("manaPowered").checked,
    antimagicLevel: Math.max(0, Math.round(Number(el("antimagicLevel").value) || 0)),
    contactDamage: el("contactDamage").value.trim(),
    outsideDamagePercent: Math.max(0, Math.round(Number(el("outsideDamagePercent").value))) || (el("outsideDamagePercent").value === "0" ? 0 : 100),
    insideDamagePercent: Math.max(0, Math.round(Number(el("insideDamagePercent").value))) || (el("insideDamagePercent").value === "0" ? 0 : 100),
    vanishWithSkill: el("vanishWithSkill").checked,
    endsSkillOnDestroy: el("endsSkillOnDestroy").checked,
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
    "<strong>A Vida é a Mana</strong> = barreira de mana: o dano sai da Mana de quem conjurou. <strong>Material</strong>: o Dano Absoluto desfaz a etérea. <strong>Duração 0</strong> = sem prazo: " +
    "com Skill Ativa, fica até desligar; senão, até o Mestre derrubar ou a Vida/Mana de quem conjurou chegar a 0. " +
    "<strong>Forma livre</strong>: quem usa a Skill desenha clicando ponto a ponto, até o tamanho máximo. " +
    "<strong>Elementos</strong>: golpes contra ela seguem o \"Dano extra contra elemento\" de quem ataca. " +
    "<strong>Antimagia</strong>: magia que cruza o campo paga Mana extra ou é anulada. " +
    "<strong>Interferência</strong>: o mesmo para a tecnologia (o PEM).",
  getActiveList: getStructures,
  renderCard: renderStructure,
  readCard: readStructure,
  wireCard: wireStructure
});
