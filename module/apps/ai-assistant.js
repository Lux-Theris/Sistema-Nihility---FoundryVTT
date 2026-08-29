import { SYSTEM_ID, debugLog } from "../config.js";
import {
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  generateSkillFromAI,
  generateItemFromAI,
  generateFreeform,
  getAIGeneratedFolder,
  editDocumentWithAI
} from "../ai-generation.js";
import { registerItemInCompendium } from "../compendium.js";
import { runAgentTask } from "../ai/agent-runner.js";
import { createAgentTools } from "../ai/agent-tools.js";
import { recordBatchOperation, undoBatchOperation, listRecentBatchOperations } from "../helpers/world-backup.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TASKS = {
  npc: { label: "NPC (Personagem/Criatura)", icon: "fa-user" },
  mount: { label: "Montaria", icon: "fa-horse" },
  starship: { label: "Nave Espacial", icon: "fa-rocket" },
  vehicle: { label: "Veículo Terrestre", icon: "fa-car" },
  note: { label: "Nota / Journal", icon: "fa-book" },
  item: { label: "Item Genérico", icon: "fa-box" },
  skill: { label: "Habilidade (Skill avulsa)", icon: "fa-bolt" },
  freeform: { label: "Pergunta Livre", icon: "fa-comment-dots" }
};

const AGENT_SYSTEM_PROMPT =
  "Você é o motor de regras de um RPG de Foundry VTT (Nihility RPG System), agindo como assistente do Mestre. " +
  "Você tem tools pra consultar o sistema (list_skills, list_actors, get_system_rules) e pra propor criação/edição " +
  "de conteúdo (propose_skill, propose_character, propose_edit). NADA que você propõe é criado de verdade até o " +
  "Mestre revisar e aplicar manualmente — pode propor livremente o que for pedido. Sempre consulte get_system_rules " +
  "antes de propor uma Skill (pra usar tier/effectType válidos) e list_skills antes de criar uma Skill nova (pra " +
  "não duplicar um nome/conceito já existente). Se o Mestre pedir múltiplos itens (ex: \"3 skills e 2 personagens\"), " +
  "chame a tool de proposta correspondente uma vez por item. Quando terminar de propor tudo que foi pedido, " +
  "responda um resumo curto em texto corrido (sem mais tool calls).";

/**
 * Assistente de IA para o GM: três modos —
 *  - "create": gera N documentos do mesmo tipo a partir de um prompt (sem revisão, aplica direto).
 *  - "edit": edita um Ator/Item já existente via instrução em texto livre.
 *  - "agent": agente com tool-calling multi-turno, capaz de propor uma mistura de Skills/
 *    Personagens/edições a partir de um único pedido (ex: "crie 3 skills e 2 personagens") —
 *    fica em revisão até o Mestre aprovar, e a aplicação vira uma operação desfazível.
 * Restrito a GM (defesa em profundidade além do botão que já só aparece pra GM).
 * Migrado pra ApplicationV2 — sem <form> nativo (os botões leem o DOM na hora do clique).
 */
export class AIAssistantApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "nihility-ai-assistant",
    window: { title: "Assistente de IA (GM)", resizable: true },
    // "ai-assistant-app" (não "ai-assistant") de propósito — é a classe que styles/*.css já
    // usa em ~150 linhas de estilo (.ai-assistant-app .mode-toggle, .ai-generate, etc.); um
    // nome diferente aqui faria tudo isso silenciosamente não bater com nada.
    classes: [SYSTEM_ID, "nihility-config-app", "ai-assistant-app"],
    position: { width: 560, height: "auto" },
    actions: {
      selectMode: AIAssistantApp.#onSelectMode,
      clearEditTarget: AIAssistantApp.#onClearEditTarget,
      generate: AIAssistantApp.#onGenerate,
      openResult: AIAssistantApp.#onOpenResult,
      runAgent: AIAssistantApp.#onAgentRun,
      applyProposals: AIAssistantApp.#onApplyProposals,
      undoOperation: AIAssistantApp.#onUndoOperation
    }
  };

  static PARTS = {
    body: { template: `systems/${SYSTEM_ID}/templates/apps/ai-assistant.hbs`, scrollable: [".ai-assistant-body"] }
  };

  constructor(options = {}) {
    super(options);
    this.mode = options.initialMode ?? "create"; // "create" | "edit" | "agent"
    this.initialTask = options.initialTask ?? null; // pré-seleciona a Tarefa no modo "create"
    this.editTarget = null; // {uuid, name, img, documentName} — Ator/Item arrastado pro modo Editar
    this.results = [];
    this.freeformAnswer = "";
    this.busy = false;
    this.statusText = "";

    // Modo "agent"
    this.agentProposals = []; // [{type, data, include}]
    this.agentTranscriptText = "";
    this.recentOperations = [];
    this._agentOperationsLoaded = false;

    if (this.mode === "agent") this._loadRecentOperations();
  }

  _loadRecentOperations() {
    this._agentOperationsLoaded = true;
    listRecentBatchOperations(5).then(ops => {
      this.recentOperations = ops;
      this.render();
    });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    Object.assign(context, {
      isGM: game.user.isGM,
      tasks: TASKS,
      isCreateMode: this.mode === "create",
      isEditMode: this.mode === "edit",
      isAgentMode: this.mode === "agent",
      initialTask: this.initialTask,
      editTarget: this.editTarget,
      results: this.results,
      freeformAnswer: this.freeformAnswer,
      busy: this.busy,
      statusText: this.statusText,
      agentProposals: this.agentProposals,
      agentHasProposals: this.agentProposals.length > 0,
      agentTranscriptText: this.agentTranscriptText,
      recentOperations: this.recentOperations
    });
    debugLog(`${SYSTEM_ID} | AIAssistantApp._prepareContext, modo:`, this.mode);
    return context;
  }

  /**
   * @override
   * Eventos que não são clique-em-data-action (drag&drop do alvo de edição, checkbox de
   * incluir/excluir proposta) precisam ser ligados manualmente a cada render.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!game.user.isGM) return;

    const dropzone = this.element.querySelector(".ai-edit-dropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", event => event.preventDefault());
      dropzone.addEventListener("drop", this._onDropEditTarget.bind(this));
    }

    this.element.querySelectorAll(".proposal-toggle").forEach(checkbox => {
      checkbox.addEventListener("change", this._onToggleProposal.bind(this));
    });
  }

  static #onSelectMode(event, target) {
    event.preventDefault();
    this.mode = target.dataset.mode;
    this.results = [];
    this.freeformAnswer = "";

    if (this.mode === "agent" && !this._agentOperationsLoaded) this._loadRecentOperations();

    this.render();
  }

  /** Recebe um Ator ou Item arrastado da barra lateral/ficha como alvo de edição. */
  async _onDropEditTarget(event) {
    event.preventDefault();
    let data;
    try {
      data = TextEditor.getDragEventData(event);
    } catch (err) {
      return;
    }
    if (!data?.uuid) return;

    const doc = await fromUuid(data.uuid);
    if (!doc || !["Actor", "Item"].includes(doc.documentName)) {
      ui.notifications.warn("Só é possível editar Atores ou Itens por aqui.");
      return;
    }

    this.editTarget = { uuid: doc.uuid, name: doc.name, img: doc.img, documentName: doc.documentName };
    this.render();
  }

  static #onClearEditTarget(event, target) {
    event.preventDefault();
    this.editTarget = null;
    this.render();
  }

  static async #onGenerate(event, target) {
    event.preventDefault();
    if (this.busy) return;

    const prompt = this.element.querySelector(".ai-prompt")?.value.trim();
    if (!prompt) {
      ui.notifications.warn("Escreva um prompt antes de gerar.");
      return;
    }

    if (this.mode === "edit" && !this.editTarget) {
      ui.notifications.warn("Arraste um Ator ou Item pro campo antes de aplicar a alteração.");
      return;
    }

    const task = this.element.querySelector(".task-select")?.value;
    const quantity =
      this.mode === "edit" || task === "freeform"
        ? 1
        : Math.clamp(Number(this.element.querySelector(".ai-quantity")?.value) || 1, 1, 10);

    this.busy = true;
    this.results = [];
    this.freeformAnswer = "";
    this.render();

    try {
      if (this.mode === "edit") {
        this.statusText = "Aplicando alteração...";
        this.render();
        const doc = await fromUuid(this.editTarget.uuid);
        if (!doc) {
          ui.notifications.warn("O documento selecionado não existe mais.");
        } else {
          const { patch } = await editDocumentWithAI(doc, prompt);
          this.results.push({
            name: doc.name,
            uuid: doc.uuid,
            icon: doc.documentName === "Actor" ? "fa-user" : "fa-box",
            changedKeys: Object.keys(patch).join(", ")
          });
        }
      } else if (task === "freeform") {
        this.freeformAnswer = await generateFreeform(prompt);
      } else {
        for (let i = 0; i < quantity; i++) {
          this.statusText = quantity > 1 ? `Gerando ${i + 1}/${quantity}...` : "Gerando...";
          this.render();
          const doc = await this._runTask(task, prompt, i, quantity);
          if (doc) this.results.push({ name: doc.name, uuid: doc.uuid, icon: TASKS[task].icon });
        }
      }
    } catch (err) {
      console.error(`${SYSTEM_ID} | Assistente de IA falhou.`, err);
    } finally {
      this.busy = false;
      this.statusText = "";
      this.render();
    }
  }

  async _runTask(task, prompt, index, total) {
    const variedPrompt =
      total > 1 ? `${prompt} (variação ${index + 1} de ${total}; diferente das anteriores)` : prompt;

    switch (task) {
      case "npc":
        return generateActorFromAI(variedPrompt, { isMount: false, folder: await getAIGeneratedFolder("Actor") });
      case "mount":
        return generateActorFromAI(variedPrompt, { isMount: true, folder: await getAIGeneratedFolder("Actor") });
      case "starship":
        return generateVesselFromAI(variedPrompt, "starship", { folder: await getAIGeneratedFolder("Actor") });
      case "vehicle":
        return generateVesselFromAI(variedPrompt, "vehicle", { folder: await getAIGeneratedFolder("Actor") });
      case "note":
        return generateNoteFromAI(variedPrompt, { folder: await getAIGeneratedFolder("JournalEntry") });
      case "item":
        return generateItemFromAI(variedPrompt, { folder: await getAIGeneratedFolder("Item") });
      case "skill":
        return generateSkillFromAI(variedPrompt);
      default:
        return null;
    }
  }

  static async #onOpenResult(event, target) {
    event.preventDefault();
    const uuid = target.dataset.uuid;
    const doc = await fromUuid(uuid);
    doc?.sheet?.render(true);
  }

  /* -------------------------------------------- */
  /*  Modo "agent": tool-calling + revisão em lote */
  /* -------------------------------------------- */

  static async #onAgentRun(event, target) {
    event.preventDefault();
    if (this.busy) return;

    const prompt = this.element.querySelector(".ai-agent-prompt")?.value.trim();
    if (!prompt) {
      ui.notifications.warn("Escreva um pedido antes de executar.");
      return;
    }

    this.busy = true;
    this.agentProposals = [];
    this.agentTranscriptText = "";
    this.statusText = "Pensando...";
    this.render();

    const { tools, proposals } = createAgentTools();
    try {
      const { finalText, truncated } = await runAgentTask({
        systemPrompt: AGENT_SYSTEM_PROMPT,
        userPrompt: prompt,
        tools,
        onProgress: ({ turn, maxTurns, toolCalls }) => {
          this.statusText = `Rodada ${turn + 1}/${maxTurns}${toolCalls.length ? ` — usando: ${toolCalls.map(t => t.name).join(", ")}` : ""}`;
          this.render();
        }
      });

      this.agentTranscriptText = truncated
        ? "O assistente atingiu o limite de rodadas antes de terminar — revise o que foi proposto até aqui."
        : finalText;
      this.agentProposals = proposals.map(p => ({ ...p, include: true }));
      debugLog(`${SYSTEM_ID} | AIAssistantApp (agente): ${this.agentProposals.length} proposta(s).`, this.agentProposals);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Assistente de IA (agente) falhou.`, err);
    } finally {
      this.busy = false;
      this.statusText = "";
      this.render();
    }
  }

  _onToggleProposal(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.agentProposals[index]) this.agentProposals[index].include = event.currentTarget.checked;
  }

  static async #onApplyProposals(event, target) {
    event.preventDefault();
    const selected = this.agentProposals.filter(p => p.include);
    if (!selected.length) {
      ui.notifications.warn("Nenhuma proposta selecionada.");
      return;
    }

    this.busy = true;
    this.statusText = "Aplicando...";
    this.render();

    const backupEntries = [];
    const applied = [];
    try {
      for (const proposal of selected) {
        if (proposal.type === "skill") {
          const created = await registerItemInCompendium(proposal.data);
          if (created) {
            backupEntries.push({ action: "create", uuid: created.uuid });
            applied.push({ name: created.name, uuid: created.uuid, icon: "fa-bolt" });
          }
        } else if (proposal.type === "character") {
          const folder = await getAIGeneratedFolder("Actor");
          const created = await Actor.create({ ...proposal.data, folder: folder?.id ?? null });
          if (created) {
            backupEntries.push({ action: "create", uuid: created.uuid });
            applied.push({ name: created.name, uuid: created.uuid, icon: "fa-user" });
          }
        } else if (proposal.type === "edit") {
          const doc = await fromUuid(proposal.data.uuid);
          if (!doc) continue;
          const previousData = { name: doc.name, img: doc.img, system: doc.toObject().system };
          await doc.update(proposal.data.patch);
          backupEntries.push({ action: "update", uuid: doc.uuid, previousData });
          applied.push({ name: doc.name, uuid: doc.uuid, icon: doc.documentName === "Actor" ? "fa-user" : "fa-box" });
        }
      }

      if (backupEntries.length) await recordBatchOperation(backupEntries);
      this.results = applied;
      this.agentProposals = [];
      this.recentOperations = await listRecentBatchOperations(5);
      ui.notifications.info(`${applied.length} documento(s) criado(s)/editado(s).`);
      debugLog(`${SYSTEM_ID} | AIAssistantApp: ${applied.length} proposta(s) aplicada(s).`, applied);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao aplicar propostas do Assistente de IA.`, err);
      ui.notifications.error("Falha ao aplicar as propostas selecionadas.");
    } finally {
      this.busy = false;
      this.statusText = "";
      this.render();
    }
  }

  static async #onUndoOperation(event, target) {
    event.preventDefault();
    const operationId = target.dataset.operationId;
    if (!operationId) return;

    const confirmed = await DialogV2.confirm({
      window: { title: "Desfazer Operação" },
      content: "<p>Isso apaga os documentos que essa operação criou e restaura os que ela editou. Confirma?</p>"
    });
    if (!confirmed) return;

    try {
      await undoBatchOperation(operationId);
      ui.notifications.info("Operação desfeita.");
      this.recentOperations = await listRecentBatchOperations(5);
      this.render();
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao desfazer operação.`, err);
      ui.notifications.error(`Falha ao desfazer: ${err.message}`);
    }
  }
}
