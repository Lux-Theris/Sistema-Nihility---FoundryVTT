# Relay de IA (Cloudflare Workers)

Guarda a chave real do provedor de IA (OpenAI/Anthropic) fora do Foundry, num Worker
da Cloudflare. O Foundry passa a chamar esse Worker com um **token trocável**, em vez
da chave de verdade — resolve o problema de settings de mundo serem visíveis a
qualquer jogador conectado.

## Passo a passo (tudo pelo painel web, sem instalar nada)

1. Crie uma conta gratuita em **https://dash.cloudflare.com/sign-up** (se ainda não tiver).
2. No menu lateral, vá em **Workers & Pages** → **Create** → **Create Worker**.
3. Dê um nome (ex: `nihility-ai-relay`) → **Deploy** (ele cria com um código padrão de exemplo).
4. Clique em **Edit code** — apague o conteúdo padrão e cole o conteúdo de
   [`cloudflare-worker.js`](cloudflare-worker.js) (deste mesmo repositório). Clique em **Deploy**.
5. Volte pra tela do Worker → aba **Settings** → **Variables and Secrets** → **Add**.
   Adicione estas variáveis (marque como **Secret** as duas primeiras, pra ficarem
   criptografadas e nunca aparecerem em texto puro no painel depois de salvas):

   | Nome | Tipo | Exemplo |
   |---|---|---|
   | `RELAY_API_KEY` | Secret | sua chave real da OpenAI ou Anthropic |
   | `RELAY_SHARED_SECRET` | Secret | uma senha longa e aleatória inventada por você (ex: gere uma em https://1password.com/password-generator ou similar) |
   | `RELAY_PROVIDER` | Texto | `openai` ou `anthropic` |
   | `RELAY_MODEL` | Texto | `gpt-4o-mini` (ou `claude-sonnet-4-5` se `RELAY_PROVIDER=anthropic`) |
   | `RELAY_ENDPOINT` | Texto (opcional) | só se usar outro provedor OpenAI-compatível que não a OpenAI, ex OpenRouter |

   Salve — o Worker reinicia sozinho com as novas variáveis.
6. Copie a URL pública do Worker, mostrada no topo da página (algo como
   `https://nihility-ai-relay.SEU-USUARIO.workers.dev`).
7. No Foundry, em **Configurações do Mundo → Nihility RPG System**:
   - **Provedor de IA** → `Relay Seguro (Cloudflare)`
   - **URL do Relay** → cole a URL do passo 6
   - **Token do Relay** → cole o mesmo valor que você colocou em `RELAY_SHARED_SECRET`

Pronto. A partir daqui, o Foundry nunca mais vê a chave real — só o token do relay,
que você pode trocar a qualquer momento (nos dois lados) sem precisar gerar uma nova
chave na OpenAI/Anthropic.

## Por que isso é mais seguro

- A chave real (`RELAY_API_KEY`) fica marcada como **Secret** no Cloudflare — nem você
  consegue ver o valor de novo no painel depois de salvar, só substituir.
- O Foundry só guarda o **token do relay**, que também é visível a jogadores (é setting
  de mundo, mesma limitação de sempre) — mas esse token não dá acesso a nada além de
  chamar seu Worker; não é uma chave de provedor de IA de verdade.
- Se alguém descobrir o token, você troca ele em 10 segundos (nos dois lados) sem afetar
  a chave real nem gerar custo até você perceber.

## Custo

O plano gratuito da Cloudflare Workers cobre 100.000 requisições/dia — muito acima do
que uma mesa de RPG gera. Não deve custar nada.
