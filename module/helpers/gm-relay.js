/**
 * Ponte para executar no cliente do Mestre uma escrita que o cliente de quem agiu não tem
 * permissão de fazer.
 *
 * O caso que motivou isto: XP de Resistência. Quem rola o ataque quase nunca é dono da ficha do
 * alvo — um jogador atacando outro jogador, ou atacando um NPC — e `item.update()` num documento
 * alheio simplesmente falha. Antes disso existir, o XP só era creditado quando o próprio Mestre
 * rolava, o que deixava metade das situações de mesa sem progressão nenhuma.
 *
 * O `system.json` já declarava `"socket": true` desde sempre, mas nada no sistema usava — este é
 * o primeiro (e por ora único) uso.
 *
 * **Regra ao adicionar uma ação nova aqui:** a ação roda com permissão de Mestre, então trate o
 * payload como não-confiável. Resolva UUIDs e valide tudo do lado do Mestre; nunca aceite do
 * payload um valor que o cliente possa ter inflado (o `gain` de XP é calculado no emissor por
 * conveniência, mas é re-limitado ao teto do nível no destino).
 */
import { SYSTEM_ID } from "../config.js";

const CHANNEL = `system.${SYSTEM_ID}`;

/** Ações que o Mestre sabe executar em nome de outro cliente. */
const HANDLERS = {
  /**
   * Credita XP em Skills de Resistência que acabaram de reduzir dano.
   * @param {{actorUuid:string, grants:Array<{skillId:string, gain:number}>}} payload
   */
  async resistanceXp({ actorUuid, grants }) {
    const actor = await fromUuid(actorUuid);
    if (!actor || !Array.isArray(grants)) return;

    for (const { skillId, gain } of grants) {
      const skill = actor.items.get(skillId);
      if (!skill || skill.type !== "skill" || !(gain > 0)) continue;

      const current = Number(skill.system.xp) || 0;
      const max = Number(skill.system.xpMax) || 0;
      // Re-aplica o teto aqui, e não só no emissor: o payload veio de outro cliente.
      const next = max > 0 ? Math.min(max, current + gain) : current + gain;
      if (next !== current) await skill.update({ "system.xp": next });
    }
  },

  /**
   * Contabiliza exposição a um tipo de dano (ver `registerResistanceExposure` em skill-effects.js).
   * @param {{actorUuid:string, elements:string[]}} payload
   */
  async resistanceExposure({ actorUuid, elements }) {
    const actor = await fromUuid(actorUuid);
    if (!actor) return;
    const { applyResistanceExposure } = await import("../skill-effects.js");
    await applyResistanceExposure(actor, elements);
  },

  /**
   * Cria uma Zona (Measured Template persistente) na cena. O payload vem de outro cliente: a
   * forma é validada e limitada aqui, e a origem tem de ser um Ator que existe.
   * @param {{sceneId:string, data:object, zone:object}} payload
   */
  async removeZones({ sourceUuid, skillId, subSkillIndex }) {
    for (const scene of game.scenes) {
      for (const template of scene.templates) {
        const zone = template.getFlag(SYSTEM_ID, "zone");
        if (zone?.sourceUuid === sourceUuid && zone.skillId === skillId && (zone.subSkillIndex ?? null) === (subSkillIndex ?? null)) {
          await template.delete();
        }
      }
    }
  },

  async createZone({ sceneId, data, zone }) {
    const scene = game.scenes.get(sceneId);
    const source = zone?.sourceUuid ? await fromUuid(zone.sourceUuid) : null;
    if (!scene || !source || !["circle", "cone", "ray"].includes(data?.t)) return;

    const num = (v, max) => Math.min(Math.max(Number(v) || 0, 0), max);
    await scene.createEmbeddedDocuments("MeasuredTemplate", [
      {
        t: data.t,
        x: num(data.x, 1e6),
        y: num(data.y, 1e6),
        direction: Number(data.direction) || 0,
        distance: num(data.distance, 1000),
        angle: num(data.angle, 360) || 53,
        width: num(data.width, 1000) || 1,
        fillColor: typeof data.fillColor === "string" ? data.fillColor : "#ff0000",
        flags: {
          [SYSTEM_ID]: {
            zone: {
              sourceUuid: source.uuid,
              skillId: String(zone.skillId ?? ""),
              subSkillIndex: Number.isInteger(zone.subSkillIndex) ? zone.subSkillIndex : null,
              label: String(zone.label ?? "Zona"),
              untilDeactivated: Boolean(zone.untilDeactivated),
              roundsRemaining: Math.min(Math.max(Number(zone.roundsRemaining) || 1, 1), 100)
            }
          }
        }
      }
    ]);
  }
};

/**
 * O Mestre "designado" — o de menor id entre os conectados. Com dois Mestres online, sem isso os
 * dois executariam a mesma ação e o XP seria creditado em dobro.
 */
function isDesignatedGm() {
  const activeGms = game.users.filter(u => u.isGM && u.active).map(u => u.id).sort();
  return activeGms[0] === game.user.id;
}

/** Liga a escuta do canal. Chamado uma vez, no hook `ready`. */
export function registerGmRelay() {
  game.socket.on(CHANNEL, async ({ action, payload } = {}) => {
    if (!isDesignatedGm()) return;
    const handler = HANDLERS[action];
    if (!handler) return;

    try {
      await handler(payload ?? {});
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao executar "${action}" como Mestre.`, err);
    }
  });
}

/**
 * Executa a ação: direto, se quem chamou já é o Mestre designado; senão pede pelo socket.
 *
 * Sem nenhum Mestre conectado a ação é perdida (não há quem tenha permissão de escrever) — em
 * silêncio de propósito, porque isto é chamado no meio da resolução de dano e um aviso a cada
 * golpe seria pior que a perda do XP.
 */
export async function runAsGm(action, payload) {
  if (isDesignatedGm()) {
    const handler = HANDLERS[action];
    if (handler) await handler(payload ?? {});
    return;
  }
  if (!game.users.some(u => u.isGM && u.active)) return;
  game.socket.emit(CHANNEL, { action, payload });
}
