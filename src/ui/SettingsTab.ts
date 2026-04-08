import { Notice, PluginSettingTab, Setting } from 'obsidian';

import { PLUGIN_NAME } from '../constants';
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

    // Async sections (stats + reindex)
    void this.renderIndexStatus();
    this.renderGeneralSettings(containerEl);
    this.renderChunkSettings(containerEl);
    this.renderSearchSettings(containerEl);
    this.renderSidebarSettings(containerEl);
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Indexing').setHeading();
    const configDir = this.app.vault.configDir;

    new Setting(containerEl)
      .setName('Excluded paths')
      .setDesc(`One pattern per line. Example: ${configDir}/**, *.excalidraw.md`)
      .addTextArea((textArea) => {
        textArea
          .setPlaceholder(`${configDir}/**\nnode_modules/**`)
          .setValue(this.plugin.settings.excludedPaths.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedPaths = value
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
        textArea.inputEl.rows = 4;
        textArea.inputEl.addClass('vault-search-textarea-wide');
      });

    this.addFloatSetting(
      containerEl,
      'Maximum file size (MB)',
      'Files larger than this size are not indexed.',
      '1',
      () => this.plugin.settings.maxFileSizeMB,
      (value) => {
        this.plugin.settings.maxFileSizeMB = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );

    this.addIntSetting(
      containerEl,
      'Default result limit',
      'Maximum number of results shown per search.',
      '10',
      () => this.plugin.settings.defaultLimit,
      (value) => {
        this.plugin.settings.defaultLimit = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );
  }

  private renderChunkSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Chunking').setHeading();

    this.addIntSetting(
      containerEl,
      'Maximum chunk token count',
      'Approximate token limit for each text chunk (default: 512).',
      '512',
      () => this.plugin.settings.chunkMaxTokens,
      (value) => {
        this.plugin.settings.chunkMaxTokens = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
    );

    this.addIntSetting(
      containerEl,
      'Chunk overlap token count',
      'Overlap between consecutive chunks (default: 50).',
      '50',
      () => this.plugin.settings.chunkOverlapTokens,
      (value) => {
        this.plugin.settings.chunkOverlapTokens = value;
      },
      (value) => !Number.isNaN(value) && value >= 0,
    );
  }

  private renderSearchSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Search weights').setHeading();

    new Setting(containerEl)
      .setName('Search mode')
      .setDesc('Hybrid mode uses keyword ranking with semantic and title signals; semantic-only mode uses vector similarity only.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('hybrid', 'Hybrid')
          .addOption('semantic-only', 'Semantic only')
          .setValue(this.plugin.settings.searchMode)
          .onChange(async (value) => {
            this.plugin.settings.searchMode = value as 'hybrid' | 'semantic-only';
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('p', {
      text: 'The weights for keyword, vector, and title signals must total 1.0.',
      cls: 'setting-item-description',
    });

    this.addFloatSetting(
      containerEl,
      'BM25 (keyword) weight',
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
      'Vector (semantic) weight',
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
      'Title weight',
      undefined,
      '0.1',
      () => this.plugin.settings.weights.title,
      (value) => {
        this.plugin.settings.weights.title = value;
      },
      (value) => !Number.isNaN(value) && value >= 0 && value <= 1,
    );

    new Setting(containerEl)
      .setName('Show scores')
      .setDesc('Show keyword, vector, and reciprocal rank fusion scores next to each result.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showScores).onChange(async (value) => {
          this.plugin.settings.showScores = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderSidebarSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Sidebar').setHeading();

    new Setting(containerEl)
      .setName('Enable sidebar')
      .setDesc('Open the related notes sidebar at startup.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebarEnabled).onChange(async (value) => {
          this.plugin.settings.sidebarEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    this.addIntSetting(
      containerEl,
      'Sidebar result limit',
      undefined,
      '8',
      () => this.plugin.settings.sidebarLimit,
      (value) => {
        this.plugin.settings.sidebarLimit = value;
      },
      (value) => !Number.isNaN(value) && value > 0,
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
    new Setting(section).setName('Index status').setHeading();

    if (!stats) {
      section.createEl('p', { text: 'Store is not initialized.' });
      return;
    }

    const list = section.createEl('ul');
    list.createEl('li', { text: `Total files: ${stats.totalFiles}` });
    list.createEl('li', { text: `Total chunks: ${stats.totalChunks}` });
    list.createEl('li', { text: `Status: ${stats.status}` });
    list.createEl('li', { text: `Model: ${stats.modelName}` });
    list.createEl('li', { text: `Dimension: ${stats.modelDimension}` });
    list.createEl('li', { text: `DB size: ${(stats.dbSizeBytes / 1024).toFixed(1)} KB` });
    list.createEl('li', {
      text: `Last full scan: ${stats.lastFullIndex ? new Date(stats.lastFullIndex).toLocaleString('en-US') : 'never'}`,
    });

    // Model download progress bar (hidden until model is loading)
    const progressWrapper = section.createDiv({ cls: 'vault-search-progress-bar is-hidden' });
    const progressFill = progressWrapper.createDiv({ cls: 'vault-search-progress-fill' });
    progressFill.setCssProps({ '--vs-progress': '0%' });

    this.plugin.embedder?.setProgressCallback((loaded, total) => {
      if (total > 0) {
        const pct = Math.round((loaded / total) * 100);
        progressWrapper.removeClass('is-hidden');
        progressFill.setCssProps({ '--vs-progress': `${pct}%` });
        if (pct >= 100) {
          window.setTimeout(() => {
            progressWrapper.addClass('is-hidden');
          }, 1000);
        }
      }
    });

    // Reindex button
    new Setting(section)
      .setName('Reindex all')
      .setDesc('Scans the entire vault from scratch. Existing index is removed.')
      .addButton((button) =>
        button
          .setButtonText('Reindex')
          .setWarning()
          .onClick(async () => {
            button.setButtonText('Indexing...').setDisabled(true);
            try {
              await this.plugin.indexer.reindexAll();
              new Notice(`${PLUGIN_NAME}: indexing complete.`);
            } catch (err) {
              new Notice('Indexing error: ' + String(err));
            } finally {
              button.setButtonText('Reindex').setDisabled(false);
              this.display();
            }
          }),
      );
  }
}
