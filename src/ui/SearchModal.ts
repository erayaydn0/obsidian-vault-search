import { Modal } from 'obsidian';

import { SEARCH_DEFAULTS } from '../constants';
import type { SearchResult } from '../types';
import { SearchEngine } from '../core/SearchEngine';

export class SearchModal extends Modal {
  private readonly search: SearchEngine;
  private inputEl: HTMLInputElement | null = null;
  private resultsEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private debounceHandle: number | null = null;
  private query = '';
  private results: SearchResult[] = [];
  private selectedIndex = -1;
  private latestRequestId = 0;
  private isLoading = false;
  private readonly listboxId = `vault-search-listbox-${Math.random().toString(36).slice(2, 9)}`;
  private readonly statusId = `vault-search-status-${Math.random().toString(36).slice(2, 9)}`;

  constructor(app: Modal['app'], search: SearchEngine) {
    super(app);
    this.search = search;
  }

  onOpen(): void {
    this.modalEl.addClass('vault-search-modal');
    const { contentEl } = this;
    contentEl.empty();

    const inputWrapper = contentEl.createDiv({ cls: 'vault-search-input-wrapper' });
    this.inputEl = inputWrapper.createEl('input', {
      type: 'search',
      placeholder: 'Search your notes...',
      cls: 'vault-search-input',
    });
    this.inputEl.setAttribute('role', 'combobox');
    this.inputEl.setAttribute('aria-autocomplete', 'list');
    this.inputEl.setAttribute('aria-controls', this.listboxId);
    this.inputEl.setAttribute('aria-expanded', 'false');
    this.inputEl.setAttribute('aria-describedby', this.statusId);

    this.inputEl.addEventListener('input', () => this.scheduleSearch());
    this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e));

    this.statusEl = contentEl.createDiv({
      cls: 'vault-search-status vault-search-sr-only',
      attr: { 'aria-live': 'polite' },
    });
    this.statusEl.id = this.statusId;

    this.resultsEl = contentEl.createDiv({ cls: 'vault-search-results' });
    this.resultsEl.id = this.listboxId;
    this.resultsEl.setAttribute('role', 'listbox');
    this.resultsEl.setAttribute('aria-label', 'Search results');
    this.renderResults([]);

    window.setTimeout(() => this.inputEl?.focus(), 0);
  }

  onClose(): void {
    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
    }
    this.contentEl.empty();
  }

  private scheduleSearch(): void {
    if (!this.inputEl) return;

    if (this.debounceHandle !== null) {
      window.clearTimeout(this.debounceHandle);
    }

    this.isLoading = true;
    this.renderResults(this.results);
    this.debounceHandle = window.setTimeout(async () => {
      const requestId = ++this.latestRequestId;
      this.query = this.inputEl?.value ?? '';
      const results = await this.search.search(this.query);
      if (requestId !== this.latestRequestId) {
        return;
      }
      this.isLoading = false;
      this.results = results;
      this.selectedIndex = results.length > 0 ? 0 : -1;
      this.renderResults(results);
    }, SEARCH_DEFAULTS.DEBOUNCE_MS);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (this.results.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex =
          this.selectedIndex >= this.results.length - 1 ? 0 : Math.min(this.selectedIndex + 1, this.results.length - 1);
        this.updateSelection();
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex =
          this.selectedIndex <= 0 ? this.results.length - 1 : Math.max(this.selectedIndex - 1, 0);
        this.updateSelection();
        break;

      case 'Home':
        event.preventDefault();
        this.selectedIndex = 0;
        this.updateSelection();
        break;

      case 'End':
        event.preventDefault();
        this.selectedIndex = this.results.length - 1;
        this.updateSelection();
        break;

      case 'Enter':
        event.preventDefault();
        if (this.selectedIndex >= 0) {
          void this.openResult(this.results[this.selectedIndex]!);
        }
        break;
    }
  }

  private updateSelection(): void {
    if (!this.resultsEl || !this.inputEl) return;

    const items = this.resultsEl.querySelectorAll('.vault-search-result');
    items.forEach((item, index) => {
      const itemEl = item as HTMLElement;
      if (index === this.selectedIndex) {
        item.addClass('is-selected');
        itemEl.setAttribute('aria-selected', 'true');
        this.inputEl?.setAttribute('aria-activedescendant', itemEl.id);
        itemEl.scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('is-selected');
        itemEl.setAttribute('aria-selected', 'false');
      }
    });
    if (this.selectedIndex < 0) {
      this.inputEl.removeAttribute('aria-activedescendant');
    }
  }

  private async openResult(result: SearchResult): Promise<void> {
    await this.app.workspace.openLinkText(result.path, '', false);
    this.close();
  }

  private renderResults(results: SearchResult[]): void {
    if (!this.resultsEl || !this.inputEl) return;

    this.resultsEl.empty();
    this.resultsEl.removeClass('vault-search-results-loading');

    const trimmedQuery = (this.inputEl.value ?? '').trim();
    const displayQuery = this.inputEl.value ?? this.query;
    const showList = results.length > 0;
    this.inputEl.setAttribute('aria-expanded', showList ? 'true' : 'false');
    this.inputEl.removeAttribute('aria-activedescendant');

    if (this.isLoading && trimmedQuery.length >= SEARCH_DEFAULTS.MIN_QUERY_LENGTH) {
      if (results.length > 0) {
        this.resultsEl.addClass('vault-search-results-loading');
        this.resultsEl.createDiv({ cls: 'vault-search-loading-banner', text: 'Searching...' });
        this.renderResultItems(results);
        this.setStatus('Searching...');
        this.updateSelection();
        return;
      }
      this.resultsEl.createEl('p', { text: 'Searching...', cls: 'vault-search-hint vault-search-hint-loading' });
      this.setStatus('Searching...');
      return;
    }

    if (trimmedQuery.length > 0 && trimmedQuery.length < SEARCH_DEFAULTS.MIN_QUERY_LENGTH) {
      this.resultsEl.createEl('p', { text: 'Enter at least 2 characters to search.', cls: 'vault-search-hint' });
      this.setStatus('Enter at least 2 characters to search.');
      return;
    }

    if (results.length === 0) {
      this.resultsEl.createEl('p', {
        text:
          trimmedQuery.length >= SEARCH_DEFAULTS.MIN_QUERY_LENGTH
            ? `No results found for "${displayQuery}".`
            : 'Start typing to search.',
        cls: 'vault-search-hint',
      });
      if (trimmedQuery.length >= SEARCH_DEFAULTS.MIN_QUERY_LENGTH) {
        this.setStatus(`No results found for "${displayQuery}".`);
      } else {
        this.setStatus('Start typing to search.');
      }
      return;
    }

    this.setStatus(`${results.length} result(s) found.`);
    this.renderResultItems(results);
    this.updateSelection();
  }

  private renderResultItems(results: SearchResult[]): void {
    if (!this.resultsEl) return;

    for (let index = 0; index < results.length; index++) {
      const result = results[index]!;
      const item = this.resultsEl.createDiv({
        cls: `vault-search-result${index === this.selectedIndex ? ' is-selected' : ''}`,
      });
      item.id = `${this.listboxId}-option-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === this.selectedIndex ? 'true' : 'false');
      item.tabIndex = -1;

      const header = item.createDiv({ cls: 'vault-search-result-header' });
      header.createEl('span', { text: result.title, cls: 'vault-search-result-title' });

      const badge = result.matchType;
      header.createEl('span', {
        text: badge,
        cls: `vault-search-result-badge vault-search-badge-${badge}`,
      });

      if (result.heading) {
        item.createEl('div', {
          text: `§ ${result.heading}`,
          cls: 'vault-search-result-heading',
        });
      }

      item.createEl('div', { text: result.snippet, cls: 'vault-search-result-snippet' });
      item.createEl('div', { text: result.path, cls: 'vault-search-result-path' });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      item.addEventListener('click', () => void this.openResult(result));
    }
  }

  private setStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.setText(message);
    }
  }
}
