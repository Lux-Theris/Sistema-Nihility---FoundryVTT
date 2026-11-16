import { createListConfigApp } from "./list-config-app-factory.js";
import { getActiveWeaponTypes } from "../core/config.js";

/**
 * Tipos de arma (H6): catálogo plano com "Subtipo de" (como os Tipos de Dano). Nada é apagado de
 * Itens e Skills ao editar: um id que sumiu só deixa de valer como tipo até voltar (o Validar Mundo lista).
 * O "Subtipo de" lista os tipos já SALVOS: crie o grupo, salve, e então os subtipos.
 */
export const WeaponTypesConfigApp = createListConfigApp({
  id: "nihility-weapon-types-config",
  title: "Configurar Tipos de Arma",
  settingsKey: "weaponTypesData",
  width: 560,
  hint:
    "Grupos (Lâminas, Armas de Fogo…) e subtipos (Espadas, Pistolas…). Nas Configurações do bloco \"Tipos de arma e Maestria\" a lista pode ser " +
    "<strong>simples</strong> (só grupos) ou <strong>detalhada</strong>; trocar nunca apaga o que está salvo. O id <code>unarmed</code> é o do ataque desarmado. " +
    "Mudar o id de um tipo em uso solta as armas e Maestrias dele até o id voltar.",
  fields: [
    { key: "id", label: "ID", type: "text", placeholder: "id (ex: swords)" },
    { key: "label", label: "Nome", type: "text", placeholder: "Nome exibido" },
    {
      key: "parent",
      label: "Subtipo de",
      type: "select",
      options: () => [{ value: "", label: "— grupo —" }, ...getActiveWeaponTypes().filter(t => !t.parent).map(t => ({ value: t.id, label: t.label }))]
    }
  ],
  getActiveList: getActiveWeaponTypes
});
