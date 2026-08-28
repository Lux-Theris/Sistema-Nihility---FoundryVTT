import { SYSTEM_ID } from "../config.js";
import {
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  generateSkillFromAI,
  generateFreeform,
  getAIGeneratedFolder,
  editDocumentWithAI,
  registerItemInCompendium
} from "../ai-helper.js";
import { runAgentTask } from "../ai/agent-runner.js";
import { createAgentTools } from "../ai/agent-tools.js";
import { recordBatchOperation, undoBatchOperation, listRecentBatchOperations } from "../helpers/world-backup.js";

const TASKS = {
  npc: { label: "NPC (Personagem/Criatura)", icon: "fa-user" },
  mount: { label: "Montaria", icon: "fa-horse" },
  starship: { label: "Nave Espacial", icon: "fa-rocket" },
  vehicle: { label: "Veículo Terrestre", icon: "fa-car" },
  note: { label: "Nota / Journal", icon: "fa-book" },
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
 */
export class AIAssistantApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-ai-assistant",
      title: "Assistente de IA (GM)",
      template: `systems/${SYSTEM_ID}/templates/apps/ai-assistant.hbs`,
      classes: [SYSTEM_ID, "nihility-config-app", "ai-assistant"],
      width: 560,
      height: "auto",
      resizable: true
    });
  }

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
      this.render(false);
    });
  }

  /** @override */
  getData() {
    return {
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
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!game.user.isGM) return;

    html.find(".mode-btn").on("click", this._onModeChange.bind(this));
    html.find(".ai-edit-dropzone").on("dragover", event => event.preventDefault());
    html.find(".ai-edit-dropzone").on("drop", this._onDropEditTarget.bind(this));
    html.find(".ai-edit-clear").on("click", this._onClearEditTarget.bind(this));
    html.find(".ai-generate").on("click", this._onGenerate.bind(this));
    html.find(".result-open").on("click", this._onOpenResult.bind(this));

    html.find(".ai-agent-run").on("click", this._onAgentRun.bind(this));
    html.find(".proposal-toggle").on("change", this._onToggleProposal.bind(this));
    html.find(".ai-agent-apply").on("click", this._onApplyProposals.bind(this));
    html.find(".ai-undo-operation").on("click", this._onUndoOperation.bind(this));
  }

  _onModeChange(event) {
    event.preventDefault();
    this.mode = event.currentTarget.dataset.mode;
    this.results = [];
    this.freeformAnswer = "";

    if (this.mode === "agent" && !this._agentOperationsLoaded) this._loadRecentOperations();

    this.render(false);
  }

  /** Recebe um Ator ou Item arrastado da barra lateral/ficha como alvo de edição. */
  async _onDropEditTarget(event) {
    event.preventDefault();
    let data;
    try {
      data = TextEditor.getDragEventData(event.originalEvent ?? event);
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
    this.render(false);
  }

  _onClearEditTarget(event) {
    event.preventDefault();
    this.editTarget = null;
    this.render(false);
  }

  async _onGenerate(event) {
    event.preventDefault();
    if (this.busy) return;

    const prompt = this.element.find(".ai-prompt").val()?.trim();
    if (!prompt) {
      ui.notifications.warn("Escreva um prompt antes de gerar.");
      return;
    }

    if (this.mode === "edit" && !this.editTarget) {
      ui.notifications.warn("Arraste um Ator ou Item pro campo antes de aplicar a alteração.");
      return;
    }

    const task = this.element.find(".task-select").val();
    const quantity =
      this.mode === "edit" || task === "freeform"
        ? 1
        : Math.clamp(Number(this.element.find(".ai-quantity").val()) || 1, 1, 10);

    this.busy = true;
    this.results = [];
    this.freeformAnswer = "";
    this.render(false);

    try {
      if (this.mode === "edit") {
        this.statusText = "Aplicando alteração...";
        this.render(false);
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
          this.render(false);
          const doc = await this._runTask(task, prompt, i, quantity);
          if (doc) this.results.push({ name: doc.name, uuid: doc.uuid, icon: TASKS[task].icon });
        }
      }
    } catch (err) {
      console.error(`${SYSTEM_ID} | Assistente de IA falhou.`, err);
    } finally {
      this.busy = false;
      this.statusText = "";
      this.render(false);
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
      case "skill":
        return generateSkillFromAI(variedPrompt);
      default:
        return null;
    }
  }

  async _onOpenResult(event) {
    event.preventDefault();
    const uuid = event.currentTarget.dataset.uuid;
    const doc = await fromUuid(uuid);
    doc?.sheet?.render(true);
  }

  /* -------------------------------------------- */
  /*  Modo "agent": tool-calling + revisão em lote */
  /* -------------------------------------------- */

  async _onAgentRun(event) {
    event.preventDefault();
    if (this.busy) return;

    const prompt = this.element.find(".ai-agent-prompt").val()?.trim();
    if (!prompt) {
      ui.notifications.warn("Escreva um pedido antes de executar.");
      return;
    }

    this.busy = true;
    this.agentProposals = [];
    this.agentTranscriptText = "";
    this.statusText = "Pensando...";
    this.render(false);

    const { tools, proposals } = createAgentTools();
    try {
      const { finalText, truncated } = await runAgentTask({
        systemPrompt: AGENT_SYSTEM_PROMPT,
        userPrompt: prompt,
        tools,
        onProgress: ({ turn, maxTurns, toolCalls }) => {
          this.statusText = `Rodada ${turn + 1}/${maxTurns}${toolCalls.length ? ` — usando: ${toolCalls.map(t => t.name).join(", ")}` : ""}`;
          this.render(false);
        }
      });

      this.agentTranscriptText = truncated
        ? "O assistente atingiu o limite de rodadas antes de terminar — revise o que foi proposto até aqui."
        : finalText;
      this.agentProposals = proposals.map(p => ({ ...p, include: true }));
    } catch (err) {
      console.error(`${SYSTEM_ID} | Assistente de IA (agente) falhou.`, err);
    } finally {
      this.busy = false;
      this.statusText = "";
      this.render(false);
    }
  }

  _onToggleProposal(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.agentProposals[index]) this.agentProposals[index].include = event.currentTarget.checked;
  }

  async _onApplyProposals(event) {
    event.preventDefault();
    const selected = this.agentProposals.filter(p => p.include);
    if (!selected.length) {
      ui.notifications.warn("Nenhuma proposta selecionada.");
      return;
    }

    this.busy = true;
    this.statusText = "Aplicando...";
    this.render(false);

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
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao aplicar propostas do Assistente de IA.`, err);
      ui.notifications.error("Falha ao aplicar as propostas selecionadas.");
    } finally {
      this.busy = false;
      this.statusText = "";
      this.render(false);
    }
  }

  async _onUndoOperation(event) {
    event.preventDefault();
    const operationId = event.currentTarget.dataset.operationId;
    if (!operationId) return;

    const confirmed = await Dialog.confirm({
      title: "Desfazer Operação",
      content: "<p>Isso apaga os documentos que essa operação criou e restaura os que ela editou. Confirma?</p>"
    });
    if (!confirmed) return;

    try {
      await undoBatchOperation(operationId);
      ui.notifications.info("Operação desfeita.");
      this.recentOperations = await listRecentBatchOperations(5);
      this.render(false);
    } catch (err) {
      console.error(`${SYSTEM_ID} | Falha ao desfazer operação.`, err);
      ui.notifications.error(`Falha ao desfazer: ${err.message}`);
    }
  }
}
