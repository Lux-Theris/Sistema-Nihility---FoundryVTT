/**
 * Relay de IA (Cloudflare Worker) para o Nihility RPG System.
 *
 * Por quê: settings de mundo do Foundry são sincronizadas para TODOS os
 * clientes conectados (jogadores incluídos), então uma chave de API de IA
 * guardada direto numa setting do sistema é tecnicamente legível por
 * qualquer jogador via console do navegador. Este Worker resolve isso:
 * a chave real do provedor de IA fica só aqui (como Secret do Cloudflare,
 * nunca enviada ao Foundry), e o Foundry passa a chamar este Worker com um
 * token trocável em vez da chave de verdade.
 *
 * Deploy: cole este arquivo no editor do Cloudflare Workers (dashboard),
 * configure as variáveis abaixo em Settings → Variables and Secrets, e
 * publique. Veja README.md nesta pasta para o passo a passo completo.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Relay-Token"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    const token = request.headers.get("X-Relay-Token");
    if (!token || token !== env.RELAY_SHARED_SECRET) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Corpo da requisição não é JSON válido" }, 400);
    }

    const { systemPrompt = "", userPrompt = "", expectJSON = true } = body;

    try {
      const text = await callProvider(env, systemPrompt, userPrompt, expectJSON);
      return jsonResponse({ text });
    } catch (err) {
      return jsonResponse({ error: String(err?.message || err) }, 502);
    }
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

/**
 * Chama o provedor de IA real, escolhido pela variável RELAY_PROVIDER
 * ("openai" ou "anthropic") configurada no próprio Worker.
 */
async function callProvider(env, systemPrompt, userPrompt, expectJSON) {
  const provider = env.RELAY_PROVIDER || "openai";

  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.RELAY_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.RELAY_MODEL || "claude-sonnet-4-5",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });
    if (!response.ok) throw new Error(`Anthropic retornou HTTP ${response.status}`);
    const payload = await response.json();
    return (payload?.content ?? []).map(block => block?.text ?? "").join("");
  }

  const endpoint = env.RELAY_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const requestBody = {
    model: env.RELAY_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  if (expectJSON) requestBody.response_format = { type: "json_object" };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RELAY_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) throw new Error(`Endpoint de IA retornou HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content ?? "";
}
