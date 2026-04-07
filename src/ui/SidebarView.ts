import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';

import { VIEW_TYPE_SIDEBAR } from '../constants';
import { SearchEngine } from '../core/SearchEngine';
import type { SearchResult, VaultSearchSettings } from '../types';

export class SidebarView extends ItemView {
  private readonly search: SearchEngine;
  private readonly settings: VaultSearchSettings;
  private currentPath = '';
  private listEl: HTMLDivElement | null = null;
  private latestRequestId = 0;

  constructor(leaf: WorkspaceLeaf, search: SearchEngine, settings: VaultSearchSettings) {
    super(leaf);
    this.search = search;
    this.settings = settings;
  }

  getViewType(): string {
    return VIEW_TYPE_SIDEBAR;
  }

  getDisplayText(): string {
    return 'Related notes';
  }

  getIcon(): string {
    return 'search';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('vault-search-sidebar');

    this.contentEl.createDiv({ text: 'Related notes', cls: 'vault-search-sidebar-title' });
    this.listEl = this.contentEl.createDiv({ cls: 'vault-search-sidebar-list' });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => void this.refreshForActiveFile()),
    );

    await this.refreshForActiveFile();
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    this.listEl = null;
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------------

  private async refreshForActiveFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const path = activeFile instanceof TFile ? activeFile.path : '';

    if (path === this.currentPath) return;
    this.currentPath = path;

    await this.renderResults(path);
  }

  private async renderResults(path: string): Promise<void> {
    if (!this.listEl) return;
    const requestId = ++this.latestRequestId;

    this.listEl.empty();

    if (!path) {
      this.listEl.createEl('p', {
        text: 'Open a note to see related notes.',
        cls: 'vault-search-sidebar-hint',
      });
      return;
    }

    // Show loading state
    const loadingEl = this.listEl.createEl('p', {
      text: 'Loading...',
      cls: 'vault-search-sidebar-hint',
    });

    let results: SearchResult[] = [];
    let hasError = false;
    try {
      results = await this.search.getRelated(path, { limit: this.settings.sidebarLimit });
    } catch (err) {
      hasError = true;
      console.error('[VaultSearch] Sidebar getRelated failed:', err);
    }
    if (requestId !== this.latestRequestId || path !== this.currentPath || !this.listEl) {
      return;
    }

    loadingEl.remove();

    if (hasError) {
      this.listEl.createEl('p', {
        text: 'An error occurred while loading related notes.',
        cls: 'vault-search-sidebar-hint',
      });
      return;
    }

    if (results.length === 0) {
      this.listEl.createEl('p', {
        text: 'No related notes found.',
        cls: 'vault-search-sidebar-hint',
      });
      return;
    }

    for (const result of results) {
      const item = this.listEl.createDiv({ cls: 'vault-search-sidebar-item' });

      const titleEl = item.createEl('div', {
        text: result.title,
        cls: 'vault-search-sidebar-item-title',
      });

      item.createEl('div', {
        text: result.snippet,
        cls: 'vault-search-sidebar-item-snippet',
      });

      // Drag-to-link: let users drag the title text as a wikilink
      titleEl.setAttribute('draggable', 'true');
      titleEl.addEventListener('dragstart', (event) => {
        const wikilink = `[[${result.title}]]`;
        event.dataTransfer?.setData('text/plain', wikilink);
      });

      item.addEventListener('click', () => {
        void this.app.workspace.openLinkText(result.path, path, false);
      });
    }
  }
}
