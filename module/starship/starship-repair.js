/**
 * Overhaul de Naves (Fase 7) — macro de reparo: um jogador pede pra consertar um Módulo (ou um
 * dos 3 pools do Ator que a cascata de dano lê — Escudo/Casco/Integridade Estrutural) via
 * `game.nihility.requestShipRepair()`; o Mestre rola a Destreza do engenheiro + um modificador
 * livre, julga por fora se passou (filosofia do sistema: o Mestre adjudica, o sistema só
 * calcula números) e, se decidir que sim, aplica a fórmula de reparo na Vida do alvo.
 */
import { SYSTEM_ID, MEU_SISTEMA, sceneActorCandidates, getCrewRoles, actorDisplayName, getShipActionConfig } from "../core/config.js";
import { rollAttribute } from "../core/dice.js";
import { renderSystemTemplate } from "../helpers/foundry-compat.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Alvos reparáveis de uma Nave/Veículo: cada Módulo instalado (`hp`) mais os 3 pools do próprio
 * Ator que a cascata de dano da Fase 4 lê (Escudo/Casco/Integridade Estrutural) — reparar um
 * desses três é consertar a placa/estrutura em si, não o Módulo que a alimenta.
 */
function repairTargetsFor(actor) {
  // Só o Escudo é pool de verdade. Casco e Integridade Estrutural deixaram de ser números
  // próprios da Nave: o Casco é a Vida do Módulo de armadura, e a Integridade é a soma da Vida
  // dos Módulos estruturais — reparar qualquer um dos dois é reparar o Módulo correspondente,
  // que já aparece na lista logo abaixo.
  const targets = [{ id: "actor::shields.value:shields.max", label: "Escudos (pool da Nave)" }];
  for (const module of actor.system.modules) {
    targets.push({ id: `item:${module.id}:hp.value:hp.max`, label: `${module.name} (Módulo)` });
  }
  return targets;
}

/** `"actor::field:maxField"` ou `"item:itemId:field:maxField"` — ids vêm só de `repairTargetsFor`, nunca digitados à mão. */
function parseTargetId(id) {
  const [scope, itemId, field, maxField] = id.split(":");
  return { scope, itemId, field, maxField };
}

/** Resolve o Document (Ator ou Item embutido) e os valores atual/máximo de um alvo de reparo já escolhido. */
function resolveRepairTarget(ship, targetId) {
  const { scope, itemId, field, maxField } = parseTargetId(targetId);
  const doc = scope === "item" ? ship.items.get(itemId) : ship;
  if (!doc) return null;
  return {
    doc,
    field,
    current: foundry.utils.getProperty(doc.system, field) ?? 0,
    max: maxField ? (foundry.utils.getProperty(doc.system, maxField) ?? Infinity) : Infinity
  };
}

/**
 * Abre o diálogo de pedido de reparo — diferente de toda outra escolha de alvo do sistema
 * (que lista candidatos e deixa o jogador escolher), a Nave/Veículo aqui NUNCA é um dropdown:
 * é sempre a única Nave/Veículo com Token na cena atual (`sceneActorCandidates`) — decisão
 * deliberada, reparo é sempre "conserte a nave que eu estou", não "escolha qualquer nave do
 * mundo". Só pede o Módulo/pool a consertar e o Personagem (seu, na mesma cena) que repara.
 * Rode via macro na hotbar: `game.nihility.requestShipRepair()`.
 */
export async function requestShipRepair(shipArg = null) {
  // Da ficha da Nave ("Reparo de emergência"), a Nave vem direto; pela macro, é a única da cena.
  let ship = shipArg?.documentName === "Actor" ? shipArg : null;
  if (!ship) {
    const ships = sceneActorCandidates({ types: ["starship", "vehicle"] });
    if (!ships.length) {
      ui.notifications.warn("Nenhuma Nave/Veículo na cena atual.");
      return;
    }
    if (ships.length > 1) {
      ui.notifications.warn("Mais de uma Nave/Veículo na cena atual — o pedido de reparo só funciona com exatamente uma.");
      return;
    }
    ship = ships[0];
  }

  // Quem conserta é a tripulação DESTA Nave: todos aparecem, com quem está no posto de Engenharia
  // em destaque (primeiro grupo). Nave sem tripulação cai nos Personagens do usuário na cena.
  const roles = getCrewRoles();
  const roleLabel = id => roles.find(r => r.id === id)?.label ?? id ?? "";
  const isEngineerRole = id => id === "engineer" || /engenh/i.test(roleLabel(id));
  // Engenharia restaura mais Vida: a fórmula extra (Regras da Mesa) soma no 2d6 do reparo.
  const configured = getShipActionConfig().repairEngineerFormula;
  const repairEngineerFormula = configured && Roll.validate(configured) ? configured : "";
  const bonusText = repairEngineerFormula ? ` (+${repairEngineerFormula} de Vida)` : "";
  let crew = (ship.system.crewActors ?? []).map(entry => ({ actor: entry.actor, role: entry.role }));
  if (!crew.length) {
    crew = sceneActorCandidates({ types: ["character"], permission: "OWNER" }).map(actor => ({ actor, role: "" }));
    if (!crew.length) {
      ui.notifications.warn(`${ship.name} não tem tripulação (arraste Personagens para a aba Tripulação) e você não controla nenhum Personagem na cena.`);
      return;
    }
    ui.notifications.info(`${ship.name} não tem tripulação: listando os seus Personagens na cena.`);
  }
  const engineers = crew.filter(c => isEngineerRole(c.role));
  const others = crew.filter(c => !isEngineerRole(c.role));
  // Já selecionado: um engenheiro seu, senão o seu personagem, senão o primeiro engenheiro.
  const preferred =
    engineers.find(c => c.actor.isOwner) ?? crew.find(c => c.actor.uuid === game.user.character?.uuid) ?? engineers[0] ?? crew[0];
  const option = c =>
    `<option value="${escapeHtml(c.actor.uuid)}" ${c === preferred ? "selected" : ""}>${isEngineerRole(c.role) ? "★ " : ""}${escapeHtml(actorDisplayName(c.actor))}${c.role ? ` — ${escapeHtml(roleLabel(c.role))}` : ""}${isEngineerRole(c.role) ? bonusText : ""}</option>`;
  const engineerOptions =
    (engineers.length ? `<optgroup label="Engenharia${repairEngineerFormula ? ` — reparam +${repairEngineerFormula} de Vida` : ""}">${engineers.map(option).join("")}</optgroup>` : "") +
    (others.length ? `<optgroup label="${engineers.length ? "Outros tripulantes" : "Tripulação"}">${others.map(option).join("")}</optgroup>` : "");
  const targetOptions = repairTargetsFor(ship).map(t => `<option value="${t.id}">${t.label}</option>`).join("");

  const result = await DialogV2.wait({
    window: { title: `Pedido de Reparo — ${ship.name}` },
    // `<div>`, não `<form>`: o DialogV2 já tem o próprio form e descarta um form aninhado.
    content: `
      <div class="nihility-repair-request">
        <div class="form-group">
          <label>Módulo/Pool a reparar</label>
          <select name="targetId">${targetOptions}</select>
        </div>
        <div class="form-group">
          <label>Quem conserta (rola Destreza)</label>
          <select name="engineerUuid">${engineerOptions}</select>
        </div>
        ${engineers.length ? "" : `<p class="hint">Ninguém no posto de Engenharia — qualquer tripulante pode tentar.</p>`}
      </div>
    `,
    buttons: [
      {
        action: "request",
        label: "Pedir Reparo",
        default: true,
        callback: (event, button, dialog) => ({
          targetId: dialog.element.querySelector('[name="targetId"]').value,
          engineerUuid: dialog.element.querySelector('[name="engineerUuid"]').value
        })
      },
      // `false` (não a string do `action`) sobrevive ao `??` do DialogV2.wait — ver mesmo
      // comentário em starship-sheet.js/skill-editor-dialog.js.
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });

  if (!result) return;

  const engineer = fromUuidSync(result.engineerUuid);
  const target = repairTargetsFor(ship).find(t => t.id === result.targetId);
  if (!engineer || !target) return;
  // O bônus é decidido no pedido (o posto de agora), não na hora da rolagem.
  const chosen = crew.find(c => c.actor.uuid === engineer.uuid);
  const engineerBonus = chosen && isEngineerRole(chosen.role) ? repairEngineerFormula : "";

  await createShipRepairRequestMessage(ship, engineer, target, engineerBonus);
}

/** O engenheiro de um pedido: por uuid (pedidos novos), ou pelo id da ficha (pedidos antigos). */
function repairEngineer(req) {
  return (req.engineerUuid ? fromUuidSync(req.engineerUuid) : null) ?? game.actors.get(req.engineerId) ?? null;
}

/** "Fulano (Engenharia: +1d6 de Vida)" no card, quando o bônus vale. */
function engineerLabel(name, bonus) {
  return typeof bonus === "string" && bonus ? `${name} (Engenharia: +${bonus} de Vida)` : name;
}

/** Escapa texto de nome pra dentro do HTML do diálogo. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

async function createShipRepairRequestMessage(ship, engineer, target, engineerBonus = "") {
  const content = await renderSystemTemplate(`systems/${SYSTEM_ID}/templates/chat/ship-repair-request.hbs`, {
    shipName: ship.name,
    engineerName: engineerLabel(actorDisplayName(engineer), engineerBonus),
    targetLabel: target.label,
    status: "pending"
  });

  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
  const ownerIds = game.users
    .filter(u => !u.isGM && (ship.testUserPermission(u, "OWNER") || engineer.testUserPermission(u, "OWNER")))
    .map(u => u.id);
  const whisper = Array.from(new Set([...gmIds, ...ownerIds]));

  return ChatMessage.create({
    content,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor: engineer }),
    flags: {
      [SYSTEM_ID]: {
        shipRepairRequest: {
          shipId: ship.id,
          engineerId: engineer.id,
          // Por uuid: dois Tokens não vinculados da mesma ficha são tripulantes diferentes.
          engineerUuid: engineer.uuid,
          // Fórmula extra de Vida da Engenharia, decidida no pedido (o posto de agora).
          engineerBonus,
          targetId: target.id,
          targetLabel: target.label,
          status: "pending"
        }
      }
    }
  });
}

async function updateShipRepairMessage(message, status) {
  const req = { ...message.flags[SYSTEM_ID].shipRepairRequest, status };
  const content = await renderSystemTemplate(`systems/${SYSTEM_ID}/templates/chat/ship-repair-request.hbs`, {
    shipName: game.actors.get(req.shipId)?.name ?? "?",
    engineerName: engineerLabel(actorDisplayName(repairEngineer(req)) || "?", req.engineerBonus),
    targetLabel: req.targetLabel,
    status
  });
  await message.update({ content, [`flags.${SYSTEM_ID}.shipRepairRequest.status`]: status });
}

/**
 * Botão "Rolar Destreza" do pedido de reparo — GM-only. Rola `buildAttributeRollFormula` da
 * Destreza do engenheiro + o modificador livre digitado no chat (`modifier`); o Mestre julga
 * por fora se o resultado passou (nenhum estado de "falhou" — se não passar, o Mestre
 * simplesmente não clica "Restaurar Vida" depois).
 */
export async function approveShipRepairRoll(message, modifier = 0) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode aprovar pedidos de reparo.");
    return;
  }
  const req = message.flags?.[SYSTEM_ID]?.shipRepairRequest;
  if (!req || req.status !== "pending") return;

  const engineer = repairEngineer(req);
  if (!engineer) return;

  await rollAttribute(engineer, "dexterity", {
    extraFlat: modifier,
    flavor: `${actorDisplayName(engineer)} — Reparo (${req.targetLabel})${modifier ? ` — modificador ${modifier > 0 ? "+" : ""}${modifier}` : ""}`
  });

  await updateShipRepairMessage(message, "rolled");
}

/**
 * Botão "Restaurar Vida" — só aparece depois da rolagem, GM-only. Rola a fórmula de reparo
 * (`MEU_SISTEMA.REPAIR_ROLL_FORMULA`, "2d6" — mesma pra qualquer alvo, sem escalar pelo tamanho
 * dele, ver Fase 8 do overhaul) e aplica o resultado no alvo escolhido, clampado em [0, max].
 */
export async function restoreShipRepairTarget(message) {
  if (!game.user.isGM) {
    ui.notifications?.warn("Só o Mestre pode aplicar o reparo.");
    return;
  }
  const req = message.flags?.[SYSTEM_ID]?.shipRepairRequest;
  if (!req || req.status !== "rolled") return;

  const ship = game.actors.get(req.shipId);
  if (!ship) return;
  const resolved = resolveRepairTarget(ship, req.targetId);
  if (!resolved) return;

  // Engenharia restaura mais: a fórmula extra guardada no pedido soma no 2d6.
  const base = MEU_SISTEMA.REPAIR_ROLL_FORMULA ?? "0";
  const extra = typeof req.engineerBonus === "string" && req.engineerBonus && Roll.validate(req.engineerBonus) ? req.engineerBonus : "";
  const roll = new Roll(extra ? `${base} + (${extra})` : base);
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: ship }),
    flavor: `Reparo — ${req.targetLabel}${extra ? ` — Engenharia +${extra}` : ""}`
  });

  const newValue = Math.clamp(resolved.current + roll.total, 0, resolved.max);
  await resolved.doc.update({ [`system.${resolved.field}`]: newValue });

  await updateShipRepairMessage(message, "restored");
}
