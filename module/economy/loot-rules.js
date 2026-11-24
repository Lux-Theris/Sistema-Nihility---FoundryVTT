/**
 * Lojas (G2, lote B) — a parte PURA do saque, das pilhas no mapa, do depósito de entregas, da
 * máquina de venda e da troca entre jogadores. Sem Foundry: tudo que depende de número entra por
 * parâmetro. Testado em test/loot.test.mjs. Quem lê e grava documentos são `loot.js`,
 * `player-trade.js` e os apps.
 */

/** "Perto" padrão (corpo, pilha, depósito, troca), em metros. A mesa muda em Módulos do Sistema > Lojas. */
export const DEFAULT_LOOT_RANGE = 2;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/* ------------------------------------------------------------------ Distância */

/**
 * Distância entre as BORDAS de dois retângulos (Tokens ou um ponto com `w: 0, h: 0`), em unidades
 * da grade (metros). Encostados = 0. `a`/`b`: `{x, y, w, h}` em pixels da cena (canto de cima).
 */
export function rectGapDistance(a, b, gridSize = 100, gridDistance = 1) {
  const size = Math.max(1, num(gridSize, 100));
  const gapAxis = (pa, la, pb, lb) => Math.max(0, Math.max(pa, pb) - Math.min(pa + la, pb + lb));
  const dx = gapAxis(num(a?.x), num(a?.w), num(b?.x), num(b?.w));
  const dy = gapAxis(num(a?.y), num(a?.h), num(b?.y), num(b?.h));
  return (Math.hypot(dx, dy) / size) * Math.max(0, num(gridDistance, 1));
}

/** A menor distância entre qualquer retângulo de `mine` e `target` (ou `null` se `mine` está vazio). */
export function nearestGap(mine, target, gridSize, gridDistance) {
  let best = null;
  for (const rect of mine ?? []) {
    const d = rectGapDistance(rect, target, gridSize, gridDistance);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** "3,4 m" — a distância no jeito da mesa. */
export function metersText(value, units = "m") {
  const n = Math.round(num(value) * 10) / 10;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units}`;
}

/** Está perto? (com uma folga minúscula para o arredondamento da grade). */
export function isNear(distance, range = DEFAULT_LOOT_RANGE) {
  return distance !== null && distance !== undefined && num(distance, Infinity) <= num(range, DEFAULT_LOOT_RANGE) + 1e-6;
}

/** O texto de "longe demais": "Você está a 3,4 m · chegue a 2 m". */
export function farText(distance, range = DEFAULT_LOOT_RANGE, units = "m") {
  if (distance === null || distance === undefined) return "Você não tem um Token neste mapa para chegar perto.";
  return `Você está a ${metersText(distance, units)} · chegue a ${metersText(range, units)}`;
}

/* ------------------------------------------------------------------ Corpo */

/**
 * O corpo pode ser saqueado? Uma ficha de loja nunca. Morto sim. Vida 0 só vale para NPC (o PJ
 * caído tem um contador de morte e os outros jogadores o socorrem, não o saqueiam).
 */
export function bodyLootable({ isShop = false, dead = false, hp = 1, npc = false } = {}) {
  if (isShop) return false;
  if (dead) return true;
  return Boolean(npc) && num(hp, 1) <= 0;
}

/** Texto do estado do corpo (a etiqueta da janela). */
export function bodyStateText({ dead = false, hp = 1 } = {}) {
  if (dead) return "morto";
  return num(hp, 1) <= 0 ? "caído" : "";
}

/* ------------------------------------------------------------------ Pilhas */

/** Nome da pilha largada por alguém. */
export function pileName(giverName) {
  const name = String(giverName ?? "").trim();
  return name ? `Pilha de ${name}` : "Pilha";
}

/**
 * Se já existe uma pilha perto do ponto largado, o item entra nela em vez de abrir outro Token.
 * `piles`: `[{id, x, y, w, h}]` (retângulo do Token). Devolve o id da mais perto cujo centro está
 * a menos de ¾ de casa do ponto, ou `null`.
 */
export function mergeTarget(piles, point, gridSize = 100) {
  const limit = Math.max(1, num(gridSize, 100)) * 0.75;
  let best = null;
  let bestD = Infinity;
  for (const pile of piles ?? []) {
    const cx = num(pile.x) + num(pile.w) / 2;
    const cy = num(pile.y) + num(pile.h) / 2;
    const d = Math.hypot(cx - num(point?.x), cy - num(point?.y));
    if (d <= limit && d < bestD) {
      best = pile.id;
      bestD = d;
    }
  }
  return best;
}

/** Onde o Token da pilha fica: o canto de cima que centra a casa no ponto (grade quadrada: na casa do ponto). */
export function pileTokenPosition(point, gridSize = 100, { square = true } = {}) {
  const size = Math.max(1, num(gridSize, 100));
  const x = num(point?.x);
  const y = num(point?.y);
  if (square) return { x: Math.floor(x / size) * size, y: Math.floor(y / size) * size };
  return { x: Math.round(x - size / 2), y: Math.round(y - size / 2) };
}

/** Quantidade total de itens (soma das quantidades) de uma lista `[{qty}]`. */
export function totalQty(rows) {
  return (rows ?? []).reduce((sum, r) => sum + Math.max(0, Math.floor(num(r?.qty ?? r?.quantity))), 0);
}

/** A pergunta de "limpar pilhas da cena": quantas pilhas e quantos itens. */
export function clearPilesSummary({ pileCount = 0, itemCount = 0, sceneName = "" } = {}) {
  if (pileCount < 1) return { empty: true, title: "Nenhuma pilha nesta cena", body: "" };
  const piles = `${pileCount} ${pileCount === 1 ? "pilha" : "pilhas"}`;
  return {
    empty: false,
    title: `Remover ${piles}?`,
    body: `Os itens dentro delas (${itemCount} no total) deixam de existir no mundo. Só as pilhas da cena ${sceneName || "atual"} são removidas. Corpos e depósitos não são tocados.`,
    confirm: `Remover ${piles}`,
    done: `${piles} ${pileCount === 1 ? "removida" : "removidas"} da cena ${sceneName || "atual"}`
  };
}

/* ------------------------------------------------------------------ Depósito de entregas */

/**
 * A marca de entrega de um Item dentro de um depósito (`flags.<sistema>.delivery`): de quem é, de onde
 * veio, o estado ("a caminho" ou "chegou") e quando chega (relógio do mundo, segundos).
 */
export function normalizeDelivery(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ownerUuid = typeof raw.ownerUuid === "string" ? raw.ownerUuid : "";
  if (!ownerUuid) return null;
  const arriveAt = raw.arriveAt == null || raw.arriveAt === "" || !Number.isFinite(Number(raw.arriveAt)) ? null : Number(raw.arriveAt);
  return {
    ownerUuid,
    ownerName: String(raw.ownerName ?? ""),
    from: String(raw.from ?? ""),
    status: raw.status === "transit" ? "transit" : "arrived",
    arriveAt,
    orderedAt: raw.orderedAt == null || !Number.isFinite(Number(raw.orderedAt)) ? null : Number(raw.orderedAt),
    /** Compra para o porão de uma nave (lote C): ao chegar, o item passa do depósito para a nave. */
    shipUuid: typeof raw.shipUuid === "string" ? raw.shipUuid : ""
  };
}

/** O estado de uma entrega agora: "transit" até o relógio chegar em `arriveAt`, depois "arrived". */
export function deliveryState(delivery, now) {
  const d = normalizeDelivery(delivery);
  if (!d) return "arrived";
  if (d.status === "arrived") return "arrived";
  if (d.arriveAt !== null && num(now) >= d.arriveAt) return "arrived";
  return "transit";
}

/** Esta entrega está "a caminho" mas já passou do prazo (hora de marcar como chegou)? */
export function deliveryDue(delivery, now) {
  const d = normalizeDelivery(delivery);
  return Boolean(d) && d.status === "transit" && d.arriveAt !== null && num(now) >= d.arriveAt;
}

/**
 * "chega em 1 dia · 3h": o tempo que falta, pelo relógio do mundo. `dayLength` em segundos.
 */
export function etaText(remainingSeconds, dayLength = 86400) {
  const left = Math.max(0, Math.ceil(num(remainingSeconds)));
  if (left === 0) return "chega agora";
  const day = Math.max(1, num(dayLength, 86400));
  const days = Math.floor(left / day);
  const hours = Math.floor((left % day) / 3600);
  const minutes = Math.ceil((left % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "dia" : "dias"}`);
  if (hours > 0) parts.push(`${hours}h`);
  if (!days && !hours) parts.push(`${Math.max(1, minutes)} min`);
  return `chega em ${parts.join(" · ")}`;
}

/**
 * O que cada pessoa vê no depósito. `entries`: `[{id, name, qty, delivery}]`. O jogador vê só o
 * que é dele (chegou: "mine"; a caminho: "transit"); o Mestre vê tudo (`gm`). Item sem marca de
 * entrega (o Mestre pôs à mão) só aparece para o Mestre, em "loose".
 */
export function splitDeposit(entries, viewerUuid, { gm = false, now = 0 } = {}) {
  const out = { mine: [], transit: [], loose: [], others: 0 };
  for (const entry of entries ?? []) {
    const delivery = normalizeDelivery(entry.delivery);
    if (!delivery) {
      if (gm) out.loose.push(entry);
      continue;
    }
    const mineOrGm = gm || delivery.ownerUuid === viewerUuid;
    if (!mineOrGm) {
      out.others += 1;
      continue;
    }
    if (deliveryState(delivery, now) === "arrived") out.mine.push(entry);
    else out.transit.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------ Máquina de venda */

export const MACHINE_PER_PAGE = 16;
const A = "A".charCodeAt(0);

/** Quantas prateleiras (letras) a máquina tem para `count` produtos (pelo menos 1, no máximo 26). */
export function machinePageCount(count, perPage = MACHINE_PER_PAGE) {
  return Math.min(26, Math.max(1, Math.ceil(Math.max(0, num(count)) / perPage)));
}

/** A letra de uma prateleira (0 = A). */
export function machinePageLetter(page) {
  return String.fromCharCode(A + Math.min(25, Math.max(0, Math.floor(num(page)))));
}

/** O código de um produto: letra da prateleira + 2 dígitos (A01…A16). */
export function machineCode(index, perPage = MACHINE_PER_PAGE) {
  const i = Math.max(0, Math.floor(num(index)));
  const page = Math.floor(i / perPage);
  return `${machinePageLetter(page)}${String((i % perPage) + 1).padStart(2, "0")}`;
}

/**
 * A planta da máquina: os produtos em ordem de nome, cada um com seu código, prateleira e posição.
 * Produto esgotado continua na vitrine (com "ESGOTADO") e mantém o código.
 * @param {Array<{id:string, name:string}>} rows
 */
export function machineLayout(rows, perPage = MACHINE_PER_PAGE) {
  const sorted = [...(rows ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));
  return sorted.slice(0, 26 * perPage).map((row, index) => ({
    ...row,
    index,
    page: Math.floor(index / perPage),
    slot: index % perPage,
    code: machineCode(index, perPage)
  }));
}

/** O texto digitado vira `{page, slot}` (A03 → página 0, posição 2), ou `null` se ainda não é um código. */
export function parseMachineCode(text, perPage = MACHINE_PER_PAGE) {
  const m = /^([A-Za-z])(\d{2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const page = m[1].toUpperCase().charCodeAt(0) - A;
  const slot = Number(m[2]) - 1;
  if (slot < 0 || slot >= perPage) return null;
  return { page, slot };
}

/** O produto que um código digitado aponta (ou `null`). */
export function machineFind(layout, text, perPage = MACHINE_PER_PAGE) {
  const parsed = parseMachineCode(text, perPage);
  if (!parsed) return null;
  return (layout ?? []).find(e => e.page === parsed.page && e.slot === parsed.slot) ?? null;
}

/**
 * Aperta uma tecla do teclado da máquina. Letra: troca de prateleira e começa um código novo; dígito:
 * acrescenta (depois de 3 caracteres recomeça); "clear" apaga.
 * @returns {string} o novo texto digitado
 */
export function machinePress(typed, key) {
  const k = String(key ?? "");
  if (k === "clear") return "";
  if (/^[A-Za-z]$/.test(k)) return k.toUpperCase();
  if (/^\d$/.test(k)) return `${String(typed ?? "").length >= 3 ? "" : String(typed ?? "")}${k}`;
  return String(typed ?? "");
}

/** Uma cor estável para o produto (a máquina desenha o produto num bloco colorido atrás do ícone). */
export function machineColor(name) {
  const palette = ["#e05a5a", "#6ee7a0", "#c9a36b", "#6ee7ff", "#9aa1c2", "#e8c170", "#7a8a4a", "#c9a7ff", "#ffcf5c", "#a0784a", "#5a628f"];
  let h = 0;
  for (const ch of String(name ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

/* ------------------------------------------------------------------ Troca entre jogadores */

/**
 * Quem aparece no menu "Trocar com…": os outros Personagens de jogador, com a distância. Quem está
 * longe aparece desabilitado; um vendedor aparece com a dica de usar a Vitrine. `others`:
 * `[{uuid, name, isShop, distance}]`.
 */
export function tradeCandidates(others, range = DEFAULT_LOOT_RANGE) {
  return (others ?? [])
    .map(o => {
      if (o.isShop) return { ...o, enabled: false, hint: "loja: use a Vitrine" };
      if (o.distance === null || o.distance === undefined) return { ...o, enabled: false, hint: "sem Token neste mapa" };
      const near = isNear(o.distance, range);
      return { ...o, enabled: near, hint: `${metersText(o.distance)}${near ? "" : " (longe)"}` };
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || String(a.name).localeCompare(String(b.name), "pt-BR"));
}

/** O lado da troca de uma pessoa (`"a"` quem abriu, `"b"` o convidado) pelo uuid do personagem dela. */
export function tradeSideOf(trade, actorUuid) {
  if (trade?.aUuid === actorUuid) return "a";
  if (trade?.bUuid === actorUuid) return "b";
  return "";
}

/** O outro lado. */
export const otherSide = side => (side === "a" ? "b" : side === "b" ? "a" : "");

/**
 * A faixa da janela de troca para quem está no lado `me`. `trade.changedBy` é o lado que mexeu por
 * último na oferta (e derrubou os aceites).
 * @returns {{cls:"i"|"w"|"d"|"k", text:string}}
 */
export function tradeBanner(trade, me) {
  const other = otherSide(me);
  const name = side => (side === "a" ? trade.aName : trade.bName) || "o outro lado";
  if (!trade || !me) return { cls: "i", text: "" };
  if (trade.status === "done") return { cls: "k", text: trade.text || "Troca feita." };
  if (trade.status === "cancelled") return { cls: "d", text: trade.text || "Troca cancelada. Nada mudou de dono." };
  const a = trade.accepted ?? {};
  if (trade.changedBy === other && !a.a && !a.b) {
    return { cls: "w", text: `${name(other)} mudou a oferta. Os dois aceites foram apagados; confira e aceite de novo.` };
  }
  if (a[me] && !a[other]) return { cls: "w", text: `Aguardando ${name(other)}: você aceitou.` };
  if (a[other] && !a[me]) return { cls: "k", text: `${name(other)} aceitou. Falta você.` };
  return { cls: "i", text: "Monte a oferta dos dois lados e aceite. Qualquer mudança depois de um aceite apaga os dois." };
}

/** A troca tem algo na mesa de algum lado? */
export function tradeHasContent(trade) {
  const filled = s => (trade?.[s]?.items?.length ?? 0) > 0 || Boolean(trade?.[s]?.coins);
  return filled("a") || filled("b");
}

/** Texto curto de um lado da troca para o card do chat ("2× Poção de Cura, Adaga e 50 cr"). */
export function tradeSideText(parts) {
  const list = (parts ?? []).filter(Boolean);
  if (!list.length) return "nada";
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} e ${list.at(-1)}`;
}

/* ------------------------------------------------------------------ Validar Mundo */

/**
 * Problemas do depósito de entregas e das pilhas, em texto. Pura: recebe o que o validador leu.
 * @param {{scenes?:Array<{name:string, depotUuid:string, depotExists:boolean}>, folders?:Array<{name:string, depotUuid:string, depotExists:boolean}>, piles?:Array<{where:string, items:number, ageDays?:number}>, deposits?:Array<{name:string, strandedItems:number}>}} input
 */
export function lootIssues({ scenes = [], folders = [], piles = [], deposits = [], staleDays = 7 } = {}) {
  const issues = [];
  for (const scene of scenes) {
    if (scene.depotUuid && !scene.depotExists) {
      issues.push({ where: `Cena "${scene.name}"`, message: "\"Entregas vão para\" aponta para um depósito que não existe mais: a compra online fica sem endereço aqui" });
    }
  }
  for (const folder of folders) {
    if (folder.depotUuid && !folder.depotExists) {
      issues.push({ where: `Pasta de cenas "${folder.name}"`, message: "\"Entregas vão para\" aponta para um depósito que não existe mais: as cenas dela ficam sem endereço de entrega" });
    }
  }
  for (const pile of piles) {
    if (pile.items < 1) issues.push({ where: pile.where, message: "pilha vazia esquecida no mapa (apague o Token ou use \"Limpar pilhas da cena\")" });
    else if (num(pile.ageDays) >= staleDays) issues.push({ where: pile.where, message: `pilha parada há ${Math.floor(num(pile.ageDays))} dias com ${pile.items} ${pile.items === 1 ? "item" : "itens"}: alguém pegou ou foi esquecida?` });
  }
  for (const deposit of deposits) {
    if (deposit.strandedItems > 0) {
      issues.push({ where: `Depósito "${deposit.name}"`, message: `${deposit.strandedItems} ${deposit.strandedItems === 1 ? "item" : "itens"} sem dono (sem marca de entrega): só o Mestre consegue entregar` });
    }
  }
  return issues;
}
