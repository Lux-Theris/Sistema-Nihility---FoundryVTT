import { SYSTEM_ID } from "../config.js";
import {
  generateActorFromAI,
  generateVesselFromAI,
  generateNoteFromAI,
  generateSkillFromAI,
  generateFreeform,
  getAIGeneratedFolder
} from "../ai-helper.js";

const TASKS = {
  npc: { label: "NPC (Personagem/Criatura)", icon: "fa-user" },
  mount: { label: "Montaria", icon: "fa-horse" },
  starship: { label: "Nave Espacial", icon: "fa-rocket" },
  vehicle: { label: "Veículo Terrestre", icon: "fa-car" },
  note: { label: "Nota / Journal", icon: "fa-book" },
  skill: { label: "Habilidade (Skill avulsa)", icon: "fa-bolt" },
  freeform: { label: "Pergunta Livre", icon: "fa-comment-dots" }
};

/**
 * Assistente de IA para o GM: gera NPCs, Montarias, Naves, Veículos, Notas e
 * Skills a partir de um prompt em texto livre, com suporte a geração em lote.
 * Restrito a GM (defesa em profundidade além do botão que já só aparece pra GM).
 */
export class AIAssistantApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-ai-assistant",
      title: "Assistente de IA (GM)",
      template: `systems/${SYSTEM_ID}/templates/apps/ai-assistant.hbs`,
      classes: [SYSTEM_ID, "nihility-config-app", "ai-assistant"],
      width: 520,
      height: "auto",
      resizable: true
    });
  }

  constructor(options) {
    super(options);
    this.results = [];
    this.freeformAnswer = "";
    this.busy = false;
    this.statusText = "";
  }

  /** @override */
  getData() {
    return {
      isGM: game.user.isGM,
      tasks: TASKS,
      results: this.results,
      freeformAnswer: this.freeformAnswer,
      busy: this.busy,
      statusText: this.statusText
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    if (!game.user.isGM) return;

    html.find(".ai-generate").on("click", this._onGenerate.bind(this));
    html.find(".result-open").on("click", this._onOpenResult.bind(this));
  }

  async _onGenerate(event) {
    event.preventDefault();
    if (this.busy) return;

    const task = this.element.find(".task-select").val();
    const prompt = this.element.find(".ai-prompt").val()?.trim();
    if (!prompt) {
      ui.notifications.warn("Escreva um prompt antes de gerar.");
      return;
    }

    const quantity =
      task === "freeform" ? 1 : Math.clamp(Number(this.element.find(".ai-quantity").val()) || 1, 1, 10);

    this.busy = true;
    this.results = [];
    this.freeformAnswer = "";
    this.render(false);

    try {
      if (task === "freeform") {
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
}
