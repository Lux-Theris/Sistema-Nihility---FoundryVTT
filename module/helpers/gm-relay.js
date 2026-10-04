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
 * **Regras ao adicionar uma ação nova aqui** — a ação roda com permissão de Mestre:
 *  - **Quem pediu:** todo handler recebe `(payload, user)`. `user` é quem emitiu, dito pelo
 *    SERVIDOR do Foundry (`handleCustomSocket` reenvia `emit(canal, dados, socket.user.id)`;
 *    conferido na 14.368), nunca um campo do payload — esse o cliente escreveria o que quisesse.
 *    Confira que `user` é dono (`owns`) do documento de ORIGEM da ação: o Ator que ataca, o dono
 *    da Skill, quem lançou a Zona. Até a 1.63.0 nada disso existia, e pelo console (F12) um
 *    jogador apagava Zonas de qualquer um, enchia XP alheia, punha Skills no Compêndio…
 *  - **O payload não é confiável:** resolva UUIDs e valide tudo do lado do Mestre; nunca aceite
 *    um valor que o cliente possa ter inflado (o `gain` de XP é calculado no emissor por
 *    conveniência, mas é re-limitado no destino).
 */
import { SYSTEM_ID, resistanceXpGain } from "../core/config.js";

const CHANNEL = `system.${SYSTEM_ID}`;

/**
 * `user` pode agir em nome de `doc`? Mestre sempre pode (inclusive quando a origem não existe,
 * ex.: Condição marcada à mão, sem Skill por trás). Item embutido herda a permissão do Ator.
 */
function owns(user, doc) {
  if (!user) return false;
  if (user.isGM) return true;
  return typeof doc?.testUserPermission === "function" && doc.testUserPermission(user, "OWNER");
}

/** Resolve um UUID vindo do payload e devolve o documento só se ele existir e `user` for dono. */
async function ownedDoc(uuid, user) {
  if (typeof uuid !== "string" || !uuid) return null;
  const doc = await fromUuid(uuid);
  return doc && owns(user, doc) ? doc : null;
}

/** Portão para ações que só precisam da permissão (não do documento): Mestre passa direto. */
async function mayActFor(user, uuid) {
  if (user?.isGM) return true;
  return Boolean(await ownedDoc(uuid, user));
}

/** Atores do Diretório e sintéticos (Token não vinculado) que `user` possui. */
function actorsOwnedBy(user) {
  const list = [...game.actors];
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) list.push(token.actor);
  return list.filter(actor => owns(user, actor));
}

/** Ações que o Mestre sabe executar em nome de outro cliente. Todas recebem `(payload, user)`. */
const HANDLERS = {
  /**
   * Credita XP em Skills de Resistência que acabaram de reduzir dano.
   *
   * Quem pede é quem atacou — quase nunca dono do alvo —, então aqui não dá para exigir posse.
   * O que segura o abuso é o limite: cada Skill ganha no máximo o XP de um golpe que tivesse
   * levado a Vida inteira do alvo (`resistanceXpGain(maxHp, maxHp)`), só Skills de Resistência
   * de verdade, uma vez cada por pedido, e nunca além do teto do nível.
   * @param {{actorUuid:string, grants:Array<{skillId:string, gain:number}>}} payload
   */
  async resistanceXp({ actorUuid, grants }) {
    const actor = typeof actorUuid === "string" ? await fromUuid(actorUuid) : null;
    if (!actor || !Array.isArray(grants)) return;

    const maxHp = Number(actor.system?.attributes?.hp?.max) || 0;
    const perHitCap = resistanceXpGain(maxHp, maxHp);
    const seen = new Set();
    for (const { skillId, gain } of grants.slice(0, 20)) {
      if (seen.has(skillId)) continue;
      seen.add(skillId);
      const skill = actor.items.get(skillId);
      // Skill concedida por Item/Módulo é fixa: nunca ganha XP.
      if (!skill || skill.type !== "skill" || skill.system.isItemGranted || !skill.system.resistanceTarget) continue;
      const amount = Math.min(Number(gain) || 0, perHitCap);
      if (!(amount > 0)) continue;

      const current = Number(skill.system.xp) || 0;
      const max = Number(skill.system.xpMax) || 0;
      // Re-aplica o teto aqui, e não só no emissor: o payload veio de outro cliente.
      const next = max > 0 ? Math.min(max, current + amount) : current + amount;
      if (next !== current) await skill.update({ "system.xp": next });
    }
  },

  /**
   * Liga/desliga o Correr (deslocamento ×2) do Combatant que está no turno.
   * @param {{combatantUuid:string, value:boolean}} payload
   */
  async setMovementDash({ combatantUuid, value }, user) {
    const combatant = typeof combatantUuid === "string" ? await fromUuid(combatantUuid) : null;
    if (combatant?.documentName !== "Combatant" || !owns(user, combatant.actor)) return;
    // Só quem está no seu turno pode declarar Correr — o payload vem de outro cliente.
    const combat = combatant.combat;
    if (!combat?.started || combat.combatant?.id !== combatant.id) return;
    await combatant.setFlag(SYSTEM_ID, "movementDash", Boolean(value));
  },

  /**
   * Contabiliza exposição a um tipo de dano (ver `registerResistanceExposure` em resistance.js).
   * Quem pede é o atacante, então não há posse a conferir; o efeito máximo é uma *sugestão* ao
   * Mestre, e o pedido é limitado a poucos tipos distintos.
   * @param {{actorUuid:string, elements:string[]}} payload
   */
  async resistanceExposure({ actorUuid, elements }) {
    const actor = typeof actorUuid === "string" ? await fromUuid(actorUuid) : null;
    if (!actor || !Array.isArray(elements)) return;
    const clean = [...new Set(elements.filter(e => typeof e === "string" && e))].slice(0, 10);
    const { applyResistanceExposure } = await import("../combat/resistance.js");
    await applyResistanceExposure(actor, clean);
  },

  /**
   * Registra no Compêndio de mundo um Item que um jogador criou (o jogador não pode escrever lá).
   * O payload só serve para achar o Item: ele tem de existir numa ficha que o jogador possui, e o
   * que vai para o Compêndio são os dados DESSE Item (name/img/type/system) — nunca o `system`
   * que veio no payload, nem ids, ownership ou flags.
   * @param {{itemData:object}} payload
   */
  async registerCompendiumItem({ itemData }, user) {
    const itemId = itemData?._id;
    if (typeof itemId !== "string") return;
    const item = actorsOwnedBy(user)
      .map(actor => actor.items.get(itemId))
      .find(Boolean);
    if (!item) return;
    const { registerItemInCompendium, getCompendiumForItemType } = await import("../core/compendium.js");
    if (!getCompendiumForItemType(item.type)) return;
    const source = item.toObject();
    await registerItemInCompendium({ name: source.name, img: source.img, type: source.type, system: source.system ?? {} });
  },

  /** Ergue uma Estrutura (Paredes + Desenho). Validação e catálogo ficam em structures.js. */
  async createStructure(payload, user) {
    if (!(await mayActFor(user, payload?.sourceActorUuid))) return;
    const { createStructureAsGm } = await import("../structures/structures.js");
    await createStructureAsGm(payload);
  },

  /**
   * Dano numa Estrutura que estava no caminho de um ataque (ver hitStructure em structures.js).
   * Quem pede tem de ser dono de quem atacou. O valor em si é o da rolagem desse cliente — o
   * mesmo grau de confiança de qualquer rolagem de dano.
   */
  async damageStructure({ sceneId, instanceId, amount, attackerUuid }, user) {
    if (!(await mayActFor(user, attackerUuid))) return;
    const scene = typeof sceneId === "string" ? game.scenes.get(sceneId) : null;
    const value = Math.max(0, Math.round(Number(amount) || 0));
    if (!scene || typeof instanceId !== "string" || !value) return;
    const { damageStructure } = await import("../structures/structures.js");
    await damageStructure(scene, instanceId, value);
  },

  /** "Regenerar agora" da janela de Efeitos: os Escudos mantidos deste Ator (escreve nos alvos). */
  async regenerateSustainedShields(payload, user) {
    const actor = await ownedDoc(payload?.actorUuid, user);
    if (!actor) return;
    const { regenerateSustainedShields } = await import("../skills/sustained-shields.js");
    await regenerateSustainedShields(actor);
  },

  /** Raio Trator: prende um alvo (a força é recalculada aqui, ver engageTractorAsGm). */
  async engageTractor(payload, user) {
    if (!(await mayActFor(user, payload?.moduleUuid))) return;
    const { engageTractorAsGm } = await import("../starship/starship-power.js");
    await engageTractorAsGm(payload ?? {});
  },

  /** Raio Trator: solta o alvo. */
  async releaseTractor(payload, user) {
    if (!(await mayActFor(user, payload?.moduleUuid))) return;
    const { releaseTractorAsGm } = await import("../starship/starship-power.js");
    await releaseTractorAsGm(payload ?? {});
  },

  /** Acende a luz de um Escudo pessoal nos Tokens do alvo (ver lights.js). Quem pede: dono de quem lançou. */
  async setShieldLight(payload, user) {
    if (!(await mayActFor(user, payload?.source?.actorUuid))) return;
    const { setShieldLightAsGm } = await import("../combat/lights.js");
    await setShieldLightAsGm(payload ?? {});
  },

  /** Apaga as luzes de Escudo que uma Skill Ativa acendeu (ao desligá-la). */
  async clearShieldLights({ actorUuid, skillId, subSkillIndex }, user) {
    if (!(await mayActFor(user, actorUuid))) return;
    const { clearShieldLightsFromSourceAsGm } = await import("../combat/lights.js");
    await clearShieldLightsFromSourceAsGm({ actorUuid, skillId: String(skillId ?? ""), subSkillIndex: Number.isInteger(subSkillIndex) ? subSkillIndex : null });
  },

  /**
   * Desligar uma Skill Ativa: tira a âncora dela dos efeitos em Atores que quem desligou não
   * possui. Quem pede tem de ser dono da Skill — ou, se ela já foi apagada, do Ator que a tinha.
   */
  async releaseSkillAnchors(payload, user) {
    const skillUuid = payload?.skillUuid;
    if (typeof skillUuid !== "string") return;
    const skill = await fromUuid(skillUuid);
    const holder = skill ?? (await fromUuid(skillUuid.split(".Item.")[0]));
    if (!owns(user, holder)) return;
    const { releaseSkillAnchorsAsGm } = await import("../skills/upkeep.js");
    // `requesterId` é sempre quem pediu de verdade, nunca o que veio no payload.
    await releaseSkillAnchorsAsGm({ ...payload, requesterId: user.id });
  },

  /** Derruba as Estruturas que uma Skill Ativa mantinha (ao desligá-la). */
  async removeStructures({ sourceUuid, skillId, subSkillIndex }, user) {
    if (!(await mayActFor(user, sourceUuid))) return;
    const { removeStructuresForAsGm } = await import("../structures/structures.js");
    await removeStructuresForAsGm({ sourceUuid, skillId: String(skillId ?? ""), subSkillIndex: Number.isInteger(subSkillIndex) ? subSkillIndex : null });
  },

  /** Apaga as Zonas que uma Skill Ativa mantinha (ao desligá-la). Quem pede: dono de quem lançou. */
  async removeZones({ sourceUuid, skillId, subSkillIndex }, user) {
    if (!(await mayActFor(user, sourceUuid))) return;
    const { zonesOnScene } = await import("../combat/area-effects.js");
    for (const scene of game.scenes) {
      for (const doc of zonesOnScene(scene)) {
        const zone = doc.getFlag(SYSTEM_ID, "zone");
        if (zone?.sourceUuid === sourceUuid && zone.skillId === skillId && (zone.subSkillIndex ?? null) === (subSkillIndex ?? null)) {
          await doc.delete();
        }
      }
    }
  },

  /**
   * Cria a Zona na cena: Region na V14, Measured Template na V13 (`zoneDocumentData`). A área
   * vem do cliente de quem lançou, então passa por `normalizeArea` (formas e números limitados),
   * e quem pede tem de ser dono de quem lançou.
   */
  async createZone({ sceneId, area, color, zone }, user) {
    const scene = game.scenes.get(sceneId);
    const source = await ownedDoc(zone?.sourceUuid, user);
    const { normalizeArea, zoneDocumentData } = await import("../combat/area-geometry.js");
    const { sceneScale } = await import("../combat/area-effects.js");
    const { foundryGeneration } = await import("./foundry-compat.js");
    const clean = normalizeArea(area);
    if (!scene || !source || !clean) return;

    const label = String(zone.label ?? "").trim() || "Zona"; // Region recusa nome vazio
    const { documentName, data } = zoneDocumentData(clean, {
      generation: foundryGeneration(),
      pxPerUnit: sceneScale(scene).pxPerUnit,
      color: /^#[0-9a-f]{6}$/i.test(color ?? "") ? color : "#ff0000",
      name: label,
      visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
      flags: {
        [SYSTEM_ID]: {
          zone: {
            sourceUuid: source.uuid,
            skillId: String(zone.skillId ?? ""),
            subSkillIndex: Number.isInteger(zone.subSkillIndex) ? zone.subSkillIndex : null,
            label,
            untilDeactivated: Boolean(zone.untilDeactivated),
            roundsRemaining: Math.min(Math.max(Number(zone.roundsRemaining) || 1, 1), 100),
            area: clean
          }
        }
      }
    });
    await scene.createEmbeddedDocuments(documentName, [data]);
  }
};

/**
 * O Mestre "designado" — o de menor id entre os conectados. Com dois Mestres online, sem isso os
 * dois executariam a mesma ação e o XP seria creditado em dobro.
 */
export function isDesignatedGm() {
  const activeGms = game.users.filter(u => u.isGM && u.active).map(u => u.id).sort();
  return activeGms[0] === game.user.id;
}

/**
 * Liga a escuta do canal. Chamado uma vez, no hook `ready`.
 *
 * O segundo argumento é o id de quem emitiu, posto pelo servidor (não pelo cliente). Sem ele —
 * uma versão futura que mude isso — a ação é recusada: melhor perder um XP do que voltar a
 * executar pedidos anônimos com permissão de Mestre.
 */
export function registerGmRelay() {
  game.socket.on(CHANNEL, async ({ action, payload } = {}, senderId) => {
    if (!isDesignatedGm()) return;
    const handler = HANDLERS[action];
    if (!handler) return;
    const user = typeof senderId === "string" ? game.users.get(senderId) : null;
    if (!user) {
      console.warn(`${SYSTEM_ID} | Pedido "${action}" sem remetente identificado pelo servidor; ignorado.`);
      return;
    }

    try {
      await handler(payload ?? {}, user);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao executar "${action}" como Mestre (pedido de ${user.name}).`, err);
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
    if (handler) await handler(payload ?? {}, game.user);
    return;
  }
  if (!game.users.some(u => u.isGM && u.active)) return;
  game.socket.emit(CHANNEL, { action, payload });
}
