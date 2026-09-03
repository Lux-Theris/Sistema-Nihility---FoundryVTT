/**
 * Overhaul de Naves (Fase 7) — macro de reparo: um jogador pede pra consertar um Módulo (ou um
 * dos 3 pools do Ator que a cascata de dano lê — Escudo/Casco/Integridade Estrutural) via
 * `game.nihility.requestShipRepair()`; o Mestre rola a Destreza do engenheiro + um modificador
 * livre, julga por fora se passou (filosofia do sistema: o Mestre adjudica, o sistema só
 * calcula números) e, se decidir que sim, aplica a fórmula de reparo na Vida do alvo.
 */
import { SYSTEM_ID, MEU_SISTEMA, sceneActorCandidates } from "./config.js";
import { rollAttribute } from "./dice.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Alvos reparáveis de uma Nave/Veículo: cada Módulo instalado (`hp`) mais os 3 pools do próprio
 * Ator que a cascata de dano da Fase 4 lê (Escudo/Casco/Integridade Estrutural) — reparar um
 * desses três é consertar a placa/estrutura em si, não o Módulo que a alimenta.
 */
function repairTargetsFor(actor) {
  const targets = [
    { id: "actor::shields.value:shields.max", label: "Escudos (pool da Nave)" },
    { id: "actor::casco.value:casco.max", label: "Casco (pool da Nave)" },
    { id: "actor::hull.value:hull.max", label: "Integridade Estrutural (pool da Nave)" }
  ];
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
export async function requestShipRepair() {
  const ships = sceneActorCandidates({ types: ["starship", "vehicle"] });
  if (!ships.length) {
    ui.notifications.warn("Nenhuma Nave/Veículo na cena atual.");
    return;
  }
  if (ships.length > 1) {
    ui.notifications.warn("Mais de uma Nave/Veículo na cena atual — o pedido de reparo só funciona com exatamente uma.");
    return;
  }
  const ship = ships[0];

  const engineers = sceneActorCandidates({ types: ["character"], permission: "OWNER" });
  if (!engineers.length) {
    ui.notifications.warn("Você não controla nenhum Personagem na cena atual pra fazer o reparo.");
    return;
  }
  const defaultEngineer = game.user.character;
  const engineerOptions = engineers
    .map(a => `<option value="${a.id}" ${a.id === defaultEngineer?.id ? "selected" : ""}>${a.name}</option>`)
    .join("");
  const targetOptions = repairTargetsFor(ship).map(t => `<option value="${t.id}">${t.label}</option>`).join("");

  const result = await DialogV2.wait({
    window: { title: `Pedido de Reparo — ${ship.name}` },
    content: `
      <form>
        <div class="form-group">
          <label>Módulo/Pool a reparar</label>
          <select name="targetId">${targetOptions}</select>
        </div>
        <div class="form-group">
          <label>Engenheiro (rola Destreza)</label>
          <select name="engineerId">${engineerOptions}</select>
        </div>
      </form>
    `,
    buttons: [
      {
        action: "request",
        label: "Pedir Reparo",
        default: true,
        callback: (event, button, dialog) => {
          const form = dialog.element.querySelector("form");
          return { targetId: form.targetId.value, engineerId: form.engineerId.value };
        }
      },
      // `false` (não a string do `action`) sobrevive ao `??` do DialogV2.wait — ver mesmo
      // comentário em starship-sheet.js/skill-editor-dialog.js.
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });

  if (!result) return;

  const engineer = game.actors.get(result.engineerId);
  const target = repairTargetsFor(ship).find(t => t.id === result.targetId);
  if (!engineer || !target) return;

  await createShipRepairRequestMessage(ship, engineer, target);
}

async function createShipRepairRequestMessage(ship, engineer, target) {
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/chat/ship-repair-request.hbs`, {
    shipName: ship.name,
    engineerName: engineer.name,
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
  const content = await renderTemplate(`systems/${SYSTEM_ID}/templates/chat/ship-repair-request.hbs`, {
    shipName: game.actors.get(req.shipId)?.name ?? "?",
    engineerName: game.actors.get(req.engineerId)?.name ?? "?",
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

  const engineer = game.actors.get(req.engineerId);
  if (!engineer) return;

  await rollAttribute(engineer, "dexterity", {
    extraFlat: modifier,
    flavor: `${engineer.name} — Reparo (${req.targetLabel})${modifier ? ` — modificador ${modifier > 0 ? "+" : ""}${modifier}` : ""}`
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

  const formula = MEU_SISTEMA.REPAIR_ROLL_FORMULA ?? "0";
  const roll = new Roll(formula);
  await roll.evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: ship }),
    flavor: `Reparo — ${req.targetLabel}`
  });

  const newValue = Math.clamp(resolved.current + roll.total, 0, resolved.max);
  await resolved.doc.update({ [`system.${resolved.field}`]: newValue });

  await updateShipRepairMessage(message, "restored");
}
