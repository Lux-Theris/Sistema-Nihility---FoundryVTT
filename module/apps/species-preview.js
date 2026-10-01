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
export function speciesPreviewHtml(preview, { allowAnnounce = false } = {}) {
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
    ...diff.skills.keep.filter(s => s.from && s.from !== s.name).map(s => row("=", `<b>${esc(s.name)}</b> · Nv ${esc(s.level)}`, "fica"))
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
    ${section("Sai da ficha", lossRows, { loss: true, aside: "guardado no histórico" })}
    ${section("Vai para outro lugar", moveRows)}
    ${section("Muda e entra", changeRows)}
    ${section("Chega depois", lockedRows)}
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
export async function openSpeciesPreview(preview, { title = null } = {}) {
  const losses = preview.diff.losses.length;
  const allowAnnounce = game.user.isGM;
  const result = await DialogV2.wait({
    window: { title: title ?? `Trocar origem — ${preview.actor.name}` },
    classes: [SYSTEM_ID, "nihility-species-preview-dialog"],
    position: { width: 600 },
    content: speciesPreviewHtml(preview, { allowAnnounce }),
    buttons: [
      { action: "cancel", label: "Cancelar", callback: () => null },
      {
        action: "apply",
        label: losses ? `Aplicar (perde ${losses})` : "Aplicar",
        default: true,
        callback: (event, button, dialog) => ({ announce: Boolean(dialog.element.querySelector('[name="announce"]')?.checked), note: "" })
      }
    ],
    rejectClose: false
  });
  return result && typeof result === "object" ? result : null;
}
