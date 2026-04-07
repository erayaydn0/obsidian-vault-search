import { Notice, PluginSettingTab, Setting } from 'obsidian';

import type VaultSearchPlugin from '../main';

export class VaultSearchSettingsTab extends PluginSettingTab {
  private readonly plugin: VaultSearchPlugin;

  constructor(app: PluginSettingTab['app'], plugin: VaultSearchPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'VaultSearch' });

    // Async sections (stats + reindex)
    void this.renderIndexStatus();
    this.renderGeneralSettings(containerEl);
    this.renderChunkSettings(containerEl);
    this.renderSearchSettings(containerEl);
    this.renderSidebarSettings(containerEl);
    this.renderMcpSettings(containerEl);
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Genel' });

    new Setting(containerEl)
      .setName('Hariç tutulan yollar')
      .setDesc('Satır başına bir desen. Örnek: .obsidian/**, *.excalidraw.md')
      .addTextArea((textArea) => {
        textArea
          .setPlaceholder('.obsidian/**\nnode_modules/**')
          .setValue(this.plugin.settings.excludedPaths.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedPaths = value
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
        textArea.inputEl.rows = 4;
        textArea.inputEl.style.width = '100%';
      });

    this.addFloatSetting(
      containerEl,
      'Maksimum dosya boyutu (MB)',
      'Bu boyutun üzerindeki dosyalar indexlenmez.',
      '1',
      () => this.plugin.settings.maxFileSizeMB,
      (value) => {
        this.plugin.settings.maxFileSizeMB = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );

    this.addIntSetting(
      containerEl,
      'Varsayılan sonuç limiti',
      'Arama başına gösterilecek maksimum sonuç sayısı.',
      '10',
      () => this.plugin.settings.defaultLimit,
      (value) => {
        this.plugin.settings.defaultLimit = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );
  }

  private renderChunkSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Parçalama (Chunking)' });

    this.addIntSetting(
      containerEl,
      'Maksimum chunk token sayısı',
      'Her metin parçasının tahmini token limiti (varsayılan: 512).',
      '512',
      () => this.plugin.settings.chunkMaxTokens,
      (value) => {
        this.plugin.settings.chunkMaxTokens = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );

    this.addIntSetting(
      containerEl,
      'Örtüşme token sayısı',
      'Ardışık chunk\'lar arasındaki örtüşme (varsayılan: 50).',
      '50',
      () => this.plugin.settings.chunkOverlapTokens,
      (value) => {
        this.plugin.settings.chunkOverlapTokens = value;
      },
      (value) => !Number.isNaN(value) && value >= 0,
    );
  }

  private renderSearchSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Arama Ağırlıkları' });

    new Setting(containerEl)
      .setName('Arama modu')
      .setDesc('Hybrid: BM25 + semantik + başlık. Sadece semantik: yalnızca vektör benzerliği.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('hybrid', 'Hybrid (karma)')
          .addOption('semantic-only', 'Sadece semantik')
          .setValue(this.plugin.settings.searchMode)
          .onChange(async (value) => {
            this.plugin.settings.searchMode = value as 'hybrid' | 'semantic-only';
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('p', {
      text: 'BM25 + vektör + başlık ağırlıkları toplamı 1.0 olmalıdır.',
      cls: 'setting-item-description',
    });

    this.addFloatSetting(
      containerEl,
      'BM25 (anahtar kelime) ağırlığı',
      undefined,
      '0.3',
      () => this.plugin.settings.weights.bm25,
      (value) => {
        this.plugin.settings.weights.bm25 = value;
      },
      (value) => !Number.isNaN(value) && value >= 0 && value <= 1,
    );

    this.addFloatSetting(
      containerEl,
      'Vektör (semantik) ağırlığı',
      undefined,
      '0.6',
      () => this.plugin.settings.weights.vector,
      (value) => {
        this.plugin.settings.weights.vector = value;
      },
      (value) => !Number.isNaN(value) && value >= 0 && value <= 1,
    );

    this.addFloatSetting(
      containerEl,
      'Başlık (title) ağırlığı',
      undefined,
      '0.1',
      () => this.plugin.settings.weights.title,
      (value) => {
        this.plugin.settings.weights.title = value;
      },
      (value) => !Number.isNaN(value) && value >= 0 && value <= 1,
    );

    new Setting(containerEl)
      .setName('Puanları göster')
      .setDesc('Sonuçlarda BM25/vektör/RRF puanlarını göster.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showScores).onChange(async (value) => {
          this.plugin.settings.showScores = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderSidebarSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Kenar Çubuğu' });

    new Setting(containerEl)
      .setName('Kenar çubuğunu etkinleştir')
      .setDesc('Başlangıçta ilgili notlar kenar çubuğunu açar.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebarEnabled).onChange(async (value) => {
          this.plugin.settings.sidebarEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    this.addIntSetting(
      containerEl,
      'Kenar çubuğu sonuç limiti',
      undefined,
      '8',
      () => this.plugin.settings.sidebarLimit,
      (value) => {
        this.plugin.settings.sidebarLimit = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );
  }

  private renderMcpSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'MCP Sunucusu' });

    new Setting(containerEl)
      .setName('MCP sunucusunu etkinleştir')
      .setDesc('Localhost\'ta bir MCP HTTP sunucusu başlatır (Claude Desktop entegrasyonu).')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mcpEnabled).onChange(async (value) => {
          this.plugin.settings.mcpEnabled = value;
          await this.plugin.saveSettings();
          if (value) {
            await this.plugin.startMCPServer();
          } else {
            this.plugin.stopMCPServer();
          }
        }),
      );

    this.addIntSetting(
      containerEl,
      'MCP port',
      'Yerel MCP sunucusunun dinleyeceği port.',
      '3939',
      () => this.plugin.settings.mcpPort,
      (value) => {
        this.plugin.settings.mcpPort = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );

    new Setting(containerEl)
      .setName('Claude Desktop yapılandırması')
      .setDesc(`Claude Desktop'ın claude_desktop_config.json dosyasına eklenecek snippet.`)
      .addButton((button) =>
        button.setButtonText('Kopyala').onClick(() => {
          const config = JSON.stringify(
            {
              mcpServers: {
                'vault-search': {
                  url: `http://localhost:${this.plugin.settings.mcpPort}/mcp`,
                },
              },
            },
            null,
            2,
          );
          navigator.clipboard.writeText(config).then(
            () => new Notice('Claude Desktop yapılandırması panoya kopyalandı.'),
            () => new Notice('Kopyalama başarısız.'),
          );
        }),
      );
  }

  private addIntSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string | undefined,
    placeholder: string,
    getValue: () => number,
    setValue: (value: number) => void,
    validate: (value: number) => boolean,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc ?? '')
      .addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(String(getValue()))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (!validate(parsed)) return;
            setValue(parsed);
            await this.plugin.saveSettings();
          });
      });
  }

  private addFloatSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string | undefined,
    placeholder: string,
    getValue: () => number,
    setValue: (value: number) => void,
    validate: (value: number) => boolean,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc ?? '')
      .addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(String(getValue()))
          .onChange(async (value) => {
            const parsed = Number.parseFloat(value);
            if (!validate(parsed)) return;
            setValue(parsed);
            await this.plugin.saveSettings();
          });
      });
  }

  // ---------------------------------------------------------------------------

  private async renderIndexStatus(): Promise<void> {
    const stats = await this.plugin.store?.getStats();
    const containerEl = this.containerEl;

    const section = containerEl.createDiv({ cls: 'vault-search-settings-stats' });
    section.createEl('h3', { text: 'Index Durumu' });

    if (!stats) {
      section.createEl('p', { text: 'Store başlatılmadı.' });
      return;
    }

    const list = section.createEl('ul');
    list.createEl('li', { text: `Toplam dosya: ${stats.totalFiles}` });
    list.createEl('li', { text: `Toplam chunk: ${stats.totalChunks}` });
    list.createEl('li', { text: `Durum: ${stats.status}` });
    list.createEl('li', { text: `Model: ${stats.modelName}` });
    list.createEl('li', { text: `Boyut: ${stats.modelDimension}` });
    list.createEl('li', { text: `DB boyutu: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB` });
    list.createEl('li', {
      text: `Son tam tarama: ${stats.lastFullIndex ? new Date(stats.lastFullIndex).toLocaleString('tr-TR') : 'hiç yapılmadı'}`,
    });

    // Model download progress bar (hidden until model is loading)
    const progressWrapper = section.createDiv({ cls: 'vault-search-progress-bar' });
    const progressFill = progressWrapper.createDiv({ cls: 'vault-search-progress-fill' });
    progressFill.style.width = '0%';
    progressWrapper.style.display = 'none';

    this.plugin.embedder?.setProgressCallback((loaded, total) => {
      if (total > 0) {
        const pct = Math.round((loaded / total) * 100);
        progressWrapper.style.display = 'block';
        progressFill.style.width = `${pct}%`;
        if (pct >= 100) {
          window.setTimeout(() => {
            progressWrapper.style.display = 'none';
          }, 1000);
        }
      }
    });

    // Reindex button
    new Setting(section)
      .setName('Tümünü yeniden indexle')
      .setDesc('Tüm vault\'u sıfırdan tarar. Mevcut index silinir.')
      .addButton((button) =>
        button
          .setButtonText('Yeniden İndeksile')
          .setWarning()
          .onClick(async () => {
            button.setButtonText('İndeksleniyor...').setDisabled(true);
            try {
              await this.plugin.indexer.reindexAll();
              new Notice('VaultSearch indexleme tamamlandı.');
            } catch (err) {
              new Notice('İndeksleme hatası: ' + String(err));
            } finally {
              button.setButtonText('Yeniden İndeksile').setDisabled(false);
              this.display();
            }
          }),
      );
  }
}
