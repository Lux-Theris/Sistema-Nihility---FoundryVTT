/**
 * Loop de agente com tool-calling: manda o prompt pro provedor de IA configurado, executa
 * as tools que o modelo pedir, devolve o resultado e repete até o modelo parar de pedir tools
 * (ou até `maxTurns`). Nunca escreve no Foundry diretamente — só chama os handlers de cada
 * tool (ver agent-tools.js), que decidem o que fazer (ex: só empilhar uma proposta pra
 * revisão, ver módulo/apps/ai-assistant.js).
 */
import { getAISettingsValues } from "../ai-generation.js";
import { callAIProviderWithTools, appendAssistantAndToolResults } from "./providers.js";

/**
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {Array<{name:string, description:string, parameters:object, handler:(input:object)=>Promise<any>}>} opts.tools
 * @param {number} [opts.maxTurns=8]
 * @param {(status:{turn:number, maxTurns:number, toolCalls:Array<{name:string}>})=>void} [opts.onProgress]
 * @returns {Promise<{transcript:Array<object>, finalText:string, truncated:boolean}>}
 */
export async function runAgentTask({ systemPrompt, userPrompt, tools, maxTurns = 8, onProgress }) {
  const settings = getAISettingsValues();
  if (!settings.apiKey) {
    ui.notifications?.warn("Nenhuma chave de API de IA configurada (Configurações do Sistema).");
    throw new Error("Chave de API de IA ausente.");
  }

  const toolDefs = tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  let messages = [{ role: "user", content: userPrompt }];
  const transcript = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    let response;
    try {
      response = await callAIProviderWithTools({ ...settings, systemPrompt, messages, tools: toolDefs });
    } catch (err) {
      console.error(`${settings.provider} | Falha no loop do agente de IA.`, err);
      ui.notifications?.warn("Falha ao contatar o serviço de IA. Confira Provedor/Modelo/Chave nas Configurações.");
      throw err;
    }

    transcript.push({ turn, text: response.text, toolCalls: response.toolCalls });
    onProgress?.({ turn, maxTurns, toolCalls: response.toolCalls });

    if (response.stopReason !== "tool_use" || !response.toolCalls.length) {
      return { transcript, finalText: response.text, truncated: false };
    }

    const toolResults = [];
    for (const call of response.toolCalls) {
      const tool = tools.find(t => t.name === call.name);
      let result;
      try {
        result = tool ? await tool.handler(call.input ?? {}) : { error: `Tool desconhecida: "${call.name}".` };
      } catch (err) {
        result = { error: err.message };
      }
      toolResults.push({ id: call.id, result });
    }

    messages = appendAssistantAndToolResults(settings.provider, messages, response.assistantMessage, toolResults);
  }

  return { transcript, finalText: "", truncated: true };
}
