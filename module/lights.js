/**
 * Luz de Estrutura e de Escudo pessoal — um editor só, usado nos dois lugares.
 *
 *  - **Estrutura** (catálogo, apps/structures-config.js): vira AmbientLight(s) de verdade criadas
 *    junto com as Paredes (ver structures.js) e APAGADAS junto com elas.
 *  - **Escudo pessoal** (Efeito de alvo "Escudo" de uma Skill): vira a luz do próprio Token, que
 *    acompanha o personagem. Quando o Escudo chega a 0, ou a Skill Ativa que o deu é desligada, a
 *    luz é apagada: o Token volta exatamente à luz que tinha antes (guardada num flag), sem ficar
 *    uma luz "desligada" pendurada nele.
 *
 * As animações do próprio Foundry (Campo de Energia, Domo Hexagonal, Grade de Força, Pulso…)
 * fazem o efeito de escudo de energia. O editor tem pré-visualização ao vivo no mapa, só na tela
 * de quem está editando: nada é gravado até Aplicar.
 */
import { SYSTEM_ID, normalizeLightConfig } from "./config.js";
import { runAsGm, isDesignatedGm } from "./helpers/gm-relay.js";


const SHIELD_FLAG = "shieldLight";
/** Raio padrão da luz de Escudo pessoal quando o editor deixa em 0 (automático), em unidades da cena. */
const SHIELD_DEFAULT_RADIUS = { dim: 2, bright: 1 };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** Animações de luz disponíveis nesta instalação do Foundry (inclui as de módulos). */
export function lightAnimationOptions() {
  const entries = Object.entries(CONFIG.Canvas?.lightAnimations ?? {});
  return [["", "Nenhuma"], ...entries.map(([key, def]) => [key, game.i18n.localize(def?.label ?? key)])]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[1].localeCompare(b[1], "pt-BR")));
}

/** Resumo de uma linha pra mostrar ao lado do botão ("Campo de Energia · #6ee7ff · 3 m"). */
export function describeLight(raw) {
  const light = normalizeLightConfig(raw);
  if (!light) return "sem luz";
  const animation = light.animation ? lightAnimationOptions().find(([key]) => key === light.animation)?.[1] ?? light.animation : "sem animação";
  const radius = light.dim ? `${light.dim} m` : "raio automático";
  return `${animation} · ${light.color} · ${radius}`;
}

/**
 * O bloco `config` de uma AmbientLight (e o `light` de um Token, que tem o mesmo formato).
 * @param {object} light - já normalizada
 * @param {{dim:number, bright:number}} radius - raio efetivo (o automático já resolvido)
 */
export function lightSourceData(light, radius) {
  return {
    color: light.color,
    alpha: light.alpha,
    dim: radius.dim,
    bright: radius.bright,
    angle: 360,
    luminosity: 0.5,
    animation: { type: light.animation || null, speed: light.speed, intensity: light.intensity }
  };
}

/** Raio efetivo: o da luz, ou o automático de quem usa quando a luz deixa em 0. */
export function resolvedRadius(light, fallback) {
  const dim = light.dim || fallback.dim;
  const bright = light.dim ? light.bright : Math.min(fallback.bright, dim);
  return { dim, bright };
}

/* ------------------------------------------------------------------ Pré-visualização */

/**
 * Luz de mentira, só neste cliente: um documento NÃO salvo desenhado na camada de preview da
 * Iluminação — o mesmo jeito que o Foundry mostra a luz enquanto você arrasta uma luz nova.
 */
class LightPreview {
  constructor(position) {
    this.position = position;
    this.object = null;
  }

  async show(light, radius) {
    if (!canvas?.ready || !canvas.lighting) return false;
    const data = { x: this.position.x, y: this.position.y, walls: true, vision: false, config: lightSourceData(light, radius) };
    try {
      if (!this.object) {
        const doc = new CONFIG.AmbientLight.documentClass(data, { parent: canvas.scene });
        this.object = new CONFIG.AmbientLight.objectClass(doc);
        canvas.lighting.preview.addChild(this.object);
        await this.object.draw();
      } else {
        this.object.document.updateSource(data);
      }
      this.object.initializeLightSource?.();
      this.object.renderFlags?.set?.({ refresh: true });
      canvas.perception.update({ refreshLighting: true, refreshVision: true });
      return true;
    } catch (err) {
      console.warn(`${SYSTEM_ID} | Pré-visualização de luz indisponível.`, err);
      this.stop();
      return false;
    }
  }

  stop() {
    if (!this.object) return;
    try {
      this.object.initializeLightSource?.({ deleted: true });
      canvas.lighting?.preview?.removeChild(this.object);
      this.object.destroy({ children: true });
      canvas.perception?.update({ refreshLighting: true, refreshVision: true });
    } catch (err) {
      /* a cena pode ter trocado com o editor aberto */
    }
    this.object = null;
  }
}

/** Onde pré-visualizar: no Token selecionado, senão no centro da tela. */
function previewPosition() {
  const token = canvas?.tokens?.controlled?.[0];
  if (token) return { x: token.center.x, y: token.center.y };
  return { x: canvas?.stage?.pivot?.x ?? 0, y: canvas?.stage?.pivot?.y ?? 0 };
}

/* ------------------------------------------------------------------ Editor */

/**
 * Editor de luz. Devolve a luz (objeto, com `enabled` falso se desligou) ou `null` se cancelou.
 * @param {object|null} current
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.autoHint] - o que o raio 0 significa aqui
 * @param {{dim:number, bright:number}} [options.previewRadius] - raio usado na prévia quando está em automático
 */
export async function openLightConfigDialog(current, { title = "Luz", autoHint = "Raio 0 = automático", previewRadius = SHIELD_DEFAULT_RADIUS } = {}) {
  const light = normalizeLightConfig({ enabled: true, ...(current ?? {}) });
  const enabled = Boolean(current?.enabled);
  const animations = lightAnimationOptions()
    .map(([key, label]) => `<option value="${escapeHtml(key)}" ${key === light.animation ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");

  // `<div>`, nunca `<form>`: o DialogV2 já embrulha o conteúdo num form.
  const content = `
    <div class="nihility-light-editor">
      <label class="light-enable"><input type="checkbox" name="enabled" ${enabled ? "checked" : ""}/> Emitir luz</label>
      <div class="light-fields">
        <label>Cor <input type="color" name="color" value="${escapeHtml(light.color)}"/></label>
        <label>Intensidade da cor <input type="range" name="alpha" min="0" max="1" step="0.05" value="${light.alpha}"/></label>
        <label title="${escapeHtml(autoHint)}">Raio fraco (m) <input type="number" name="dim" min="0" step="0.5" value="${light.dim}"/></label>
        <label title="Parte mais forte, no centro. Não passa do raio fraco.">Raio forte (m) <input type="number" name="bright" min="0" step="0.5" value="${light.bright}"/></label>
        <label class="light-wide">Animação <select name="animation">${animations}</select></label>
        <label>Velocidade <input type="range" name="speed" min="1" max="10" step="1" value="${light.speed}"/></label>
        <label>Intensidade da animação <input type="range" name="intensity" min="1" max="10" step="1" value="${light.intensity}"/></label>
      </div>
      <p class="hint">${escapeHtml(autoHint)}. Dica: Campo de Energia, Domo Hexagonal e Grade de Força parecem escudo de energia.</p>
      <div class="light-preview-row">
        <button type="button" class="light-preview-toggle"><i class="fas fa-eye"></i> Pré-visualizar no mapa</button>
        <span class="hint light-preview-where"></span>
      </div>
    </div>`;

  const read = root => {
    const get = name => root.querySelector(`[name="${name}"]`);
    return {
      enabled: get("enabled").checked,
      color: get("color").value,
      alpha: Number(get("alpha").value),
      dim: Number(get("dim").value) || 0,
      bright: Number(get("bright").value) || 0,
      animation: get("animation").value,
      speed: Number(get("speed").value),
      intensity: Number(get("intensity").value)
    };
  };

  const preview = new LightPreview(previewPosition());
  let previewing = false;

  // Lido aqui, não no topo do módulo: skill-effects.js importa este arquivo, e os testes carregam
  // skill-effects.js sem `foundry.applications`.
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title },
    classes: ["nihility-light-dialog"],
    position: { width: 420 },
    content,
    buttons: [
      {
        action: "apply",
        label: "Aplicar",
        default: true,
        callback: (event, button, dialog) => {
          const raw = read(dialog.element);
          return raw.enabled ? normalizeLightConfig(raw) : { ...raw, enabled: false };
        }
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      const root = dialog?.element ?? dialog;
      const toggle = root?.querySelector?.(".light-preview-toggle");
      if (!toggle) return;
      const where = root.querySelector(".light-preview-where");
      const refresh = async () => {
        if (!previewing) return;
        const raw = normalizeLightConfig({ ...read(root), enabled: true });
        const ok = await preview.show(raw, resolvedRadius(raw, previewRadius));
        if (!ok) {
          previewing = false;
          toggle.innerHTML = `<i class="fas fa-eye"></i> Pré-visualizar no mapa`;
          where.textContent = "Pré-visualização indisponível nesta cena.";
        }
      };
      toggle.addEventListener("click", async () => {
        previewing = !previewing;
        if (previewing) {
          toggle.innerHTML = `<i class="fas fa-eye-slash"></i> Parar pré-visualização`;
          where.textContent = canvas?.tokens?.controlled?.length ? "no Token selecionado · só você vê" : "no centro da tela · só você vê";
          await refresh();
        } else {
          preview.stop();
          toggle.innerHTML = `<i class="fas fa-eye"></i> Pré-visualizar no mapa`;
          where.textContent = "";
        }
      });
      root.querySelector(".light-fields").addEventListener("input", refresh);
      root.querySelector(".light-fields").addEventListener("change", refresh);
    }
  });

  preview.stop();
  return result && typeof result === "object" ? result : null;
}

/* ------------------------------------------------------------------ Escudo pessoal */

/** Tokens do Ator em todas as Cenas (Token sintético: o próprio). */
function tokensOf(actor) {
  if (actor?.isToken && actor.token) return [actor.token];
  if (typeof actor?.getDependentTokens === "function") return actor.getDependentTokens();
  return actor?.getActiveTokens?.(false, true) ?? [];
}

/**
 * Acende a luz do Escudo nos Tokens do Ator. Pede pro Mestre (quem usa a Skill raramente é dono
 * do Token do alvo). `source` identifica a Skill, pra apagar quando ela for desligada.
 */
export async function requestShieldLight(targetActor, rawLight, source) {
  const light = normalizeLightConfig(rawLight);
  if (!light || !targetActor) return;
  await runAsGm("setShieldLight", { actorUuid: targetActor.uuid, light, source });
}

/** Lado do Mestre de `requestShieldLight`. O payload vem de outro cliente: normaliza de novo. */
export async function setShieldLightAsGm({ actorUuid, light, source }) {
  const actor = typeof actorUuid === "string" ? await fromUuid(actorUuid) : null;
  const normalized = normalizeLightConfig(light);
  if (!actor || !normalized) return;
  for (const token of tokensOf(actor)) {
    // A luz ORIGINAL do Token só é guardada uma vez: um segundo Escudo por cima não pode fazer a
    // luz do primeiro virar a "original".
    const saved = token.getFlag(SYSTEM_ID, SHIELD_FLAG);
    const previous = saved?.previous ?? token.toObject().light;
    await token.update({
      light: lightSourceData(normalized, resolvedRadius(normalized, SHIELD_DEFAULT_RADIUS)),
      [`flags.${SYSTEM_ID}.${SHIELD_FLAG}`]: {
        previous,
        source: {
          actorUuid: String(source?.actorUuid ?? ""),
          skillId: String(source?.skillId ?? ""),
          subSkillIndex: Number.isInteger(source?.subSkillIndex) ? source.subSkillIndex : null
        }
      }
    });
  }
}

/** Apaga a luz do Escudo de um Token: volta a luz de antes e tira o registro. */
async function clearTokenShieldLight(token) {
  const saved = token.getFlag(SYSTEM_ID, SHIELD_FLAG);
  if (!saved) return;
  await token.update({ light: saved.previous ?? {}, [`flags.${SYSTEM_ID}.-=${SHIELD_FLAG}`]: null });
}

/** Escudo do Ator chegou a 0: apaga a luz dos Tokens dele. Só o Mestre designado. */
export async function clearShieldLightOf(actor) {
  if (!isDesignatedGm()) return;
  for (const token of tokensOf(actor)) await clearTokenShieldLight(token);
}

/** A Skill Ativa que deu o Escudo foi desligada: apaga as luzes que ela acendeu, em qualquer Cena. */
export async function clearShieldLightsFromSourceAsGm({ actorUuid, skillId, subSkillIndex }) {
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      const source = token.getFlag(SYSTEM_ID, SHIELD_FLAG)?.source;
      if (source && source.actorUuid === actorUuid && source.skillId === skillId && (source.subSkillIndex ?? null) === (subSkillIndex ?? null)) {
        await clearTokenShieldLight(token);
      }
    }
  }
}

/** Escudo pessoal zerou (dano, edição à mão, Descanso…): apaga a luz. Chamado no `init`. */
export function registerShieldLightHooks() {
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.attributes.shield.value")) return;
    if ((Number(actor.system?.attributes?.shield?.value) || 0) > 0) return;
    clearShieldLightOf(actor);
  });
}
