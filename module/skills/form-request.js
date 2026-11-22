import { SYSTEM_ID, getVisibleAttributes, getVitalFormula, getSpeciesForCreation, isFormsEnabled, getEnergyLabelForActor } from "../core/config.js";
import { escapeHtml } from "../helpers/html.js";
import { reportError } from "../helpers/report.js";
import { canUploadImages, uploadDocumentImage, uploadButtonHtml, wireUploadButton, wireGalleryButton } from "../helpers/image-upload.js";
import { normalizeFormRequest, formVitalMax } from "./form-rules.js";
import { originLayers } from "../species/species-rules.js";
import { attributePurpose } from "../creation/creation-rules.js";
import { announceVoiceOfTheWorld } from "../core/voice-of-the-world.js";
import { isOpenRequest } from "../creation/creation-rules.js";
import { skillStateUpdate } from "./skill-state.js";
import { getInitiativeAttribute } from "../combat/combat.js";

/**
 * Pedido de forma (H5): o jogador monta uma ficha de forma (nome, Espécie, imagem e atributos — com o
 * mesmo total de pontos do personagem) e manda ao Mestre como um card, no modelo do pedido de Skill:
 * Aprovar / Ajustar e aprovar… / Pedir mudança… / Rejeitar; o autor edita enquanto está aberto.
 */

const STATUS_TEXT = {
  approved: "Aprovado: a ficha da forma foi criada.",
  rejected: "Rejeitado.",
  changes: "Devolvido para ajuste.",
  pending: "Aguardando o Mestre."
};

/** O que o pedido de forma pode gastar: o total de pontos do personagem. */
function pointsTotal(actor) {
  return Math.max(0, Number(actor?.system?.attributePointsPool?.total) || 0);
}

function attributeKeys() {
  return getVisibleAttributes().map(a => a.key);
}

/** Atores do pedido: pelo uuid (Token não vinculado), com o id como reserva. */
function requestActor(req) {
  return (req?.actorUuid ? fromUuidSync(req.actorUuid) : null) ?? game.actors.get(req?.actorId) ?? null;
}

/* ------------------------------------------------------------------ Editor */

/**
 * Editor do pedido (jogador, ou o Mestre ajustando). Devolve `{name, speciesId, img, points}` ou null.
 * @param {Actor} actor - o personagem que pede (de onde vêm o total de pontos e o envio da imagem)
 * @param {object|null} current - o pedido a editar
 * @param {{title?: string, saveLabel?: string}} [options]
 */
export async function openFormRequestEditor(actor, current = null, { title = "Pedir forma", saveLabel = "Enviar ao Mestre" } = {}) {
  const total = pointsTotal(actor);
  const { getSpeciesEntry } = await import("../species/species.js");
  const attrs = getVisibleAttributes();
  const formula = getVitalFormula();
  const species = getSpeciesForCreation();
  const energyLabel = getEnergyLabelForActor(actor);
  const initiative = getInitiativeAttribute();
  const speciesOptions = species
    .map(({ key, label }) => `<option value="${escapeHtml(key)}" ${key === current?.speciesId ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const rows = attrs
    .map(a => {
      const purpose = attributePurpose(a.key, { hpKeys: formula.hp, energyKeys: formula.energy, energyLabel, initiativeKey: initiative, movement: false });
      return `<div class="form-group"><label>${escapeHtml(a.label)}${purpose ? ` <span class="hint">${escapeHtml(purpose)}</span>` : ""}</label>` +
        `<input type="number" min="0" step="1" name="pt-${escapeHtml(a.key)}" data-key="${escapeHtml(a.key)}" value="${Number(current?.points?.[a.key]) || 0}"></div>`;
    })
    .join("");
  const content = `<div class="nihility-creation-dialog nihility-form-request">
    <div class="form-group"><label>Nome da forma</label><input type="text" name="name" maxlength="80" value="${escapeHtml(current?.name ?? "")}"></div>
    <div class="form-group"><label>Espécie</label><select name="speciesId"><option value="">—</option>${speciesOptions}</select></div>
    <div class="form-group"><label>Imagem</label><input type="text" name="img" value="${escapeHtml(current?.img ?? "")}" placeholder="caminho da imagem (opcional)"> ${uploadButtonHtml("img")}</div>
    <p class="hint" data-role="uploadHint">${canUploadImages() ? "Envie uma imagem do seu computador; o Mestre pode trocar depois." : "Peça ao Mestre a permissão 'Enviar arquivos' para enviar uma imagem."}</p>
    <p data-role="sum"></p>
    ${rows}
    <p class="hint" data-role="preview"></p>
  </div>`;

  const renderState = dialog => {
    const root = dialog.element;
    const read = () => {
      const points = {};
      let sum = 0;
      for (const input of root.querySelectorAll("input[data-key]")) {
        const value = Math.max(0, Math.floor(Number(input.value) || 0));
        points[input.dataset.key] = value;
        sum += value;
      }
      return { points, sum };
    };
    const update = () => {
      const { points, sum } = read();
      const left = total - sum;
      const sumEl = root.querySelector('[data-role="sum"]');
      if (sumEl) {
        sumEl.textContent = `Pontos: ${sum} / ${total}${left < 0 ? ` — passou ${-left}` : left > 0 ? ` — faltam ${left}` : ""}`;
        sumEl.style.color = left < 0 ? "#b00020" : "";
      }
      // Mesma conta da criação do molde: com os bônus da Espécie escolhida (C7, sessão 4).
      const speciesId = root.querySelector('[name="speciesId"]')?.value ?? "";
      const layers = speciesId ? originLayers({ species: getSpeciesEntry(speciesId) }) : [];
      const hpMax = formVitalMax({ points, layers, formula });
      const previewEl = root.querySelector('[data-role="preview"]');
      if (previewEl) {
        previewEl.textContent = `Vida da forma: ${hpMax}${speciesId ? "" : " (sem os bônus da Espécie: escolha uma)"}` + (formula.energyEnabled ? ` · ${energyLabel} (a do personagem vale)` : "");
      }
    };
    root.querySelectorAll("input[data-key]").forEach(input => input.addEventListener("input", update));
    root.querySelector('[name="speciesId"]')?.addEventListener("change", update);
    wireUploadButton(root, "img", async file => {
      const path = await uploadDocumentImage(actor, file);
      if (path) root.querySelector('[name="img"]').value = path;
    });
    wireGalleryButton(root, "img", path => { root.querySelector('[name="img"]').value = path; });
    update();
  };

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content,
    render: (event, dialog) => renderState(dialog),
    buttons: [
      {
        action: "save",
        label: saveLabel,
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog.element;
          const points = {};
          for (const input of root.querySelectorAll("input[data-key]")) points[input.dataset.key] = Math.max(0, Math.floor(Number(input.value) || 0));
          // Validar ANTES de fechar (C7, sessão 4): sem Espécie/nome a janela fechava e o pedido se perdia com um aviso só no console.
          const problem = !root.querySelector('[name="name"]').value.trim() ? "Dê um nome à forma."
            : !root.querySelector('[name="speciesId"]').value ? "Escolha a Espécie da forma."
            : Object.values(points).reduce((s, v) => s + v, 0) > total ? "Os pontos passam do total do personagem." : "";
          if (problem) {
            ui.notifications?.warn(problem);
            throw new Error(problem); // o DialogV2 não fecha quando o callback lança
          }
          return {
            name: root.querySelector('[name="name"]').value,
            speciesId: root.querySelector('[name="speciesId"]').value,
            img: root.querySelector('[name="img"]').value.trim(),
            points
          };
        }
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  return result && typeof result === "object" ? result : null;
}

/** Valida o que o editor devolveu contra os limites do personagem; avisa e devolve null se não serve. */
function validated(actor, data) {
  const limits = { total: pointsTotal(actor), attributeKeys: attributeKeys(), speciesIds: getSpeciesForCreation().map(s => s.key) };
  const clean = normalizeFormRequest(data, limits);
  if (!clean) {
    ui.notifications?.warn("Pedido inválido: dê um nome, escolha uma Espécie e não passe do total de pontos do personagem.");
    return null;
  }
  if (!clean.speciesId) {
    ui.notifications?.warn("Escolha a Espécie da forma.");
    return null;
  }
  return clean;
}

/* ------------------------------------------------------------------ Card */

function cardContent(actor, req) {
  const owner = actor ? game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) : null;
  const speciesLabel = getSpeciesForCreation().find(s => s.key === req.speciesId)?.label ?? req.speciesId;
  const attrs = getVisibleAttributes()
    .filter(a => Number(req.points?.[a.key]) > 0)
    .map(a => `${escapeHtml(a.label)} ${Number(req.points[a.key])}`)
    .join(" · ");
  const open = isOpenRequest(req.status);
  return `<div class="nihility-skill-request status-${escapeHtml(req.status)}">
  <header class="votw-header"><i class="fas fa-paw"></i><span class="votw-label">Pedido de Forma · ${escapeHtml(actor?.name ?? "?")}${owner ? ` (${escapeHtml(owner.name)})` : ""}</span></header>
  <h4 class="sr-name">${escapeHtml(req.name)} <span class="sr-tier">${escapeHtml(speciesLabel)}</span></h4>
  ${req.img ? `<p class="sr-sentence"><img src="${escapeHtml(req.img)}" alt="" style="max-height:64px"></p>` : ""}
  <p class="sr-sentence">${attrs || "Sem pontos distribuídos"} · ${Number(req.spent) || 0}/${pointsTotal(actor)} pontos</p>
  ${req.gmNote ? `<p class="sr-note"><i class="fas fa-comment"></i> Mestre: "${escapeHtml(req.gmNote)}"</p>` : ""}
  ${open ? `<div class="sr-actions sr-gm-actions">
    <button type="button" class="skill-request-approve" data-fr="approve"><i class="fas fa-check"></i> Aprovar</button>
    <button type="button" data-fr="adjust"><i class="fas fa-pen"></i> Ajustar e aprovar…</button>
    <button type="button" data-fr="changes"><i class="fas fa-comment"></i> Pedir mudança…</button>
    <button type="button" class="skill-request-reject" data-fr="reject"><i class="fas fa-times"></i> Rejeitar</button>
  </div>
  <div class="sr-actions sr-owner-actions"><button type="button" data-fr="edit"><i class="fas fa-pen"></i> Editar pedido</button></div>
  <p class="sr-hint">${escapeHtml(STATUS_TEXT[req.status] ?? "")} A ficha da forma só nasce se o Mestre aprovar.</p>`
    : `<p class="sr-status">${escapeHtml(STATUS_TEXT[req.status] ?? "")}</p>`}
</div>`;
}

async function updateRequestMessage(message, status, patch = {}) {
  const req = { ...message.flags[SYSTEM_ID].formRequest, ...patch, status };
  await message.update({ content: cardContent(requestActor(req), req), [`flags.${SYSTEM_ID}.formRequest`]: req });
}

/** Jogador: abre o editor e manda o pedido ao Mestre. */
export async function requestForm(actor, skill, subSkillIndex = null) {
  if (!isFormsEnabled()) return ui.notifications?.warn("O bloco Formas está desligado nesta mesa.");
  if (!actor || actor.type !== "character") return;
  const data = await openFormRequestEditor(actor, null);
  if (!data) return;
  const clean = validated(actor, data);
  if (!clean) return;
  const req = { actorId: actor.id, actorUuid: actor.uuid, skillId: skill?.id ?? "", subSkillIndex, ...clean, status: "pending", gmNote: "" };
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
  await ChatMessage.create({
    content: cardContent(actor, req),
    whisper: Array.from(new Set([...gmIds, ...ownerIds])),
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SYSTEM_ID]: { formRequest: req } }
  });
  ui.notifications?.info("Pedido de forma enviado ao Mestre.");
}

/* ------------------------------------------------------------------ Mestre */

export async function ensureFolder(name) {
  let folder = game.folders.find(f => f.type === "Actor" && f.name === name);
  if (!folder) folder = await Folder.create({ name, type: "Actor" });
  return folder?.id ?? null;
}

/** Cria a ficha-molde do pedido (Mestre dono, jogador Observador) e devolve o Ator. */
async function createTemplateActor(actor, req) {
  const ownership = { default: 0 };
  for (const u of game.users) if (!u.isGM && actor.testUserPermission(u, "OWNER")) ownership[u.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const combat = Object.fromEntries(attributeKeys().map(key => [key, { points: Math.max(0, Math.floor(Number(req.points?.[key]) || 0)) }]));
  const created = await Actor.create({
    name: req.name,
    type: "character",
    img: req.img || undefined,
    folder: await ensureFolder("Formas"),
    ownership,
    system: { isPlayerCharacter: false, formTemplate: true, attributes: { combat } }
  });
  if (!created) return null;
  const { changeActorSpecies } = await import("../species/species.js");
  await changeActorSpecies(created, req.speciesId, { interactive: false });
  const update = { "system.attributes.hp.value": created.system.attributes.hp.max, "prototypeToken.actorLink": false };
  if (req.img) update["prototypeToken.texture.src"] = req.img;
  await created.update(update);
  return created;
}

/** Liga a ficha ao Skill: preenche o campo vazio ou acrescenta uma Sub-Skill "Forma: X". */
async function linkTemplateToSkill(actor, req, template) {
  const skill = actor.items.get(req.skillId);
  if (!skill) return false;
  const idx = req.subSkillIndex ?? null;
  const mech = idx == null ? skill.system : skill.system.subSkills?.[idx];
  if (mech && mech.effectType === "form" && !mech.formActorUuid) {
    await skill.update(skillStateUpdate(skill, idx, { formActorUuid: template.uuid }));
    return true;
  }
  const subs = foundry.utils.deepClone(skill._source.system.subSkills ?? []);
  // Uma Skill de Forma sem Sub-Skills que já tem molde vira "umbrella": o molde atual passa a ser a 1ª Sub-Skill.
  if (!subs.length && skill.system.effectType === "form" && skill.system.formActorUuid) {
    subs.push(subFor(skill.system, `Forma: ${fromUuidSync(skill.system.formActorUuid)?.name ?? skill.name}`, skill.system.formActorUuid));
  }
  subs.push(subFor(mech ?? skill.system, `Forma: ${template.name}`, template.uuid));
  await skill.update({ "system.subSkills": subs });
  return true;
}

/**
 * Liga uma ficha-molde já criada a uma Skill de Forma de `actor` (campo vazio ou uma Sub-Skill "Forma: X"),
 * pela mesma lógica do pedido de forma aprovado. Usada também pela Predação (7b).
 * @param {Actor} actor - quem tem a Skill de Forma
 * @param {string} skillId
 * @param {Actor} template - a ficha-molde
 * @param {number|null} [subSkillIndex]
 */
export async function attachFormTemplate(actor, skillId, template, subSkillIndex = null) {
  return linkTemplateToSkill(actor, { skillId, subSkillIndex }, template);
}

function subFor(base, name, uuid) {
  return {
    name,
    tier: base.tier ?? "normal",
    effectType: "form",
    formActorUuid: uuid,
    hasUpkeep: true,
    upkeepCost: Number(base.upkeepCost) || 0,
    cost: Number(base.cost) || 0,
    targetType: "self",
    active: false
  };
}

async function approve(message, { override = null } = {}) {
  if (!game.user.isGM) return ui.notifications?.warn("Só o Mestre pode aprovar pedidos de forma.");
  const req = message.flags?.[SYSTEM_ID]?.formRequest;
  if (!req || !isOpenRequest(req.status)) return;
  const actor = requestActor(req);
  if (!actor) return ui.notifications?.warn("O personagem do pedido não existe mais.");
  const finalReq = override ? { ...req, ...override } : req;
  const clean = validated(actor, finalReq);
  if (!clean) return;
  const template = await createTemplateActor(actor, { ...finalReq, ...clean });
  if (!template) return;
  const linked = await linkTemplateToSkill(actor, finalReq, template);
  await announceVoiceOfTheWorld(actor, {
    kind: "form-approved",
    title: `Forma aprovada: ${template.name}`,
    body: linked ? `O Mestre aprovou a forma "${template.name}". Ligue a Habilidade de Forma para assumi-la.` : `O Mestre criou a ficha da forma "${template.name}" (sem Habilidade ligada).`
  });
  await updateRequestMessage(message, "approved", { ...clean, templateUuid: template.uuid });
}

async function adjust(message) {
  if (!game.user.isGM) return;
  const req = message.flags?.[SYSTEM_ID]?.formRequest;
  if (!req || !isOpenRequest(req.status)) return;
  const actor = requestActor(req);
  if (!actor) return;
  const edited = await openFormRequestEditor(actor, req, { title: `Ajustar e aprovar: ${req.name}`, saveLabel: "Aprovar" });
  if (edited) await approve(message, { override: edited });
}

async function requestChanges(message) {
  if (!game.user.isGM) return;
  const req = message.flags?.[SYSTEM_ID]?.formRequest;
  if (!req || !isOpenRequest(req.status)) return;
  const note = await foundry.applications.api.DialogV2.wait({
    window: { title: `Pedir mudança: ${req.name}` },
    content: `<div class="nihility-creation-dialog"><p>O que deve mudar em <b>${escapeHtml(req.name)}</b>?</p><textarea name="note" rows="3">${escapeHtml(req.gmNote ?? "")}</textarea></div>`,
    buttons: [
      { action: "send", label: "Enviar", default: true, callback: (event, button, dialog) => dialog.element.querySelector("[name=note]").value.trim() },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });
  if (typeof note !== "string" || !note) return;
  await updateRequestMessage(message, "changes", { gmNote: note });
  const actor = requestActor(req);
  if (actor) await announceVoiceOfTheWorld(actor, { kind: "form-request-changes", title: `Ajustar o pedido: ${req.name}`, body: `O Mestre pediu: "${note}". Edite o pedido no card do chat.` });
}

async function reject(message) {
  if (!game.user.isGM) return;
  const req = message.flags?.[SYSTEM_ID]?.formRequest;
  if (!req || !isOpenRequest(req.status)) return;
  await updateRequestMessage(message, "rejected");
}

/** O autor (ou o Mestre) edita o pedido; ele volta a "aguardando". */
async function edit(message) {
  const req = message?.flags?.[SYSTEM_ID]?.formRequest;
  if (!req || !isOpenRequest(req.status)) return;
  if (!message.isOwner) return ui.notifications?.warn("Só quem fez o pedido (ou o Mestre) pode editá-lo.");
  const actor = requestActor(req);
  if (!actor) return;
  const edited = await openFormRequestEditor(actor, req);
  if (!edited) return;
  const clean = validated(actor, edited);
  if (!clean) return;
  await updateRequestMessage(message, "pending", { ...clean, gmNote: "" });
  ui.notifications?.info("Pedido atualizado: o Mestre vê a versão nova no chat.");
}

/** Botões do card (chamado em `renderChatMessageHTML`). Os do Mestre somem para o jogador. */
export function renderFormRequestControls(message, html) {
  const req = message.flags?.[SYSTEM_ID]?.formRequest;
  if (!req) return;
  if (!game.user.isGM) html.querySelectorAll(".sr-gm-actions").forEach(el => el.remove());
  if (game.user.isGM || !message.isOwner) html.querySelectorAll(".sr-owner-actions").forEach(el => el.remove());
  const handlers = { approve: () => approve(message), adjust: () => adjust(message), changes: () => requestChanges(message), reject: () => reject(message), edit: () => edit(message) };
  html.querySelectorAll("[data-fr]").forEach(el => {
    el.addEventListener("click", event => {
      event.preventDefault();
      Promise.resolve(handlers[el.dataset.fr]?.()).catch(err => reportError("Falha no pedido de forma.", err));
    });
  });
}
