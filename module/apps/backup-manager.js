/**
 * Gerenciador de backup do Nihility RPG System
 */
import { SYSTEM_ID } from "../config.js";
import { BackupHelper } from "../helpers/backup-helper.js";

export class BackupManagerApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "nihility-backup-manager",
      title: "Gerenciador de Backup - Nihility RPG System",
      template: `systems/${SYSTEM_ID}/templates/apps/backup-manager.hbs`,
      classes: [SYSTEM_ID, "backup-manager-app"],
      width: 800,
      height: "auto",
      resizable: true
    });
  }

  constructor(options = {}) {
    super(options);
    this.backups = [];
    this.selectedBackup = null;
  }

  /** @override */
  async getData() {
    const backups = await BackupHelper.getRecentBackups(20);

    return {
      isGM: game.user.isGM,
      backups: backups,
      totalBackups: backups.length,
      hasBackups: backups.length > 0
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Eventos de backup
    html.querySelectorAll(".backup-button").forEach(element => {
      element.addEventListener("click", this._onBackupAction.bind(this));
    });
    html.querySelectorAll(".restore-button").forEach(element => {
      element.addEventListener("click", this._onRestoreClick.bind(this));
    });
    html.querySelectorAll(".delete-button").forEach(element => {
      element.addEventListener("click", this._onDeleteClick.bind(this));
    });
    html.querySelectorAll(".view-details-button").forEach(element => {
      element.addEventListener("click", this._onViewDetailsClick.bind(this));
    });

    // Filtros
    const filterElement = html.querySelector("#backup-filter");
    if (filterElement) {
      filterElement.addEventListener("change", this._onFilterChange.bind(this));
    }
  }

  async _onBackupAction(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;

    switch (action) {
      case "create-actor-backup":
        await this._createActorBackup();
        break;
      case "create-item-backup":
        await this._createItemBackup();
        break;
      case "cleanup-backups":
        await this._cleanupBackups();
        break;
      case "refresh":
        this.render(false);
        break;
    }
  }

  async _onRestoreClick(event) {
    event.preventDefault();
    const backupId = event.currentTarget.dataset.backupId;

    if (!backupId) return;

    try {
      // Confirmar restauração
      const confirmed = await Dialog.confirm({
        title: "Restaurar Backup",
        content: `<p>Você tem certeza que deseja restaurar este backup?</p>
                  <p>Esta ação pode sobrescrever dados existentes.</p>`,
        confirmText: "Restaurar"
      });

      if (confirmed) {
        await BackupHelper.restoreFromBackup(backupId);
        ui.notifications.info("Backup restaurado com sucesso!");
        this.render(false);
      }
    } catch (error) {
      ui.notifications.error(`Falha ao restaurar backup: ${error.message}`);
    }
  }

  async _onDeleteClick(event) {
    event.preventDefault();
    const backupId = event.currentTarget.dataset.backupId;

    if (!backupId) return;

    try {
      // Confirmar exclusão
      const confirmed = await Dialog.confirm({
        title: "Excluir Backup",
        content: `<p>Você tem certeza que deseja excluir este backup?</p>
                  <p>Esta ação não pode ser desfeita.</p>`,
        confirmText: "Excluir"
      });

      if (confirmed) {
        // Para simplificação, vamos apenas remover do localStorage
        const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
        const filtered = backups.filter(b => b.id !== backupId);
        localStorage.setItem(`${SYSTEM_ID}-backups`, JSON.stringify(filtered));

        ui.notifications.info("Backup excluído com sucesso!");
        this.render(false);
      }
    } catch (error) {
      ui.notifications.error(`Falha ao excluir backup: ${error.message}`);
    }
  }

  async _onViewDetailsClick(event) {
    event.preventDefault();
    const backupId = event.currentTarget.dataset.backupId;

    if (!backupId) return;

    try {
      const backup = await BackupHelper._getBackup(backupId);
      if (backup) {
        this._showBackupDetails(backup);
      }
    } catch (error) {
      ui.notifications.error(`Falha ao carregar detalhes: ${error.message}`);
    }
  }

  _onFilterChange(event) {
    // Implementar filtragem de backups
    this.render(false);
  }

  async _createActorBackup() {
    try {
      const actor = game.user.character;
      if (!actor) {
        ui.notifications.warn("Nenhum personagem selecionado para backup");
        return;
      }

      await BackupHelper.createBackupForActor(actor);
      ui.notifications.info(`Backup criado para ${actor.name}`);
      this.render(false);
    } catch (error) {
      ui.notifications.error(`Falha ao criar backup: ${error.message}`);
    }
  }

  async _createItemBackup() {
    try {
      const items = game.items;
      if (!items || items.length === 0) {
        ui.notifications.warn("Nenhum item encontrado para backup");
        return;
      }

      // Criar backup de um item aleatório (pode ser expandido)
      const item = items.first();
      await BackupHelper.createBackupForItem(item);
      ui.notifications.info(`Backup criado para ${item.name}`);
      this.render(false);
    } catch (error) {
      ui.notifications.error(`Falha ao criar backup: ${error.message}`);
    }
  }

  async _cleanupBackups() {
    try {
      await BackupHelper.cleanupOldBackups(30);
      ui.notifications.info("Backups antigos removidos com sucesso!");
      this.render(false);
    } catch (error) {
      ui.notifications.error(`Falha ao limpar backups: ${error.message}`);
    }
  }

  _showBackupDetails(backup) {
    const content = `
      <div class="backup-details">
        <h3>Detalhes do Backup</h3>
        <p><strong>ID:</strong> ${backup.id}</p>
        <p><strong>Tipo:</strong> ${backup.type}</p>
        <p><strong>Criado em:</strong> ${new Date(backup.timestamp).toLocaleString()}</p>
        <p><strong>Criado por:</strong> ${backup.createdBy}</p>
        <p><strong>Versão do Sistema:</strong> ${backup.systemVersion}</p>
        ${backup.actorData ? `<p><strong>Personagem:</strong> ${backup.actorData.name} (Nível ${backup.actorData.level})</p>` : ''}
        ${backup.itemData ? `<p><strong>Item:</strong> ${backup.itemData.name} (${backup.itemData.tier})</p>` : ''}
      </div>
    `;

    new Dialog({
      title: "Detalhes do Backup",
      content: content,
      buttons: {
        close: {
          label: "Fechar"
        }
      }
    }).render(true);
  }

  async _validateBackup(backupId) {
    try {
      const result = await BackupHelper.validateBackup(backupId);
      return result;
    } catch (error) {
      console.error(`${SYSTEM_ID} | Falha ao validar backup:`, error);
      return { valid: false, error: error.message };
    }
  }
}