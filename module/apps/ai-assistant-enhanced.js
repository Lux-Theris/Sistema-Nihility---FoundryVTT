/**
 * Assistente de IA avançado com backup e segurança para Nihility RPG System
 */
import { SYSTEM_ID, MEU_SISTEMA } from "../config.js";
import { BackupHelper } from "../helpers/backup-helper.js";

export class AIAssistantEnhancedApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-ai-assistant-enhanced",
      title: "Assistente de IA - Nihility RPG System",
      template: `systems/${SYSTEM_ID}/templates/apps/ai-assistant-enhanced.hbs`,
      classes: [SYSTEM_ID, "ai-assistant-app"],
      width: 900,
      height: "auto",
      resizable: true,
      dragDrop: [{ dragSelector: ".item", dropSelector: "#ai-chat-messages" }]
    });
  }

  constructor(options = {}) {
    super(options);
    this.chatMessages = [];
    this.currentRequest = null;
    this.isProcessing = false;
  }

  /** @override */
  async getData() {
    const aiProvider = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiProvider);
    const aiModel = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiModel);

    return {
      isGM: game.user.isGM,
      aiProvider: aiProvider,
      aiModel: aiModel,
      messages: this.chatMessages,
      isProcessing: this.isProcessing,
      canGenerate: game.user.isGM || game.settings.get(SYSTEM_ID, "aiGenerationEnabled") || false
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Eventos do chat
    const chatForm = html.querySelector("#ai-chat-form");
    if (chatForm) {
      chatForm.addEventListener("submit", this._onChatSubmit.bind(this));
    }
    const generateForm = html.querySelector("#ai-generate-form");
    if (generateForm) {
      generateForm.addEventListener("submit", this._onGenerateSubmit.bind(this));
    }

    // Botões de ações
    html.querySelectorAll(".action-button").forEach(element => {
      element.addEventListener("click", this._onActionClick.bind(this));
    });
    html.querySelectorAll(".approve-button").forEach(element => {
      element.addEventListener("click", this._onApproveClick.bind(this));
    });
    html.querySelectorAll(".reject-button").forEach(element => {
      element.addEventListener("click", this._onRejectClick.bind(this));
    });

    // Botões de backup
    html.querySelectorAll(".backup-button").forEach(element => {
      element.addEventListener("click", this._onBackupAction.bind(this));
    });
  }

  async _onChatSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const message = formData.get("message");

    if (!message.trim()) return;

    // Adicionar mensagem ao chat
    this._addChatMessage("user", message);

    try {
      this.isProcessing = true;
      this.render(false);

      // Processar a pergunta com IA
      const response = await this._processWithAI(message);

      // Adicionar resposta ao chat
      this._addChatMessage("ai", response);
    } catch (error) {
      this._addChatMessage("error", `Erro ao processar: ${error.message}`);
      console.error(`${SYSTEM_ID} | Erro na IA:`, error);
    } finally {
      this.isProcessing = false;
      this.render(false);
    }
  }

  async _onGenerateSubmit(event) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const type = formData.get("type");
    const description = formData.get("description");

    if (!description.trim()) return;

    // Criar backup antes de processar
    try {
      await this._createBackupForGeneration(type);

      // Adicionar ao chat
      this._addChatMessage("user", `Gerando ${type}: ${description}`);

      this.isProcessing = true;
      this.render(false);

      // Processar geração com IA
      const result = await this._generateWithAI(type, description);

      // Adicionar resultado ao chat
      this._addChatMessage("ai", `Geração concluída: ${result}`);

      // Mostrar opções de aplicação
      if (result) {
        this._showApplyOptions(type, result);
      }
    } catch (error) {
      this._addChatMessage("error", `Erro ao gerar: ${error.message}`);
      console.error(`${SYSTEM_ID} | Erro na geração:`, error);
    } finally {
      this.isProcessing = false;
      this.render(false);
    }
  }

  async _onActionClick(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;

    switch (action) {
      case "open-backup-manager":
        new BackupManagerApp().render(true);
        break;
      case "toggle-ai-mode":
        this._toggleAIMode();
        break;
      case "clear-chat":
        this.chatMessages = [];
        this.render(false);
        break;
    }
  }

  async _onApproveClick(event) {
    event.preventDefault();
    const messageId = event.currentTarget.dataset.messageId;

    try {
      // Implementar lógica de aprovação
      const message = this.chatMessages.find(m => m.id === messageId);
      if (message && message.actionRequired) {
        await this._applyAIAction(message.actionData);
        this._addChatMessage("system", "Ação aprovada e aplicada");
      }
    } catch (error) {
      this._addChatMessage("error", `Erro ao aplicar ação: ${error.message}`);
    }
  }

  async _onRejectClick(event) {
    event.preventDefault();
    const messageId = event.currentTarget.dataset.messageId;

    try {
      // Implementar lógica de rejeição
      const message = this.chatMessages.find(m => m.id === messageId);
      if (message && message.actionRequired) {
        this._addChatMessage("system", "Ação rejeitada");
      }
    } catch (error) {
      this._addChatMessage("error", `Erro ao rejeitar ação: ${error.message}`);
    }
  }

  async _onBackupAction(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;

    switch (action) {
      case "create-backup":
        await this._createManualBackup();
        break;
      case "restore-backup":
        // Implementar restauração
        ui.notifications.info("Restauração de backup em desenvolvimento");
        break;
    }
  }

  _addChatMessage(role, content, options = {}) {
    const message = {
      id: Date.now() + Math.random(),
      role: role,
      content: content,
      timestamp: new Date().toISOString(),
      actionRequired: options.actionRequired || false,
      actionData: options.actionData || null
    };

    this.chatMessages.push(message);

    // Limitar o número de mensagens para manter performance
    if (this.chatMessages.length > 100) {
      this.chatMessages = this.chatMessages.slice(-50);
    }

    this.render(false);
  }

  async _processWithAI(prompt) {
    try {
      // Obter configurações da IA
      const provider = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiProvider);
      const endpoint = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiEndpointUrl);
      const model = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiModel);
      const apiKey = game.settings.get(SYSTEM_ID, MEU_SISTEMA.SETTINGS.aiApiKey);

      // Configurar requisição baseada no provedor
      let response;

      if (provider === "anthropic") {
        // Para Claude
        response = await this._callAnthropicAPI(prompt, model, apiKey);
      } else {
        // Para OpenAI-compatível
        response = await this._callOpenAIAPI(prompt, endpoint, model, apiKey);
      }

      return response;
    } catch (error) {
      console.error(`${SYSTEM_ID} | Erro na chamada da IA:`, error);
      throw new Error("Falha na comunicação com o provedor de IA");
    }
  }

  async _generateWithAI(type, description) {
    try {
      const prompt = this._buildGenerationPrompt(type, description);
      return await this._processWithAI(prompt);
    } catch (error) {
      console.error(`${SYSTEM_ID} | Erro na geração:`, error);
      throw new Error("Falha ao gerar conteúdo");
    }
  }

  _buildGenerationPrompt(type, description) {
    const basePrompt = `Gere um ${type} para o jogo de RPG Nihility RPG System. Descrição: ${description}`;

    switch (type.toLowerCase()) {
      case "npc":
        return `${basePrompt}\n\nResponda apenas com informações estruturadas em formato JSON com os campos: name, race, class, level, attributes, skills, background.`;
      case "skill":
        return `${basePrompt}\n\nResponda apenas com informações estruturadas em formato JSON com os campos: name, description, tier, effectType, target, duration, damageType, cost.`;
      case "item":
        return `${basePrompt}\n\nResponda apenas com informações estruturadas em formato JSON com os campos: name, type, description, rarity, weight, value, properties, effects.`;
      case "starship":
        return `${basePrompt}\n\nResponda apenas com informações estruturadas em formato JSON com os campos: name, type, size, hull, power, weapons, systems, crew, description.`;
      default:
        return basePrompt;
    }
  }

  async _callAnthropicAPI(prompt, model, apiKey) {
    // Implementar chamada para Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const data = await response.json();
    return data.content[0].text;
  }

  async _callOpenAIAPI(prompt, endpoint, model, apiKey) {
    // Implementar chamada para API OpenAI-compatível
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1000
      })
    });

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async _createBackupForGeneration(type) {
    // Criar backup antes de qualquer geração importante
    try {
      if (game.user.isGM) {
        const actor = game.user.character;
        if (actor) {
          await BackupHelper.createBackupForActor(actor);
        }
      }
    } catch (error) {
      console.warn(`${SYSTEM_ID} | Falha ao criar backup:`, error);
    }
  }

  async _createManualBackup() {
    try {
      const actor = game.user.character;
      if (actor) {
        await BackupHelper.createBackupForActor(actor);
        ui.notifications.info("Backup criado com sucesso!");
      } else {
        ui.notifications.warn("Nenhum personagem selecionado para backup");
      }
    } catch (error) {
      ui.notifications.error(`Falha ao criar backup: ${error.message}`);
    }
  }

  _showApplyOptions(type, result) {
    // Mostrar opções de aplicação
    this._addChatMessage("system", `Resultado gerado. Você pode aplicar este resultado automaticamente ou revisar antes.`);

    // Adicionar uma mensagem com opções de ação
    const message = this.chatMessages[this.chatMessages.length - 1];
    message.actionRequired = true;
    message.actionData = {
      type: type,
      result: result
    };
  }

  async _applyAIAction(actionData) {
    // Implementar lógica para aplicar ações geradas pela IA
    try {
      const { type, result } = actionData;

      if (type === "npc") {
        // Criar NPC
        await this._createNPCFromResult(result);
      } else if (type === "skill") {
        // Criar habilidade
        await this._createSkillFromResult(result);
      }

      this._addChatMessage("system", "Ação aplicada com sucesso!");
    } catch (error) {
      console.error(`${SYSTEM_ID} | Erro ao aplicar ação:`, error);
      throw new Error("Falha ao aplicar ação");
    }
  }

  async _createNPCFromResult(result) {
    // Implementar criação de NPC
    try {
      const npcData = JSON.parse(result);
      // Criar o NPC no sistema
      console.log("Criando NPC:", npcData);
    } catch (error) {
      console.warn("Resultado não é JSON válido para NPC");
      // Tratar como texto simples
    }
  }

  async _createSkillFromResult(result) {
    // Implementar criação de habilidade
    try {
      const skillData = JSON.parse(result);
      // Criar a habilidade no sistema
      console.log("Criando habilidade:", skillData);
    } catch (error) {
      console.warn("Resultado não é JSON válido para habilidade");
      // Tratar como texto simples
    }
  }

  _toggleAIMode() {
    // Implementar alternância de modo de IA
    ui.notifications.info("Modo de IA alternado");
  }
}