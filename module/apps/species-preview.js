/**
 * Prévia de mudança de origem (board 3 do canvas "Rework de Espécies"): o que entra, muda, vai para
 * outro lugar, fica e sai — com as perdas primeiro, em vermelho. Nada é gravado aqui; quem grava é
 * applySpeciesPreview (species.js) depois do "Aplicar".
 */
import { SYSTEM_ID } from "../core/config.js";

const { DialogV2 } = foundry.applications.api;

const esc = value => foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function row(op, text, note = "") {
  const cls = { "+": "add", "−": "del", "~": "chg", "=": "keep", "↪": "mov" }[op] ?? "keep";
  return `<div class="sp-row"><span class="sp-op ${cls}">${op}</span><span class="sp-text">${text}</span><span class="sp-note">${esc(note)}</span></div>`;
}

function section(title, rows, { loss = false, aside = "" } = {}) {
  if (!rows.length) return "";
  return `<section class="sp-sec${loss ? " is-loss" : ""}"><h4>${esc(title)}${aside ? `<small>${esc(aside)}</small>` : ""}</h4>${rows.join("")}</section>`;
}

const originLabel = (preview, side) => {
  const { species, lineage } = preview[side];
  const entry = side === "target" ? preview.entry : preview.fromEntry;
  const name = entry?.label || species;
  const lin = lineage ? entry?.lineages?.find(l => l.id === lineage)?.label ?? lineage : "";
  return `${esc(name || "sem Espécie")}${lin ? ` · ${esc(lin)}` : ""}`;
};

/** Monta o HTML da prévia a partir do diff (species-rules.js#speciesDiff). */
export function speciesPreviewHtml(preview, { allowAnnounce = false, warnings = [], extraSections = [] } = {}) {
  const { diff } = preview;
  const lossRows = [
    ...diff.skills.remove.map(s => row("−", `Skill Racial <b>${esc(s.name)}</b> · Nv ${esc(s.level)}${s.xp ? ` · ${esc(s.xp)} XP` : ""}`, "volta se a origem voltar")),
    ...diff.parts.remove.map(p => row("−", `Parte <b>${esc(p.name)}</b> (${esc(p.hp?.value ?? 0)}/${esc(p.hp?.max ?? 0)})`, "sem par na nova origem"))
  ];
  const moveRows = [
    ...diff.parts.update
      .filter(p => p.how === "slot" && (p.isProsthetic || p.carries.length))
      .map(p => row("↪", `${p.isProsthetic ? "Prótese" : "Modificações"} de <b>${esc(p.from.name)}</b>${p.carries.length ? ` (${p.carries.map(esc).join(", ")})` : ""}`, `→ ${p.label}`)),
    ...diff.parts.detach.map(p => row("↪", `<b>${esc(p.name)}</b>${p.carries.length ? ` com ${p.carries.map(esc).join(", ")}` : ""}`, "fica como parte avulsa"))
  ];
  const changeRows = [
    ...diff.parts.update.map(p =>
      row("~", p.from.name !== p.label ? `<b>${esc(p.from.name)}</b> → <b>${esc(p.label)}</b>` : `<b>${esc(p.label)}</b>`, p.from.max !== p.hpMax ? `Vida ${p.from.max} → ${p.hpMax}` : "")
    ),
    ...diff.parts.create.map(p => row("+", `Parte <b>${esc(p.label)}</b>`, `Vida ${p.hpMax}`)),
    ...diff.skills.update.map(s => row("~", `Skill Racial <b>${esc(s.name)}</b> · Nv ${esc(s.level)}`, "mecânica atualizada")),
    ...diff.skills.create.map(s => row("+", `Skill Racial <b>${esc(s.name)}</b>`, s.restored ? `volta com Nv ${s.restored.level}` : "entra")),
    ...diff.skills.keep.filter(s => s.from && s.from !== s.name).map(s => row("=", `<b>${esc(s.name)}</b> · Nv ${esc(s.level)}`, "fica")),
    ...diff.skills.keep.filter(s => s.fromPrevious).map(s => row("=", `Skill Racial <b>${esc(s.name)}</b> · Nv ${esc(s.level)}`, "fica (da Espécie anterior)"))
  ];
  const keptSkills = diff.skills.keep.length;
  const keptParts = diff.parts.keep.filter(p => !p.outside).length;
  const outside = diff.parts.keep.filter(p => p.outside);
  const lockedRows = (diff.locked ?? []).map(s => row("=", `Skill Racial <b>${esc(s.name)}</b>`, `chega no Nv ${s.unlockLevel}`));

  const summary = [
    keptSkills ? `${keptSkills} Skill(s) Racial(is) ficam como estão` : "",
    keptParts ? `${keptParts} parte(s) sem mudança` : "",
    outside.length ? `${outside.length} parte(s) fora da Espécie continuam na ficha` : ""
  ].filter(Boolean);

  return `<div class="nihility-species-preview">
    <div class="sp-route"><span class="sp-chip">${originLabel(preview, "from")}</span><span class="sp-arrow">→</span><span class="sp-chip is-to">${originLabel(preview, "target")}</span></div>
    ${warnings.length ? `<div class="sp-warn">${warnings.map(w => `<div>⚠ ${esc(w)}</div>`).join("")}<div class="sp-dim">Fora das regras não é proibido: o Mestre decide.</div></div>` : ""}
    ${section("Sai da ficha", lossRows, { loss: true, aside: "guardado no histórico" })}
    ${section("Vai para outro lugar", moveRows)}
    ${section("Muda e entra", changeRows)}
    ${section("Chega depois", lockedRows)}
    ${extraSections.map(x => section(x.title, x.rows.map(r => row(r.op, esc(r.text), r.note)))).join("")}
    ${summary.length ? `<p class="sp-dim">${summary.map(esc).join(" · ")}.</p>` : ""}
    ${diff.empty ? `<p class="sp-dim">Nada muda nas Partes do Corpo nem nas Skills Raciais.</p>` : ""}
    <p class="sp-dim">Itens, Títulos, Skills compradas e partes criadas à mão nunca entram nesta conta.</p>
    ${allowAnnounce ? `<label class="sp-announce"><input type="checkbox" name="announce" checked/> Anunciar pela Voz do Mundo</label>` : ""}
  </div>`;
}

/**
 * Abre a prévia e espera a decisão.
 * @returns {Promise<{announce:boolean, note:string}|null>} null = cancelado
 */
export async function openSpeciesPreview(preview, { title = null, warnings = [], extraSections = [], confirmLabel = null } = {}) {
  const losses = preview.diff.losses.length;
  const allowAnnounce = game.user.isGM;
  const result = await DialogV2.wait({
    window: { title: title ?? `Trocar origem — ${preview.actor.name}` },
    classes: [SYSTEM_ID, "nihility-species-preview-dialog"],
    position: { width: 600 },
    content: speciesPreviewHtml(preview, { allowAnnounce, warnings, extraSections }),
    buttons: [
      { action: "cancel", label: "Cancelar", callback: () => null },
      {
        action: "apply",
        label: warnings.length ? `${confirmLabel ?? "Aplicar"} mesmo assim` : losses ? `${confirmLabel ?? "Aplicar"} (perde ${losses})` : confirmLabel ?? "Aplicar",
        default: true,
        callback: (event, button, dialog) => ({ announce: Boolean(dialog.element.querySelector('[name="announce"]')?.checked), note: "" })
      }
    ],
    rejectClose: false
  });
  return result && typeof result === "object" ? result : null;
}

/** Resumo curto de um diff de sincronização ("+ Chifres · Sopro ~ · Asas sai"). */
function shortDiff(diff) {
  const bits = [
    ...diff.parts.create.map(p => `+ ${p.label}`),
    ...diff.parts.update.map(p => `${p.label} ~`),
    ...diff.parts.remove.map(p => `${p.name} sai`),
    ...diff.parts.detach.map(p => `${p.name} avulsa`),
    ...diff.skills.create.map(s => `+ ${s.name}`),
    ...diff.skills.update.map(s => `${s.name} ~`),
    ...diff.skills.remove.map(s => `${s.name} sai`)
  ];
  return bits.slice(0, 6).join(" · ") + (bits.length > 6 ? ` · +${bits.length - 6}` : "");
}

/** Conteúdo da prévia D (sincronizar várias fichas com a Espécie editada). */
export function syncDialogHtml(entry, candidates) {
  const rows = candidates
    .map(({ actor, preview }) => {
      const token = actor.isToken ? " · Token não vinculado" : "";
      const checked = actor.isToken ? "" : "checked";
      return `<label class="sp-row sp-sync-row"><input type="checkbox" name="sync-actor" value="${esc(actor.uuid)}" ${checked}/><span class="sp-text"><b>${esc(actor.name)}</b>${esc(token)} · ${esc(shortDiff(preview.diff))}</span><span class="sp-note"></span></label>`;
    })
    .join("");
  return `<div class="nihility-species-preview">
    <p class="sp-dim">${esc(entry?.label ?? "")} mudou no catálogo. Marque as fichas que devem acompanhar.</p>
    <section class="sp-sec"><h4>${candidates.length} ficha(s) desatualizada(s)</h4>${rows}</section>
    <section class="sp-sec"><h4>O que saiu da Espécie</h4>
      <div class="sp-row"><span></span><span class="sp-text">
        <label><input type="radio" name="sync-remove" value="keep" checked/> Manter nas fichas</label>
        &nbsp; <label><input type="radio" name="sync-remove" value="remove"/> Remover (o que tiver prótese ou modificação fica como parte avulsa)</label>
      </span><span></span></div>
    </section>
    <p class="sp-dim">Sincronizar só acrescenta e ajusta por padrão. Nível e XP das Skills Raciais ficam.</p>
  </div>`;
}

/**
 * Mestre escolhe Espécie (e Linhagem) para a ficha. `lineageOnly` trava a Espécie atual.
 * @returns {Promise<{species:string, lineage:string}|null>}
 */
export async function pickSpeciesDialog(current = {}, { lineageOnly = false } = {}) {
  const { getActiveSpeciesPresets } = await import("../core/config.js");
  const { normalizeSpeciesCatalog } = await import("../species/species-rules.js");
  const catalog = normalizeSpeciesCatalog(getActiveSpeciesPresets());
  const speciesOptions = Object.entries(catalog)
    .filter(([id]) => !lineageOnly || id === current.species)
    .sort(([, a], [, b]) => (a.label || "").localeCompare(b.label || ""))
    .map(([id, e]) => `<option value="${esc(id)}" ${id === current.species ? "selected" : ""}>${esc(e.label || id)}</option>`)
    .join("");
  const lineageOptions = Object.entries(catalog)
    .flatMap(([id, e]) => (e.lineages ?? []).map(l => `<option value="${esc(l.id)}" data-species="${esc(id)}" ${id === current.species && l.id === current.lineage ? "selected" : ""}>${esc(l.label || l.id)}</option>`))
    .join("");
  const filter = root => {
    const species = root.querySelector('[name="species"]')?.value;
    const select = root.querySelector('[name="lineage"]');
    if (!select) return;
    let visible = 0;
    for (const option of select.options) {
      if (!option.dataset.species) continue;
      const show = option.dataset.species === species;
      option.hidden = !show;
      if (show) visible += 1;
      else if (option.selected) select.value = "";
    }
    select.closest(".sp-lineage")?.classList.toggle("hidden", !visible);
  };
  const result = await DialogV2.wait({
    window: { title: lineageOnly ? "Trocar Linhagem" : "Trocar Espécie" },
    classes: [SYSTEM_ID, "nihility-species-preview-dialog"],
    content: `<div class="nihility-species-preview">
      <label class="sp-field"><span>Espécie</span><select name="species" ${lineageOnly ? "disabled" : ""}>${speciesOptions}</select></label>
      <label class="sp-field sp-lineage"><span>Linhagem</span><select name="lineage"><option value="">— nenhuma —</option>${lineageOptions}</select></label>
      <p class="sp-dim">Depois de escolher, a prévia mostra o que entra, muda e sai antes de gravar.</p>
    </div>`,
    render: (event, dialog) => {
      const root = dialog?.element ?? event?.target?.element;
      if (!root) return;
      filter(root);
      root.querySelector('[name="species"]')?.addEventListener("change", () => filter(root));
    },
    buttons: [
      { action: "cancel", label: "Cancelar", callback: () => null },
      {
        action: "ok",
        label: "Ver prévia",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element;
          const species = root.querySelector('[name="species"]').value;
          const option = root.querySelector('[name="lineage"]').selectedOptions[0];
          const lineage = option && option.dataset.species === species ? option.value : "";
          return { species, lineage };
        }
      }
    ],
    rejectClose: false
  });
  return result && typeof result === "object" ? result : null;
}


/**
 * Mestre escolhe uma Herança para dar (as que a ficha ainda não tem) e de onde ela veio.
 * @returns {Promise<{id:string, source:string}|null>}
 */
export async function pickHeritageDialog(actor) {
  const { getActiveHeritages, MEU_SISTEMA } = await import("../core/config.js");
  const owned = new Set((actor.system.heritages ?? []).map(h => h.id));
  const groups = {};
  for (const h of getActiveHeritages()) {
    if (owned.has(h.id)) continue;
    (groups[h.group || ""] ??= []).push(h);
  }
  const options = Object.entries(groups)
    .map(([g, list]) => `<optgroup label="${esc(MEU_SISTEMA.SPECIES_GROUP_LABELS[g] ?? "Outras")}">${list.map(h => `<option value="${esc(h.id)}">${esc(h.label || h.id)}</option>`).join("")}</optgroup>`)
    .join("");
  if (!options) {
    ui.notifications.info("Não há Heranças no catálogo que esta ficha ainda não tenha.");
    return null;
  }
  const result = await DialogV2.wait({
    window: { title: `Ganhar Herança — ${actor.name}` },
    classes: [SYSTEM_ID, "nihility-species-preview-dialog"],
    content: `<div class="nihility-species-preview">
      <label class="sp-field"><span>Herança</span><select name="heritage">${options}</select></label>
      <label class="sp-field"><span>De onde veio (aparece no histórico)</span><input type="text" name="source" placeholder="Ex.: mordido por Valeska na sessão 9"/></label>
      <p class="sp-dim">Depois de escolher, a prévia mostra o que muda e avisa se a Herança não combina com a Espécie ou com outra Herança.</p>
    </div>`,
    buttons: [
      { action: "cancel", label: "Cancelar", callback: () => null },
      { action: "ok", label: "Ver prévia", default: true, callback: (event, button, dialog) => ({ id: dialog.element.querySelector('[name="heritage"]').value, source: dialog.element.querySelector('[name="source"]').value.trim() }) }
    ],
    rejectClose: false
  });
  return result && typeof result === "object" && result.id ? result : null;
}


/**
 * Destinos de evolução como cartões (board 3 B): nível mínimo em verde (cumprido) ou amarelo
 * (falta — só aviso) e a dica do editor.
 * @returns {Promise<object|null>} a opção escolhida (ver evolutionOptions)
 */
export async function pickEvolutionDialog(actor, entry, options) {
  const cards = options
    .map((o, i) => {
      const level = o.minLevel ? (o.ready ? `<span class="sp-ok">Nv ${o.minLevel} · ${esc(actor.name)} é Nv ${esc(actor.system.attributes?.level ?? 1)} ✓</span>` : `<span class="sp-late">Nv ${o.minLevel} · faltam ${o.missing} (só aviso)</span>`) : `<span class="sp-dim">sem nível mínimo</span>`;
      return `<label class="sp-evo"><input type="radio" name="evo" value="${i}" ${i === 0 ? "checked" : ""}/><span class="sp-evo-body"><b>${esc(o.label)}</b>${level}${o.hint ? `<span class="sp-dim">"${esc(o.hint)}"</span>` : ""}</span></label>`;
    })
    .join("");
  const result = await DialogV2.wait({
    window: { title: `Evoluir — ${actor.name}` },
    classes: [SYSTEM_ID, "nihility-species-preview-dialog"],
    position: { width: 560 },
    content: `<div class="nihility-species-preview"><p class="sp-dim">${esc(entry?.label ?? "")} pode evoluir para:</p><div class="sp-evo-grid">${cards}</div><p class="sp-dim">Depois de escolher, a prévia mostra o que muda.</p></div>`,
    buttons: [
      { action: "cancel", label: "Cancelar", callback: () => null },
      { action: "ok", label: "Ver prévia", default: true, callback: (event, button, dialog) => Number(dialog.element.querySelector('[name="evo"]:checked')?.value) }
    ],
    rejectClose: false
  });
  return Number.isInteger(result) ? options[result] ?? null : null;
}
