/**
 * Condições do sistema dentro do HUD do token.
 *
 * O catálogo de Condições (Cegueira, Veneno, Atordoamento… — editável em Configurar Condições de
 * Status) já existia, mas só era alcançável de DENTRO de uma Skill: o Mestre não conseguia clicar
 * num token e marcar "Envenenado" à mão, que é o gesto natural do Foundry. Aqui esse catálogo
 * passa a alimentar `CONFIG.statusEffects`, e a marcação manual ganha uma tela pra dizer o que a
 * Condição faz — ou pra não fazer nada e ser só um marcador visual.
 *
 * Os dois caminhos (Skill e mão do Mestre) terminam no MESMO `applyEffectsToActor`, então uma
 * Condição marcada à mão empilha com a mesma Condição vinda de Skill, em vez de virar um segundo
 * efeito independente.
 */
import {
  SYSTEM_ID,
  MEU_SISTEMA,
  getActiveStatusConditions,
  getVisibleAttributes,
  isStatusConditionsEnabled,
  debugLog
} from "./config.js";
import { applyManualCondition } from "./skill-effects.js";

const { DialogV2 } = foundry.applications.api;

/** Escapa texto livre do Mestre antes de entrar no HTML do diálogo. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/** true se `id` é uma Condição deste sistema (e não um status do core ou de outro módulo). */
function isSystemCondition(id) {
  return getActiveStatusConditions().some(c => c.id === id);
}

/**
 * A lista de status do core, como estava antes de o sistema encostar nela. Guardada na primeira
 * chamada pra que desligar o bloco de Condições em tempo de execução devolva a paleta original do
 * Foundry, em vez de deixar o mundo preso na última lista que o sistema publicou.
 */
let coreStatusEffects = null;

/**
 * Publica o catálogo de Condições em `CONFIG.statusEffects`, substituindo a lista do core.
 *
 * Substitui em vez de concatenar porque a lista do core traz dezenas de status de outros
 * sistemas (prone, invisible, dead...) que não significam nada aqui — misturar deixaria a paleta
 * do token cheia de ícones sem regra nenhuma por trás. O `defeated`, único que o Foundry usa
 * internamente (marca o combatente derrotado no rastreador), é preservado por isso mesmo.
 *
 * Com o bloco "Condições de Status" desligado o sistema não publica nada e devolve a lista do
 * core: desligar um bloco tem que ESCONDER interface do sistema, nunca trocar a do Foundry por
 * uma — e um mundo que optou por não usar Condições ficaria sem os status do core e com os do
 * Nihility no lugar, exatamente o contrário do pedido.
 */
export function registerStatusConditions() {
  coreStatusEffects ??= CONFIG.statusEffects;

  if (!isStatusConditionsEnabled()) {
    CONFIG.statusEffects = coreStatusEffects;
    debugLog(`${SYSTEM_ID} | Bloco de Condições desligado — paleta do token mantida no padrão do Foundry.`);
    return;
  }

  // Procurado no snapshot do core, e NÃO em `CONFIG.statusEffects`: a partir da segunda chamada
  // (o Mestre salvou o catálogo) a lista corrente já é a do sistema, que não tem `defeated` —
  // procurar nela descartaria o status em silêncio e quebraria o "derrotado" do rastreador.
  const defeated = coreStatusEffects.find(e => e.id === CONFIG.specialStatusEffects?.DEFEATED || e.id === "dead");

  CONFIG.statusEffects = [
    ...getActiveStatusConditions().map(condition => ({
      id: condition.id,
      name: condition.label,
      img: condition.icon
    })),
    ...(defeated ? [defeated] : [])
  ];

  debugLog(`${SYSTEM_ID} | ${CONFIG.statusEffects.length} Condições publicadas no HUD do token.`);
}

/**
 * Intercepta a criação de um Active Effect vindo do clique manual no HUD do token.
 *
 * Precisa CANCELAR a criação (devolver `false`) e recriar depois: o hook é síncrono e não dá pra
 * esperar um diálogo antes de deixar o documento nascer. O `nihilityConfigured` na segunda volta
 * é o que impede o laço infinito.
 *
 * Não intercepta o que veio de Skill (`flags.skillEffect`) — aquele caminho já sabe o que a
 * Condição faz e não tem o que perguntar.
 */
export function interceptManualCondition(effect, data, options, userId) {
  if (game.user.id !== userId) return; // só o cliente que clicou abre o diálogo
  // Bloco desligado: o Foundry cria o Active Effect do jeito dele, sem a tela do sistema no meio.
  if (!isStatusConditionsEnabled()) return;
  if (options?.nihilityConfigured) return;
  if (effect.flags?.[SYSTEM_ID]?.skillEffect) return;

  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;

  const conditionId = Array.from(data.statuses ?? []).find(isSystemCondition);
  if (!conditionId) return;

  // Fire-and-forget: o hook não pode ser async, então o diálogo segue por fora e a criação
  // original morre aqui.
  promptManualCondition(actor, conditionId);
  return false;
}

/** Alvos que uma Condição manual pode mexer: HP/Energia (dano ou cura) e os Atributos visíveis. */
function buildTargetOptions() {
  const attributes = getVisibleAttributes().map(a => `<option value="${a.key}">${a.label}</option>`).join("");
  return (
    '<option value="">— nenhum (só o ícone) —</option>' +
    '<option value="hp">HP</option>' +
    `<option value="energy">${MEU_SISTEMA.EFFECT_TARGET_LABELS.energy}</option>` +
    attributes
  );
}

/**
 * Tela de configuração da Condição marcada à mão. Tudo é opcional: sem Alvo e sem Valor, a
 * Condição vira só o ícone no token — que é exatamente o caso mais comum na mesa ("está cego",
 * "está atordoado"), onde quem arbitra o efeito é o Mestre, não o sistema.
 */
async function promptManualCondition(actor, conditionId) {
  const condition = getActiveStatusConditions().find(c => c.id === conditionId);
  if (!condition) return;

  const data = await DialogV2.wait({
    window: { title: `Aplicar Condição — ${condition.label}` },
    content: `
      <form class="nihility-condition-dialog">
        <p class="hint">
          <strong>${escapeHtml(condition.label)}</strong> em <strong>${escapeHtml(actor.name)}</strong>.
          Deixe Alvo e Valor em branco para aplicar só o ícone, sem mecânica nenhuma.
        </p>
        <div class="form-group">
          <label>Alvo</label>
          <select name="target">${buildTargetOptions()}</select>
        </div>
        <div class="form-group">
          <label>Valor <span class="hint-inline">(negativo = dano/debuff, positivo = cura/buff)</span></label>
          <input type="number" name="amount" value="0"/>
        </div>
        <div class="form-group">
          <label>Duração <span class="hint-inline">(rodadas; 0 = indefinida, até ser removida)</span></label>
          <input type="number" name="duration" value="0" min="0"/>
        </div>
        <label class="checkbox-line">
          <input type="checkbox" name="periodic"/>
          Periódico — aplica o Valor a cada rodada (só HP/Energia), em vez de uma vez só
        </label>
      </form>`,
    buttons: [
      {
        action: "confirm",
        label: "Aplicar",
        default: true,
        callback: (event, button, dialog) => {
          const form = dialog.element;
          return {
            target: form.querySelector("[name=target]").value,
            amount: Number(form.querySelector("[name=amount]").value) || 0,
            duration: Math.max(0, Number(form.querySelector("[name=duration]").value) || 0),
            periodic: form.querySelector("[name=periodic]").checked
          };
        }
      },
      { action: "cancel", label: "Cancelar", callback: () => false }
    ],
    rejectClose: false
  });

  if (!data) return;

  // Sem alvo ou sem valor não há mecânica: cria o efeito "pelado", só com ícone e nome. Não passa
  // por applyManualCondition porque aquele caminho monta um efeito COM regra.
  if (!data.target || !data.amount) {
    await actor.createEmbeddedDocuments(
      "ActiveEffect",
      [
        {
          name: condition.label,
          img: condition.icon,
          statuses: [conditionId],
          duration: data.duration > 0 ? { rounds: data.duration } : {},
          flags: { [SYSTEM_ID]: { conditionId, manual: true } }
        }
      ],
      { nihilityConfigured: true }
    );
    return;
  }

  // Periódico só faz sentido em HP/Energia — num Atributo não existe "tick" que signifique algo.
  const periodic = data.periodic && ["hp", "energy"].includes(data.target);

  await applyManualCondition(actor, conditionId, {
    target: data.target,
    amount: data.amount,
    durationRounds: data.duration,
    periodic,
    tickUnit: "combatRound",
    damageElements: [],
    modifierType: "flat",
    icon: ""
  });
}
