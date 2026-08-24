/**
 * Adaptadores de provedor de IA. Cada um sabe montar a requisição certa e
 * extrair o texto de resposta do seu formato; `callAIProvider` é o único
 * ponto de entrada usado pelo resto do sistema (ver ai-helper.js).
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
