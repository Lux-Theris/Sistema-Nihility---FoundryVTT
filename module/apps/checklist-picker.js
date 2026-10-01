/**
 * Janela de escolha por lista: filtro + checkboxes agrupados (Elementos de Dano, Traços…).
 *
 * Existe porque a grade de chips com o catálogo inteiro, aberta direto no formulário, crescia
 * junto com o catálogo — com 13+ elementos cada linha de Efeito virava um paredão. Agora o
 * formulário mostra só o que foi escolhido (chips com ×) e um botão "+ Elemento · N" abre esta
 * janela. É a prancheta 6 do redesenho da Ficha de Item.
 */
import { getActiveDamageElements, getActiveTraits } from "../core/config.js";

const { DialogV2 } = foundry.applications.api;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/**
 * Abre a janela e devolve os ids marcados, na ordem do catálogo — ou `null` se cancelou.
 * @param {object} options
 * @param {string} options.title
 * @param {{label: string, options: {id: string, label: string, color?: string}[]}[]} options.groups
 * @param {string[]} [options.selected]
 * @param {string} [options.manageHint] - onde fica o catálogo (rodapé)
 * @returns {Promise<string[]|null>}
 */
export async function pickFromChecklist({ title, groups, selected = [], manageHint = "" }) {
  const chosen = new Set(selected ?? []);
  const showLegends = groups.length > 1;
  const groupsHtml = groups
    .filter(group => group.options.length)
    .map(
      group => `
      <fieldset class="picker-group">
        ${showLegends ? `<legend>${escapeHtml(group.label)}</legend>` : ""}
        <div class="picker-options">
          ${group.options
            .map(
              opt => `
            <label class="picker-option" data-search="${escapeHtml(String(opt.label).toLowerCase())}">
              <input type="checkbox" value="${escapeHtml(opt.id)}" ${chosen.has(opt.id) ? "checked" : ""}/>
              ${opt.color ? `<span class="dot" style="background:${escapeHtml(opt.color)}"></span>` : ""}
              <span class="picker-option-label">${escapeHtml(opt.label)}</span>
            </label>`
            )
            .join("")}
        </div>
      </fieldset>`
    )
    .join("");

  // `<div>`, nunca `<form>`: o DialogV2 já embrulha o conteúdo num form, e um form dentro de outro
  // é descartado pelo navegador junto com a classe (e com todo o CSS que depende dela).
  const content = `
    <div class="nihility-picker">
      <input type="search" class="picker-filter" placeholder="Filtrar…" aria-label="Filtrar"/>
      <div class="picker-count"></div>
      <div class="picker-list">${groupsHtml || `<p class="hint">Nada no catálogo.</p>`}</div>
      ${manageHint ? `<p class="hint">${escapeHtml(manageHint)}</p>` : ""}
    </div>`;

  const result = await DialogV2.wait({
    window: { title },
    classes: ["nihility-picker-dialog"],
    position: { width: 440 },
    content,
    buttons: [
      {
        action: "apply",
        label: "Aplicar",
        default: true,
        callback: (event, button, dialog) =>
          Array.from(dialog.element.querySelectorAll(".picker-option input:checked")).map(input => input.value)
      },
      // `false`, não `null`: o DialogV2 troca um retorno nulo pelo nome da ação.
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      const filter = root?.querySelector?.(".picker-filter");
      if (!filter) return;
      const options = Array.from(root.querySelectorAll(".picker-option"));
      const count = root.querySelector(".picker-count");
      const refreshCount = () => {
        const n = options.filter(opt => opt.querySelector("input").checked).length;
        count.textContent = `${n} de ${options.length} escolhido(s)`;
      };
      filter.addEventListener("input", () => {
        const term = filter.value.trim().toLowerCase();
        for (const opt of options) opt.hidden = Boolean(term) && !opt.dataset.search.includes(term);
        for (const group of root.querySelectorAll(".picker-group")) {
          group.hidden = !Array.from(group.querySelectorAll(".picker-option")).some(opt => !opt.hidden);
        }
      });
      // Enter no filtro não pode confirmar a janela no meio da digitação.
      filter.addEventListener("keydown", ev => {
        if (ev.key === "Enter") ev.preventDefault();
      });
      root.querySelector(".picker-list")?.addEventListener("change", refreshCount);
      root.querySelector(".picker-list")?.addEventListener("wheel", ev => ev.stopPropagation());
      refreshCount();
      filter.focus();
    }
  });

  return Array.isArray(result) ? result : null;
}

/** Agrupa uma lista `{id, label, group?, color?}` na ordem em que os grupos aparecem. */
function groupByField(list, fallbackGroup) {
  const groups = new Map();
  for (const entry of list) {
    const key = entry.group || fallbackGroup;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: entry.id, label: entry.label || entry.id, color: entry.color });
  }
  return [...groups].map(([label, options]) => ({ label, options }));
}

/**
 * Um id escolhido que saiu do catálogo continua na janela (grupo próprio): senão, "Aplicar"
 * apagaria sem aviso um elemento que a Skill já usa.
 */
function withOrphans(groups, selected, known) {
  const orphans = (selected ?? []).filter(id => !known.has(id));
  if (!orphans.length) return groups;
  return [...groups, { label: "Fora do catálogo", options: orphans.map(id => ({ id, label: `${id} (removido)` })) }];
}

/** Elementos de Dano, agrupados por Grupo (Físico, Fantasia, Energia…). */
export function pickDamageElements(selected, { title = "Elementos de Dano" } = {}) {
  const catalog = getActiveDamageElements();
  const groups = withOrphans(groupByField(catalog, "Outros"), selected, new Set(catalog.map(el => el.id)));
  return pickFromChecklist({
    title,
    groups,
    selected,
    manageHint: "O catálogo fica em Configurações Gerais › Tipos de Dano."
  });
}

/** Traços (lista de características), com grupo opcional. */
export function pickTraits(selected, { title = "Traços" } = {}) {
  const catalog = getActiveTraits();
  const groups = withOrphans(groupByField(catalog, "Traços"), selected, new Set(catalog.map(t => t.id)));
  return pickFromChecklist({
    title,
    groups,
    selected,
    manageHint: "O catálogo fica em Configurações Gerais › Traços."
  });
}

/**
 * Chips dos elementos escolhidos, prontos pro partial `nihility.elementChips`: `{chips, total}`,
 * onde `total` é o tamanho do catálogo (o número no botão "+ Elemento · N").
 */
export function selectedElementChips(selected) {
  const catalog = getActiveDamageElements();
  const byId = new Map(catalog.map(el => [el.id, el]));
  return {
    total: catalog.length,
    chips: (selected ?? []).map(id => {
      const el = byId.get(id);
      return { id, label: el?.label ?? `${id} (removido)`, color: el?.color ?? "#6b7294" };
    })
  };
}

/** Chips dos Traços escolhidos (mesmo formato de `selectedElementChips`). */
export function selectedTraitChips(selected) {
  const catalog = getActiveTraits();
  const byId = new Map(catalog.map(t => [t.id, t]));
  return {
    total: catalog.length,
    chips: (selected ?? []).map(id => ({ id, label: byId.get(id)?.label ?? `${id} (removido)`, color: "" }))
  };
}

/*
 * Campo compacto em DOM puro, pros formulários que não são ficha de documento (modal de Skill,
 * editor de Espécies): a lista fica em `data-selected` (JSON) e quem salva lê com
 * `readPickerField`. Nas fichas o mesmo visual sai do partial `nihility.elementChips`.
 */

/** HTML do contêiner vazio; `wirePickerField` desenha os chips e o botão. */
export function pickerFieldHtml(selected, cls) {
  const json = JSON.stringify(selected ?? []).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<div class="element-field ${cls}" data-selected="${json}"></div>`;
}

export function readPickerField(container) {
  try {
    const list = JSON.parse(container?.dataset.selected || "[]");
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

/**
 * Liga o campo: × tira um item, o botão abre a janela de escolha.
 * @param {HTMLElement} container
 * @param {{pick: (ids: string[]) => Promise<string[]|null>, describe: (ids: string[]) => {chips: object[], total: number}, noun: string, onChange?: (ids: string[]) => void}} options
 */
export function wirePickerField(container, { pick, describe, noun, onChange = null }) {
  if (!container) return;
  const draw = () => {
    const { chips, total } = describe(readPickerField(container));
    const chipsHtml = chips.length
      ? chips
          .map(
            c =>
              `<span class="element-chip checked">${c.color ? `<span class="dot" style="background:${escapeHtml(c.color)}"></span>` : ""}${escapeHtml(c.label)}` +
              `<a class="element-chip-remove" data-id="${escapeHtml(c.id)}" title="Tirar ${escapeHtml(c.label)}" aria-label="Tirar ${escapeHtml(c.label)}"><i class="fas fa-times"></i></a></span>`
          )
          .join("")
      : `<span class="element-field-empty">nenhum</span>`;
    container.innerHTML = `${chipsHtml}<button type="button" class="element-field-add">+ ${escapeHtml(noun)} · ${total}</button>`;
  };
  container.addEventListener("click", async event => {
    const remove = event.target.closest(".element-chip-remove");
    if (remove) {
      event.preventDefault();
      container.dataset.selected = JSON.stringify(readPickerField(container).filter(id => id !== remove.dataset.id));
      draw();
      onChange?.(readPickerField(container));
      return;
    }
    if (event.target.closest(".element-field-add")) {
      event.preventDefault();
      const picked = await pick(readPickerField(container));
      if (picked) {
        container.dataset.selected = JSON.stringify(picked);
        draw();
        onChange?.(picked);
      }
    }
  });
  draw();
}

/** Atalhos: o campo de Elementos e o de Traços. */
export function wireElementPickerField(container, { onChange = null } = {}) {
  wirePickerField(container, { pick: ids => pickDamageElements(ids), describe: selectedElementChips, noun: "Elemento", onChange });
}

export function wireTraitPickerField(container, { onChange = null } = {}) {
  wirePickerField(container, { pick: ids => pickTraits(ids), describe: selectedTraitChips, noun: "Traço", onChange });
}
