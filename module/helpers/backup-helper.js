/**
 * Helper para gerenciamento de backup do sistema Nihility RPG System
 */
import { SYSTEM_ID } from "../config.js";

export class BackupHelper {
  static async createBackup(document) {
    try {
      // Ajuste para compatibilidade com Foundry V14
      const docType = document.documentName || document.type || document.constructor.name;

      const backupData = {
        id: `${SYSTEM_ID}-backup-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: docType,
        documentId: document.id,
        data: document.toObject(),
        createdBy: game.user.id,
        systemVersion: game.system.version
      };

      // Salvar backup em um local seguro (pode ser no localStorage ou em um compêndio)
      await this._saveBackup(backupData);

      console.log(`${SYSTEM_ID} | Backup criado para ${docType} (${document.id})`);
      return backupData;
    } catch (error) {
      console.error(`${SYSTEM_ID} | Falha ao criar backup:`, error);
      throw new Error("Falha ao criar backup");
    }
  }

  static async restoreFromBackup(backupId, documentId) {
    try {
      const backup = await this._getBackup(backupId);
      if (!backup) {
        throw new Error("Backup não encontrado");
      }

      // Verificar se o documento ainda existe
      let document;

      // Para Foundry V14, usar o método correto de acesso ao documento
      if (game.actors?.get(documentId)) {
        document = game.actors.get(documentId);
      } else if (game.items?.get(documentId)) {
        document = game.items.get(documentId);
      } else if (game.scenes?.get(documentId)) {
        document = game.scenes.get(documentId);
      } else if (game.compendiums?.get(documentId)) {
        // Para compêndios, precisamos de um método diferente
        document = await fromUuid(documentId);
      }

      if (!document) {
        throw new Error("Documento original não encontrado");
      }

      // Aplicar backup ao documento
      await document.update(backup.data);

      console.log(`${SYSTEM_ID} | Backup restaurado para ${document.documentName} (${documentId})`);
      return true;
    } catch (error) {
      console.error(`${SYSTEM_ID} | Falha ao restaurar backup:`, error);
      throw new Error("Falha ao restaurar backup");
    }
  }

  static async _saveBackup(backupData) {
    // Implementação do salvamento - pode ser localStorage, compêndio ou outro mecanismo
    const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
    backups.push(backupData);

    // Manter apenas os últimos 50 backups para evitar sobrecarga
    if (backups.length > 50) {
      backups.shift();
    }

    localStorage.setItem(`${SYSTEM_ID}-backups`, JSON.stringify(backups));
  }

  static async _getBackup(backupId) {
    const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
    return backups.find(b => b.id === backupId);
  }

  static async getRecentBackups(limit = 10) {
    try {
      const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
      return backups.slice(-limit).reverse();
    } catch (error) {
      console.error(`${SYSTEM_ID} | Falha ao listar backups:`, error);
      return [];
    }
  }

  static async getBackupsForDocument(documentId, limit = 5) {
    try {
      const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
      return backups
        .filter(b => b.documentId === documentId)
        .slice(-limit)
        .reverse();
    } catch (error) {
      console.error(`${SYSTEM_ID} | Falha ao buscar backups do documento:`, error);
      return [];
    }
  }

  static async createBackupForActor(actor) {
    if (!actor || actor.documentName !== "Actor") return null;

    const backup = await this.createBackup(actor);
    // Adicionar informações específicas para personagens
    backup.actorData = {
      name: actor.name,
      type: actor.type,
      level: actor.system?.attributes?.level || 0
    };

    // Atualizar o backup salvo com dados específicos
    await this._updateBackup(backup);

    return backup;
  }

  static async createBackupForItem(item) {
    if (!item || item.documentName !== "Item") return null;

    const backup = await this.createBackup(item);
    // Adicionar informações específicas para itens
    backup.itemData = {
      name: item.name,
      type: item.type,
      tier: item.system?.tier || "normal"
    };

    // Atualizar o backup salvo com dados específicos
    await this._updateBackup(backup);

    return backup;
  }

  static async _updateBackup(backupData) {
    const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
    const index = backups.findIndex(b => b.id === backupData.id);

    if (index >= 0) {
      backups[index] = backupData;
      localStorage.setItem(`${SYSTEM_ID}-backups`, JSON.stringify(backups));
    }
  }

  static async validateBackup(backupId) {
    try {
      const backup = await this._getBackup(backupId);
      if (!backup) return { valid: false, error: "Backup não encontrado" };

      // Verificar integridade básica do backup
      if (!backup.data || !backup.timestamp) {
        return { valid: false, error: "Dados do backup inválidos" };
      }

      return { valid: true, backup: backup };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  static async cleanupOldBackups(maxAgeDays = 30) {
    try {
      const backups = JSON.parse(localStorage.getItem(`${SYSTEM_ID}-backups`) || "[]");
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - (maxAgeDays * 24 * 60 * 60 * 1000));

      const validBackups = backups.filter(backup => {
        const backupDate = new Date(backup.timestamp);
        return backupDate > cutoffDate;
      });

      localStorage.setItem(`${SYSTEM_ID}-backups`, JSON.stringify(validBackups));
      console.log(`${SYSTEM_ID} | Backup antigo removido: ${backups.length - validBackups.length} backups removidos`);
    } catch (error) {
      console.error(`${SYSTEM_ID} | Falha ao limpar backups antigos:`, error);
    }
  }
}