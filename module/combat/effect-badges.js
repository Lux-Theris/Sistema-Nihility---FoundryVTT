/**
 * O número no canto do ícone de efeito no Token (backlog L3; mockup aprovado "Avisos na Tela",
 * quadro 3). A regra do que mostrar é pura, em `effect-badge-rules.js`; aqui só se lê e se desenha.
 *
 *  - Quem vê: só quem controla o Token (dono) — o Mestre vê em todos. Decisão do dono: o jogador
 *    não fica sabendo quanto falta nos efeitos dos inimigos.
 *  - Opção por usuário `effectBadges` (desliga só neste navegador).
 *  - Como: uma subclasse de Token encadeada em `CONFIG.Token.objectClass` (igual a movement.js).
 *    Depois do `_drawEffects` do core, cada ícone é ligado ao seu efeito pelo `zIndex` que o próprio
 *    core grava (= posição na lista de efeitos exibidos); os números ficam num contêiner à parte,
 *    porque o `_refreshEffects` do core trata todo filho de `effects` como ícone e o redimensionaria.
 *    Se o casamento ícone ↔ efeito não fechar (outra versão do core), não desenha nada.
 *  - Atualiza ao redesenhar os efeitos (o core faz isso ao criar/apagar), a cada mudança de efeito
 *    e a cada troca de turno (os prazos andam).
 */
import { SYSTEM_ID, MEU_SISTEMA } from "../core/config.js";
import { effectAnchors, finiteRemaining } from "./effect-anchors.js";
import { effectBadge, BADGE_COLORS } from "./effect-badge-rules.js";

function enabledForMe() {
  try {
    return game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.effectBadges) !== false;
  } catch {
    return true;
  }
}

function combatNow(combat = game.combat) {
  return combat?.started ? { round: combat.round ?? 0, combatId: combat.id } : {};
}

/** Rodadas que faltam na duração do próprio Foundry (só quando ela é contada em rodadas/turnos). */
function foundryRounds(effect, combat = null) {
  const d = effect.duration;
  if (!d) return null;
  // V14: `units` ("rounds"/"turns"/"seconds"…); V13: `type` ("turns"/"seconds"/"none").
  const roundBased = d.units ? ["rounds", "turns"].includes(d.units) : d.type === "turns";
  if (!roundBased) return null;
  // Combate que acabou de ser apagado (Fim do combate): o Foundry já não conta por ele, então a
  // conta sai do início gravado no efeito (V14 `start`, V13 `duration.startRound`).
  if (combat) {
    const start = effect._source?.start ?? null;
    if (start?.combat === combat.id && d.units === "rounds" && Number.isFinite(Number(d.value))) return Math.max(0, Number(start.round) + Number(d.value) - combat.round);
    if (d.combat === combat.id && Number.isFinite(Number(d.rounds)) && Number.isFinite(Number(d.startRound))) return Math.max(0, Number(d.startRound) + Number(d.rounds) - combat.round);
  }
  return Number.isFinite(d.remaining) ? d.remaining : null;
}

/** O que o efeito tem de prazo, no formato que `effectBadge` lê. */
export function badgeFor(effect, { combat = null } = {}) {
  const f = effect.flags?.[SYSTEM_ID] ?? {};
  const anchors = effectAnchors(f, effect.origin);
  return effectBadge({
    radiationLevel: f.radiation?.level ?? 0,
    incapacitation: f.incapacitation ?? null,
    environment: Boolean(f.environment?.sceneId),
    curse: Boolean(f.curse),
    periodic: Boolean(f.periodic),
    ticksRemaining: f.ticksRemaining ?? null,
    anchored: anchors.length > 0,
    finite: anchors.length ? finiteRemaining(f.finite, combatNow(combat ?? game.combat)) : 0,
    rounds: foundryRounds(effect, combat)
  });
}

/** Mesma lista e mesma ordem que o `_drawEffects` do core desenha. */
function shownEffects(token) {
  const SHOW_ICON = CONST.ACTIVE_EFFECT_SHOW_ICON;
  return (
    token.actor?.appliedEffects?.filter(e => {
      if (!SHOW_ICON) return e.isTemporary;
      return e.showIcon === SHOW_ICON.ALWAYS || (e.showIcon === SHOW_ICON.CONDITIONAL && e.isTemporary);
    }) ?? []
  );
}

function textClass() {
  return foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;
}

/** Recria os números (o texto) sem redesenhar os ícones. */
function drawBadges(token) {
  const layer = token.nihilityBadges;
  if (!layer || layer.destroyed) return;
  layer.removeChildren().forEach(c => c.destroy());
  if (!enabledForMe() || !token.document?.isOwner || !token.effects) return;

  const effects = shownEffects(token);
  const icons = token.effects.children.filter(c => c !== token.effects.bg && c !== token.effects.overlay);
  // O core grava zIndex = posição do efeito na lista; sem isso (ou repetido) não dá para saber qual
  // ícone é qual efeito — melhor nenhum número do que um número no ícone errado.
  const indexes = icons.map(c => c.zIndex);
  if (new Set(indexes).size !== icons.length || indexes.some(i => !Number.isInteger(i) || i < 0 || i >= effects.length)) return;

  const TextClass = textClass();
  for (const icon of icons) {
    const badge = badgeFor(effects[icon.zIndex]);
    if (!badge) continue;
    const style = TextClass.getTextStyle
      ? TextClass.getTextStyle({ fontSize: 24, fill: BADGE_COLORS[badge.tone], stroke: 0x000000, strokeThickness: 4, fontWeight: "bold" })
      : { fontSize: 24, fill: BADGE_COLORS[badge.tone], stroke: 0x000000, strokeThickness: 4, fontWeight: "bold" };
    const text = layer.addChild(new TextClass(badge.text, style));
    text.anchor?.set(1, 1);
    text.nihilityIcon = icon;
  }
  placeBadges(token);
}

/** Canto de baixo à direita de cada ícone, no tamanho do ícone (que muda com o Token). */
function placeBadges(token) {
  const layer = token.nihilityBadges;
  if (!layer || layer.destroyed || !token.effects) return;
  layer.position.copyFrom?.(token.effects.position);
  layer.zIndex = (Number(token.effects.zIndex) || 0) + 1;
  layer.visible = token.effects.visible !== false;
  for (const text of layer.children) {
    const icon = text.nihilityIcon;
    if (!icon || icon.destroyed) continue;
    const size = icon.width || 20;
    text.scale.set((size * 0.62) / 24);
    text.position.set(icon.x + size + size * 0.1, icon.y + size + size * 0.12);
  }
}

/** Recalcula os números dos Tokens deste Ator neste cliente (o prazo mudou, não os ícones). */
function refreshActorBadges(actor) {
  for (const token of actor?.getActiveTokens?.() ?? []) drawBadges(token);
}

export function refreshAllBadges() {
  for (const token of canvas?.tokens?.placeables ?? []) drawBadges(token);
}

/** Chamado uma vez, no `init`. */
/**
 * V14 só desenha no Token o ícone de um efeito que tem duração ou que está marcado "mostrar
 * sempre" (`showIcon`; a V13 também desenhava quem tinha `statuses`). Os efeitos do sistema sem
 * duração do Foundry — os de Skill Ativa (até desligar), Irradiado, perigos de Ambiente, Maldição,
 * Caído/Inconsciente — ficavam invisíveis no mapa (e sem lugar para o número). As Condições
 * marcadas pelo HUD já vêm "sempre" do próprio core (`ActiveEffect.fromStatusEffect`); aqui todo
 * efeito criado pelo sistema ganha o mesmo, a não ser que quem criou tenha escolhido outro.
 */
export function registerSystemEffectIcons() {
  const ALWAYS = CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS;
  if (ALWAYS === undefined) return; // V13: o campo não existe
  Hooks.on("preCreateActiveEffect", (effect, data) => {
    if (data?.showIcon !== undefined || !data?.flags?.[SYSTEM_ID]) return;
    if (effect.parent?.documentName !== "Actor") return;
    effect.updateSource({ showIcon: ALWAYS });
  });
}

/** Migração única: os efeitos do sistema já existentes que a V14 esconde passam a aparecer. */
export async function migrateSystemEffectIcons() {
  const SHOW = CONST.ACTIVE_EFFECT_SHOW_ICON;
  if (SHOW?.ALWAYS === undefined) return;
  const actors = new Map();
  for (const actor of game.actors) actors.set(actor.uuid, actor);
  for (const scene of game.scenes) for (const token of scene.tokens) if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
  for (const actor of actors.values()) {
    const updates = actor.effects
      .filter(e => e.flags?.[SYSTEM_ID] && e.showIcon === SHOW.CONDITIONAL && !e.isTemporary)
      .map(e => ({ _id: e.id, showIcon: SHOW.ALWAYS }));
    if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  }
}

export function registerEffectBadges() {
  const BaseToken = CONFIG.Token.objectClass;
  CONFIG.Token.objectClass = class NihilityBadgedToken extends BaseToken {
    /** @override */
    async _drawEffects() {
      await super._drawEffects();
      try {
        if (!this.nihilityBadges || this.nihilityBadges.destroyed) this.nihilityBadges = this.addChild(new PIXI.Container());
        drawBadges(this);
      } catch (err) {
        console.error(`${SYSTEM_ID} | Falha ao desenhar a duração nos ícones do Token.`, err);
      }
    }

    /** @override */
    _refreshEffects() {
      super._refreshEffects();
      try {
        placeBadges(this);
      } catch (err) {
        /* só posição; nunca derruba o desenho do Token */
      }
    }
  };

  const onEffect = effect => {
    const actor = effect?.parent;
    if (actor?.documentName === "Actor") refreshActorBadges(actor);
  };
  Hooks.on("updateActiveEffect", onEffect);
  Hooks.on("updateCombat", () => refreshAllBadges());
  Hooks.on("deleteCombat", () => refreshAllBadges());
}
