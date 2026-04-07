import { Notice, Plugin } from 'obsidian';

import { PLUGIN_NAME, VIEW_TYPE_SIDEBAR } from './constants';
import { EmbeddingEngine } from './core/EmbeddingEngine';
import { SearchEngine } from './core/SearchEngine';
import { SQLiteStore } from './core/SQLiteStore/index';
import { VaultIndexer } from './core/VaultIndexer';
import { VaultMCPServer } from './mcp/MCPServer';
import type { VaultSearchSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { SearchModal } from './ui/SearchModal';
import { VaultSearchSettingsTab } from './ui/SettingsTab';
import { SidebarView } from './ui/SidebarView';

export default class VaultSearchPlugin extends Plugin {
  settings: VaultSearchSettings = cloneSettings(DEFAULT_SETTINGS);
  store!: SQLiteStore;
  embedder!: EmbeddingEngine;
  indexer!: VaultIndexer;
  search!: SearchEngine;
  mcpServer: VaultMCPServer | null = null;

  private statusItem: ReturnType<Plugin['addStatusBarItem']> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new SQLiteStore(this.app, this.settings);
    await this.store.initialize();

    this.statusItem = this.addStatusBarItem();
    this.setStatus('ready');

    // Load the bundled Web Worker source + WASM binary so EmbeddingEngine can
    // run inference off the main thread. If either read fails (unusual), we
    // fall back to the in-process hash embedder without crashing the plugin.
    // `manifest.dir` is injected by Obsidian at runtime and points to the real
    // plugin folder (which may not match manifest.id — e.g. a dev checkout).
    const pluginAssetDir =
      (this.manifest as { dir?: string }).dir ?? `.obsidian/plugins/${this.manifest.id}`;
    let workerSource = '';
    let wasmBinary: ArrayBuffer | null = null;
    try {
      workerSource = await this.app.vault.adapter.read(`${pluginAssetDir}/worker.js`);
    } catch (err) {
      console.error('[VaultSearch] Failed to read embedding worker.js:', err);
    }
    try {
      wasmBinary = await this.app.vault.adapter.readBinary(
        `${pluginAssetDir}/ort-wasm-simd-threaded.wasm`,
      );
    } catch (err) {
      console.error('[VaultSearch] Failed to read ort-wasm-simd-threaded.wasm:', err);
    }

    this.embedder = new EmbeddingEngine(this.settings, workerSource, wasmBinary);

    this.embedder.setProgressCallback((loaded, total) => {
      const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
      this.setStatus(`downloading model ${pct}%`);
    });

    this.indexer = new VaultIndexer(this.app.vault, this.store, this.embedder, this.settings);
    this.search = new SearchEngine(this.store, this.embedder, this.settings);

    this.registerView(
      VIEW_TYPE_SIDEBAR,
      (leaf) => new SidebarView(leaf, this.search, this.settings),
    );

    this.addRibbonIcon('search', PLUGIN_NAME, () => {
      new SearchModal(this.app, this.search).open();
    });

    this.addCommand({
      id: 'open-search',
      name: 'Open search',
      callback: () => new SearchModal(this.app, this.search).open(),
    });

    this.addCommand({
      id: 'reindex-vault',
      name: 'Reindex vault',
      callback: () => {
        new Notice(`${PLUGIN_NAME}: starting full reindex…`);
        void this.indexer.reindexAll().then(
          () => {
            new Notice(`${PLUGIN_NAME}: reindex complete.`);
          },
          (error: unknown) => {
            console.error('[VaultSearch] reindex command failed', error);
            new Notice(`${PLUGIN_NAME}: reindex failed. Check console for details.`);
            this.setStatus('error');
          },
        );
      },
    });

    this.addSettingTab(new VaultSearchSettingsTab(this.app, this));

    this.statusItem.onClickEvent(() => {
      // Navigate to plugin settings
      (this.app as { setting?: { open: () => void; openTabById: (id: string) => void } })
        .setting?.openTabById('vault-search');
    });

    this.indexer.onProgress((progress) => {
      const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
      this.setStatus(`indexing ${pct}%`);
    });

    this.indexer.onComplete(() => {
      this.setStatus('ready');
    });

    this.registerVaultEvents();

    if (this.settings.sidebarEnabled) {
      await this.activateSidebar();
    }

    if (this.settings.mcpEnabled) {
      await this.startMCPServer();
    }

    setTimeout(() => {
      void this.indexer.initialScan().catch((error: unknown) => {
        console.error('[VaultSearch] initial scan failed', error);
        new Notice('VaultSearch failed while completing the initial scan.');
        this.setStatus('error');
      });
    }, 3000);
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
    this.mcpServer?.stop();
    this.embedder?.dispose();
    await this.store?.close();
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<VaultSearchSettings> | null;
    this.settings = {
      ...cloneSettings(DEFAULT_SETTINGS),
      ...loaded,
      weights: {
        ...DEFAULT_SETTINGS.weights,
        ...loaded?.weights,
      },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.store?.applySettings(this.settings);
    this.embedder?.applySettings(this.settings);
  }

  async startMCPServer(): Promise<void> {
    if (this.mcpServer?.isRunning()) {
      return;
    }
    this.mcpServer = new VaultMCPServer(this.search, this.store, this.settings.mcpPort);
    await this.mcpServer.start();
    if (this.mcpServer.isRunning()) {
      new Notice(`${PLUGIN_NAME}: MCP server started on port ${this.settings.mcpPort}.`);
    } else {
      new Notice(`${PLUGIN_NAME}: MCP server failed to start. Check console for details.`);
    }
  }

  stopMCPServer(): void {
    this.mcpServer?.stop();
    this.mcpServer = null;
  }

  private setStatus(text: string): void {
    this.statusItem?.setText(`${PLUGIN_NAME}: ${text}`);
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on('modify', (file) => void this.indexer.onFileChange(file)));
    this.registerEvent(this.app.vault.on('create', (file) => void this.indexer.onFileChange(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => void this.indexer.onFileDelete(file)));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => void this.indexer.onFileRename(file, oldPath)),
    );
  }

  private async activateSidebar(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
  }
}

function cloneSettings(settings: VaultSearchSettings): VaultSearchSettings {
  return {
    ...settings,
    excludedPaths: [...settings.excludedPaths],
    weights: { ...settings.weights },
  };
}
