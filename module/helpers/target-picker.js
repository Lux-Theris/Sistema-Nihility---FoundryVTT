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

/** Sentinela: o usuário pediu a lista em vez de clicar no mapa. */
const USE_LIST = Symbol("use-list");

/** Token visível sob um ponto do canvas (o de cima, quando há vários empilhados). */
function tokenAtPoint(point, types) {
  const hits = (canvas.tokens?.placeables ?? []).filter(
    token => token.actor && token.visible && token.bounds.contains(point.x, point.y)
  );
  hits.sort((a, b) => (a.document.elevation - b.document.elevation) || (a.document.sort - b.document.sort));
  const top = hits.at(-1);
  if (!top) return null;
  if (types && !types.includes(top.actor.type)) return null;
  return top;
}

/**
 * Modo "clique no alvo": mostra um aviso no topo e espera o usuário clicar num Token do mapa (ou
 * marcá-lo com T, o gesto nativo). Devolve o Ator, `null` (cancelou) ou `USE_LIST`.
 *
 * O clique é interceptado em fase de captura pra não selecionar/arrastar o Token clicado — o
 * usuário está escolhendo um alvo, não mexendo no mapa. Só o botão esquerdo é capturado, então
 * pan e zoom seguem funcionando durante a escolha.
 */
function pickTargetOnMap({ types, title }) {
  return new Promise(resolve => {
    const board = document.getElementById("board");
    if (!board) return resolve(USE_LIST);

    const banner = document.createElement("div");
    banner.className = "nihility-target-banner";
    banner.innerHTML = `
      <span class="nihility-target-banner-text"><strong>${escapeHtml(title)}</strong> — clique no alvo no mapa</span>
      <button type="button" data-choice="list">Escolher da lista</button>
      <button type="button" data-choice="cancel">${escapeHtml("Cancelar")}</button>`;
    document.body.appendChild(banner);

    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      board.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      Hooks.off("targetToken", hookId);
      banner.remove();
      resolve(value);
    };

    const onPointerDown = event => {
      if (event.button !== 0) return;
      const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
      const token = tokenAtPoint(point, types);
      // Clique no vazio (ou em Token de tipo que não serve) não faz nada: segue esperando.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (token) finish(token.actor);
      else ui.notifications.info("Nenhum alvo válido ali — clique em um Token.");
    };
    const onKeyDown = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    const hookId = Hooks.on("targetToken", (user, token, targeted) => {
      if (user.id !== game.user.id || !targeted || !token.actor) return;
      if (types && !types.includes(token.actor.type)) return;
      finish(token.actor);
    });

    banner.addEventListener("click", event => {
      const choice = event.target.closest("[data-choice]")?.dataset.choice;
      if (choice === "list") finish(USE_LIST);
      else if (choice === "cancel") finish(null);
    });
    board.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
  });
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
 * @param {boolean} [options.preferMap] - com a setting de alvo sem Token DESLIGADA e uma cena
 *   aberta, em vez do diálogo espera um clique num Token do mapa (o diálogo segue disponível pelo
 *   botão "Escolher da lista"). Com a setting ligada — mesa de teatro da mente — vai direto pra lista.
 * @returns {Promise<Actor|null>}
 */
export async function pickTargetActor({ self = null, types = null, title = "Escolher Alvo", confirmLabel = "Confirmar", preferMap = false } = {}) {
  // 1) Alvo já marcado no mapa vence tudo — nem abre diálogo.
  const targeted = Array.from(game.user.targets ?? [])
    .map(token => token.actor)
    .filter(actor => actor && (!types || types.includes(actor.type)));
  if (targeted.length) return targeted[0];

  // 1b) Mesa com mapa: clicar no Token é o gesto natural, a lista vira plano B.
  if (preferMap && !offSceneAllowed() && canvas?.ready && canvas.scene) {
    const picked = await pickTargetOnMap({ types, title });
    if (picked !== USE_LIST) return picked;
  }

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
          <select name="targetId">${optionsHtml}</select>
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
