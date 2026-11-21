/**
 * Sentidos e visibilidade (J4b) — o lado Foundry. As contas puras estão em `senses-rules.js`.
 *
 *  - Debaixo da terra (elevação < 0) conta como `burrow` e no ar (> 0) como `fly` para o Foundry, por uma
 *    subclasse de TokenDocument (`hasStatusEffect`), sem gravar nada: o dono vê o próprio Token, o Mestre
 *    vê tudo, os outros só com Sentido sísmico/Sentir tudo; quem está embaixo não enxerga.
 *  - Sentidos por efeito de Skill são Active Effects com chave `token.detectionModes.<modo>.range`
 *    (V14); o core já reaplica no Token e reinicia as fontes de visão (`_renderActiveEffectChanges`).
 *  - Sentidos de nascença (passivos da Espécie/Linhagem/Herança) entram em `_prepareDetectionModes`.
 *  - Condições do catálogo com `mapStatus` ganham o status Invisível/Cego do core.
 *  - Para jogadores, o seletor de alvo e a lista de iniciativa (inclusive o carrossel) mostram só quem
 *    o personagem percebe.
 * Desligado (`FEATURES.senses`): nada disso age; nada salvo se perde.
 */
import { SYSTEM_ID, getActiveStatusConditions, isElevationEnabled, isSensesEnabled, isStatusConditionsEnabled, sameActor } from "../core/config.js";
import { foundryGeneration, tokenElevation } from "../helpers/foundry-compat.js";
import { groundStatuses, originSenses, mapStatusesToAdd, isHiddenBySense, combatantVisibleFor, visibleSetChanged } from "./senses-rules.js";

/** Há Visão de Token na cena aberta? (sem ela todo mundo vê tudo e nada disto vale) */
function tokenVisionOn() {
  return Boolean(canvas?.ready && canvas.visibility?.tokenVision);
}

/* ------------------------------------------------------------------ TokenDocument */

/** Entra na cadeia de `CONFIG.Token.documentClass` (não atropela outro módulo que já a trocou). */
function registerTokenDocument() {
  const Base = CONFIG.Token.documentClass;
  CONFIG.Token.documentClass = class NihilityTokenDocument extends Base {
    /** @override Debaixo da terra = escavando, no ar = voando (só para a percepção; nada é gravado). */
    hasStatusEffect(statusId) {
      const special = CONFIG.specialStatusEffects ?? {};
      if (statusId && (statusId === special.BURROW || statusId === special.FLY)) {
        let ground = null;
        try {
          ground = groundStatuses({ elevation: tokenElevation(this), elevationOn: isElevationEnabled(), sensesOn: isSensesEnabled() });
        } catch (err) {
          ground = null; // configurações ainda não registradas
        }
        if (ground && ((statusId === special.BURROW && ground.burrow) || (statusId === special.FLY && ground.fly))) return true;
      }
      return super.hasStatusEffect(statusId);
    }

    /** @override Sentidos de nascença (Espécie/Linhagem/Herança), só na V14 (na V13 `detectionModes` é lista). */
    _prepareDetectionModes() {
      super._prepareDetectionModes();
      try {
        if (foundryGeneration() < 14 || !isSensesEnabled() || Array.isArray(this.detectionModes)) return;
        if (!this.sight?.enabled) return;
        const senses = originSenses(this.actor?.system?.originLayers);
        for (const [mode, range] of Object.entries(senses)) {
          const current = this.detectionModes[mode];
          const best = Math.max(Number(current?.range) || 0, range);
          this.detectionModes[mode] = { ...(current ?? {}), enabled: true, range: best };
        }
      } catch (err) {
        console.warn(`${SYSTEM_ID} | Sentidos de nascença não aplicados.`, err);
      }
    }
  };
}

/* ------------------------------------------------------------------ Atualização da percepção */

/** Reinicia as fontes de visão do Token e refaz a percepção (o que o core faz em `_onApplyStatusEffect`). */
function refreshTokenPerception(tokenDoc) {
  const object = tokenDoc?.object;
  if (!object || object.destroyed) return;
  object.initializeSources();
  canvas.perception?.update({ refreshVision: true });
}

function refreshAllTokens() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) if (!token.destroyed) token.initializeSources();
  canvas.perception?.update({ initializeVision: true, refreshVision: true });
}

const lastSign = new Map(); // uuid do Token → sinal da elevação (−1, 0, 1)

function onUpdateToken(tokenDoc, changes) {
  if (!foundry.utils.hasProperty(changes, "elevation")) return;
  const sign = Math.sign(tokenElevation(tokenDoc));
  const previous = lastSign.get(tokenDoc.uuid);
  lastSign.set(tokenDoc.uuid, sign);
  if (!isSensesEnabled() || !isElevationEnabled() || tokenDoc.parent !== canvas?.scene) return;
  // Sem registro do sinal anterior, refaz por garantia; senão só quando a elevação cruzou o 0.
  if (previous === sign) return;
  refreshTokenPerception(tokenDoc);
}

/* ------------------------------------------------------------------ Condições com status no mapa */

function addMapStatuses(effect, data) {
  if (!isSensesEnabled() || !isStatusConditionsEnabled()) return null;
  const statuses = Array.from(data?.statuses ?? effect.statuses ?? []);
  if (!statuses.length) return null;
  const add = mapStatusesToAdd(statuses, getActiveStatusConditions());
  return add.length ? [...statuses, ...add] : null;
}

/* ------------------------------------------------------------------ Quem o usuário percebe */

/** O Token (placeable) está visível para este usuário agora? (usa o resultado do último refresh, sem tocar em `isVisible`) */
export function tokenPlaceableVisible(tokenDoc) {
  const object = tokenDoc?.object;
  if (!object) return undefined;
  return Boolean(object.visible);
}

/**
 * O personagem percebe este Ator? Verdadeiro para o Mestre, com o bloco desligado, sem Visão de Token,
 * para o próprio dono e para quem não tem Token na cena aberta; senão, algum Token dele tem de estar
 * visível. Usado pelo seletor de alvo.
 */
export function actorPerceivedByUser(actor, { self = null } = {}) {
  if (game.user.isGM || !isSensesEnabled() || !tokenVisionOn() || !actor) return true;
  if (self && sameActor(actor, self)) return true;
  if (actor.isOwner) return true;
  const tokens = canvas.scene?.tokens?.filter(t => t.actor && (actor.isToken ? t.actor.uuid === actor.uuid : t.actorId === actor.id)) ?? [];
  if (!tokens.length) return true;
  return tokens.some(t => tokenPlaceableVisible(t) !== false);
}

/**
 * `Combatant#visible` para quem não é dono: some quem o jogador não vê nem sente agora (Token não
 * visível no último refresh: fora da linha de visão, debaixo da terra, Invisível…). Dono, 20/11.
 * @param {Combatant} combatant
 * @param {boolean} base - o `visible` do core (já composto com outros módulos)
 */
export function combatantVisibleByPerception(combatant, base) {
  try {
    if (game.user.isGM || !isSensesEnabled() || !base) return base;
    const tokenDoc = combatant.token;
    const onCanvasScene = Boolean(tokenDoc && canvas?.ready && tokenDoc.parent === canvas.scene);
    const special = CONFIG.specialStatusEffects ?? {};
    return combatantVisibleFor({
      base,
      isGM: false,
      enabled: true,
      isOwner: combatant.isOwner,
      onCanvasScene,
      tokenVision: tokenVisionOn(),
      hiddenBySense: onCanvasScene
        ? isHiddenBySense({ burrow: tokenDoc.hasStatusEffect(special.BURROW), invisible: tokenDoc.hasStatusEffect(special.INVISIBLE) })
        : false,
      tokenVisible: onCanvasScene ? tokenPlaceableVisible(tokenDoc) : undefined
    });
  } catch (err) {
    return base;
  }
}

/* ------------------------------------------------------------------ Lista de iniciativa */

let lastVisibleSet = null;
let refreshTimer = null;

function currentVisibleIds() {
  const combat = ui.combat?.viewed ?? game.combat;
  return (combat?.combatants ?? []).filter(c => c.visible).map(c => c.id);
}

/** Depois de cada refresh de percepção: se mudou quem aparece, redesenha a lista e o carrossel. */
function onSightRefresh() {
  if (game.user.isGM || !isSensesEnabled()) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const ids = currentVisibleIds();
    if (lastVisibleSet !== null && !visibleSetChanged(lastVisibleSet, ids)) return;
    // A primeira leitura (cena nova) também redesenha: a lista pode ter sido montada antes de a percepção
    // existir, quando o Token escondido ainda contava como visível.
    lastVisibleSet = ids;
    try {
      ui.combat?.render();
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Lista de iniciativa não redesenhada.`, err);
    }
    // Carousel Combat Tracker (opcional): monta os retratos de novo e reavalia `Combatant#visible`.
    try {
      const dock = ui.combatDock;
      if (dock) {
        dock.setupCombatants?.();
        dock.refresh?.();
      }
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Carrossel de combate não atualizado.`, err);
    }
  }, 100);
}

/* ------------------------------------------------------------------ Registro */

/** Chamado uma vez, no `init`: tudo confere `isSensesEnabled()` ao agir, então o bloco vale sem reload. */
export function registerSenses() {
  registerTokenDocument();

  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("sightRefresh", onSightRefresh);
  Hooks.on("canvasReady", () => {
    lastVisibleSet = null;
    lastSign.clear();
  });
  Hooks.on("deleteCombat", () => {
    lastVisibleSet = null;
  });

  // Ligou/desligou o bloco (ou a elevação): todos os Tokens releem o que enxergam.
  Hooks.on("updateSetting", setting => {
    if (setting?.key === `${SYSTEM_ID}.sensesEnabled` || setting?.key === `${SYSTEM_ID}.elevationEnabled`) {
      refreshAllTokens();
      lastVisibleSet = null;
      onSightRefresh();
    }
  });

  // Condição com "No mapa" (Cegueira, Invisibilidade…): põe o status do core no mesmo efeito. Um só lugar
  // para toda origem (Skill, elemento, Ambiente, marcada à mão no HUD).
  Hooks.on("preCreateActiveEffect", (effect, data) => {
    const statuses = addMapStatuses(effect, data);
    if (statuses) effect.updateSource({ statuses });
  });
  Hooks.on("preUpdateActiveEffect", (effect, changes) => {
    if (!changes?.statuses) return;
    const statuses = addMapStatuses(effect, changes);
    if (statuses) changes.statuses = statuses;
  });
}
