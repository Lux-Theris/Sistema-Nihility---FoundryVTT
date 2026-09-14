/**
 * Escolha de alvo, compartilhada por ficha de Personagem e de Nave.
 *
 * Antes, todo alvo saía só de `sceneActorCandidates()` — quem tem Token na cena aberta. Numa mesa
 * de teatro da mente, sem mapa e sem token (comum justamente em campanha medieval), isso deixava
 * a lista VAZIA: não dava pra usar Habilidade em ninguém, e a mecânica inteira de Resistência
 * ficava inalcançável.
 *
 * O que mudou, em três camadas:
 *  1. Se já existe alvo marcado no mapa (`game.user.targets`), nem abre diálogo — é o gesto
 *     padrão do Foundry e economiza um clique em toda Skill.
 *  2. O diálogo abre com grupos curtos e fechados (na cena / seus personagens / PJs), que juntos
 *     raramente passam de uma dúzia.
 *  3. O resto do mundo só existe atrás da busca, e com teto — é o que impede a lista de virar
 *     centenas de linhas num mundo com muitos NPCs.
 */
import { SYSTEM_ID, MEU_SISTEMA, sceneActorCandidates } from "../config.js";

const { DialogV2 } = foundry.applications.api;

/** Teto de resultados do grupo "Diretório" — busca que traz mais que isso pede refino, não scroll. */
const DIRECTORY_LIMIT = 20;

/** Mínimo de caracteres pra busca varrer o diretório do mundo. */
const SEARCH_MIN = 2;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** A setting que libera alvos sem Token na cena (padrão desligado — o comportamento de sempre). */
function offSceneAllowed() {
  try {
    return Boolean(game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.allowOffSceneTargets));
  } catch (err) {
    return false;
  }
}

/**
 * Grupos fixos do diálogo. São curtos por construção: cena, os personagens do próprio usuário e
 * os PJs. Um mesmo Ator pode aparecer em mais de um grupo — é intencional, cada grupo responde a
 * uma pergunta diferente ("quem está aqui?" vs "quem é meu?").
 */
function buildGroups(self, types) {
  const matchesType = actor => !types || types.includes(actor.type);

  const scene = sceneActorCandidates({ types, excludeActorId: null });
  const mine = game.actors.filter(a => matchesType(a) && a.isOwner && a.id !== self?.id);
  const pcs = game.actors.filter(
    a => matchesType(a) && a.type === "character" && a.system?.isPlayerCharacter === true && a.testUserPermission(game.user, "LIMITED")
  );

  return [
    { label: "Na cena", actors: scene },
    { label: "Meus personagens", actors: mine },
    { label: "Personagens", actors: pcs }
  ].filter(group => group.actors.length);
}

/** Monta as <option> de um grupo, marcando o próprio Ator quando ele aparece. */
function optionsFor(actors, self, seen) {
  return actors
    .filter(actor => {
      if (seen.has(actor.id)) return false;
      seen.add(actor.id);
      return true;
    })
    .map(actor => {
      const isSelf = actor.id === self?.id;
      return `<option value="${actor.id}" ${isSelf ? "selected" : ""}>${escapeHtml(actor.name)}${isSelf ? " (você mesmo)" : ""}</option>`;
    })
    .join("");
}

/**
 * Abre a escolha de alvo e devolve o Ator escolhido (ou `null`).
 *
 * @param {object} [options]
 * @param {Actor} [options.self] - o Ator que está agindo; entra sempre na lista e vem pré-selecionado
 *   (buff/dano em si mesmo tem que funcionar mesmo sem Token na cena)
 * @param {string[]} [options.types] - filtra por `actor.type`
 * @param {string} [options.title]
 * @param {string} [options.confirmLabel]
 * @returns {Promise<Actor|null>}
 */
export async function pickTargetActor({ self = null, types = null, title = "Escolher Alvo", confirmLabel = "Confirmar" } = {}) {
  // 1) Alvo já marcado no mapa vence tudo — nem abre diálogo.
  const targeted = Array.from(game.user.targets ?? [])
    .map(token => token.actor)
    .filter(actor => actor && (!types || types.includes(actor.type)));
  if (targeted.length) return targeted[0];

  const seen = new Set();
  const groups = buildGroups(self, types);

  // O próprio Ator entra sempre, no topo, mesmo sem Token na cena.
  let optionsHtml = self ? optionsFor([self], self, seen) : "";
  for (const group of groups) {
    const html = optionsFor(group.actors, self, seen);
    if (html) optionsHtml += `<optgroup label="${escapeHtml(group.label)}">${html}</optgroup>`;
  }

  const canSearch = offSceneAllowed();
  const searchHtml = canSearch
    ? `<div class="form-group">
         <label>Buscar no diretório</label>
         <input type="text" class="target-search" placeholder="digite ${SEARCH_MIN}+ letras…" autocomplete="off"/>
         <span class="hint-inline target-search-note">Só quem está na cena aparece até você buscar.</span>
       </div>`
    : "";

  const chosenId = await DialogV2.wait({
    window: { title },
    content: `
      <form class="nihility-target-picker">
        ${searchHtml}
        <div class="form-group">
          <label>Alvo</label>
          <select name="targetId" size="8">${optionsHtml}</select>
        </div>
      </form>`,
    buttons: [
      {
        action: "confirm",
        label: confirmLabel,
        default: true,
        callback: (event, button, dialog) => dialog.element.querySelector("[name=targetId]")?.value ?? null
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false,
    render: (event, dialog) => {
      if (!canSearch) return;
      const root = dialog?.element ?? dialog;
      const search = root?.querySelector?.(".target-search");
      const select = root?.querySelector?.("[name=targetId]");
      if (!search || !select) return;

      // O grupo do diretório é montado e remontado a cada busca, em vez de nascer no DOM com o
      // mundo inteiro dentro — é o que mantém o diálogo leve num mundo com centenas de NPCs.
      let directoryGroup = null;
      search.addEventListener("input", () => {
        const query = search.value.trim().toLowerCase();
        directoryGroup?.remove();
        directoryGroup = null;
        if (query.length < SEARCH_MIN) return;

        const matches = game.actors.filter(
          a => (!types || types.includes(a.type)) && a.name.toLowerCase().includes(query) && !seen.has(a.id)
        );
        if (!matches.length) return;

        directoryGroup = document.createElement("optgroup");
        const shown = matches.slice(0, DIRECTORY_LIMIT);
        directoryGroup.label =
          matches.length > DIRECTORY_LIMIT
            ? `Diretório — ${shown.length} de ${matches.length} (refine a busca)`
            : `Diretório — ${shown.length}`;
        for (const actor of shown) {
          const option = document.createElement("option");
          option.value = actor.id;
          option.textContent = actor.name;
          directoryGroup.appendChild(option);
        }
        select.appendChild(directoryGroup);
      });
    }
  });

  if (!chosenId) return null;
  return game.actors.get(chosenId) ?? null;
}
