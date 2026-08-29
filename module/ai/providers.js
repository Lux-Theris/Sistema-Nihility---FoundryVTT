/**
 * Adaptadores de provedor de IA. Cada um sabe montar a requisição certa e
 * extrair o texto de resposta do seu formato; `callAIProvider` é o único
 * ponto de entrada usado pelo resto do sistema (ver ai-generation.js).
 */

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

async function callOpenAICompatible({ endpoint, apiKey, model, systemPrompt, userPrompt, expectJSON }) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  if (expectJSON) body.response_format = { type: "json_object" };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Endpoint de IA retornou HTTP ${response.status}`);

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic({ apiKey, model, systemPrompt, userPrompt }) {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      // Necessário para chamadas feitas diretamente do navegador (cliente do Foundry).
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  if (!response.ok) throw new Error(`Endpoint Anthropic retornou HTTP ${response.status}`);

  const payload = await response.json();
  return (payload?.content ?? []).map(block => block?.text ?? "").join("");
}

/**
 * Ponto único de chamada à IA, roteando para o adaptador do provedor configurado.
 * @param {object} opts
 * @param {"openai"|"anthropic"} opts.provider
 * @param {string} [opts.endpoint] - usado apenas pelo adaptador "openai"
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {boolean} [opts.expectJSON=true]
 * @returns {Promise<string>} texto bruto retornado pelo modelo
 */
export async function callAIProvider({
  provider,
  endpoint,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  expectJSON = true
}) {
  if (!apiKey) throw new Error("Chave de API de IA ausente.");

  if (provider === "anthropic") {
    return callAnthropic({ apiKey, model, systemPrompt, userPrompt });
  }
  return callOpenAICompatible({ endpoint, apiKey, model, systemPrompt, userPrompt, expectJSON });
}

/* -------------------------------------------- */
/*  Tool-calling (agente com múltiplas idas/vindas)  */
/* -------------------------------------------- */

function toAnthropicTools(tools) {
  return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

function toOpenAITools(tools) {
  return tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

async function callAnthropicWithTools({ apiKey, model, systemPrompt, messages, tools }) {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools: toAnthropicTools(tools)
    })
  });
  if (!response.ok) throw new Error(`Endpoint Anthropic retornou HTTP ${response.status}`);

  const payload = await response.json();
  const content = payload?.content ?? [];
  return {
    stopReason: payload?.stop_reason === "tool_use" ? "tool_use" : "end",
    toolCalls: content.filter(b => b?.type === "tool_use").map(b => ({ id: b.id, name: b.name, input: b.input })),
    text: content.filter(b => b?.type === "text").map(b => b.text).join(""),
    assistantMessage: { role: "assistant", content }
  };
}

async function callOpenAICompatibleWithTools({ endpoint, apiKey, model, systemPrompt, messages, tools }) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: toOpenAITools(tools)
    })
  });
  if (!response.ok) throw new Error(`Endpoint de IA retornou HTTP ${response.status}`);

  const payload = await response.json();
  const message = payload?.choices?.[0]?.message ?? {};
  const toolCalls = message.tool_calls ?? [];
  return {
    stopReason: toolCalls.length ? "tool_use" : "end",
    toolCalls: toolCalls.map(tc => ({
      id: tc.id,
      name: tc.function?.name,
      input: safeParseJSON(tc.function?.arguments)
    })),
    text: message.content ?? "",
    assistantMessage: message
  };
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
}

/**
 * Uma rodada de tool-calling: manda `messages` + `tools` pro provedor configurado e devolve
 * um formato normalizado (`stopReason`/`toolCalls`/`text`/`assistantMessage`) igual pros dois
 * provedores — quem chama (ver agent-runner.js) não precisa saber o wire format de nenhum.
 * @param {object} opts
 * @param {"openai"|"anthropic"} opts.provider
 * @param {string} [opts.endpoint] - usado apenas pelo adaptador "openai"
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {Array<object>} opts.messages - histórico da conversa (sem a system message)
 * @param {Array<{name:string, description:string, parameters:object}>} opts.tools
 * @returns {Promise<{stopReason:"tool_use"|"end", toolCalls:Array<{id:string,name:string,input:object}>, text:string, assistantMessage:object}>}
 */
export async function callAIProviderWithTools({ provider, endpoint, apiKey, model, systemPrompt, messages, tools }) {
  if (!apiKey) throw new Error("Chave de API de IA ausente.");

  if (provider === "anthropic") {
    return callAnthropicWithTools({ apiKey, model, systemPrompt, messages, tools });
  }
  return callOpenAICompatibleWithTools({ endpoint, apiKey, model, systemPrompt, messages, tools });
}

/**
 * Anexa a mensagem do assistente (com os tool_use/tool_calls que ela pediu) e os resultados
 * de cada tool executada em `messages`, no formato certo pro provedor — Anthropic espera um
 * único turno "user" com todos os `tool_result` juntos; OpenAI-compatível espera uma mensagem
 * `role:"tool"` separada por tool call.
 * @param {"openai"|"anthropic"} provider
 * @param {Array<object>} messages
 * @param {object} assistantMessage - o `assistantMessage` devolvido por callAIProviderWithTools
 * @param {Array<{id:string, result:any}>} toolResults
 * @returns {Array<object>} novo array de messages, pronto pra próxima chamada do loop
 */
export function appendAssistantAndToolResults(provider, messages, assistantMessage, toolResults) {
  const updated = [...messages, assistantMessage];

  if (provider === "anthropic") {
    updated.push({
      role: "user",
      content: toolResults.map(tr => ({
        type: "tool_result",
        tool_use_id: tr.id,
        content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result)
      }))
    });
    return updated;
  }

  for (const tr of toolResults) {
    updated.push({
      role: "tool",
      tool_call_id: tr.id,
      content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result)
    });
  }
  return updated;
}
