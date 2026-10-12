import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class SearchModal extends BasePage {
  readonly searchTriggerBtn: Locator;
  readonly dialog: Locator;
  readonly searchInput: Locator;
  readonly clearButton: Locator;
  readonly recentSearchesHeader: Locator;
  readonly noRecentSearchesText: Locator;

  // Filter tabs
  readonly allTab: Locator;
  readonly postsTab: Locator;
  readonly commentsTab: Locator;
  readonly peopleTab: Locator;
  readonly libraryTab: Locator;

  constructor(page: Page) {
    super(page);
    this.searchTriggerBtn = page.getByRole('button', { name: /Search community/i }).first();
    this.dialog = page.locator('[role="dialog"]').first();
    this.searchInput = page.getByRole('textbox', { name: 'Search community' });
    this.clearButton = page.locator('[role="dialog"] button[aria-label="Clear"], [role="dialog"] svg.lucide-x').first();
    this.recentSearchesHeader = page.locator('text="Recent searches"').first();
    this.noRecentSearchesText = page.locator('text="No recent searches"').first();

    this.allTab = page.locator('[role="dialog"] button:has-text("All"), [role="dialog"] [role="tab"]:has-text("All")').first();
    this.postsTab = page.locator('[role="dialog"] button:has-text("Posts"), [role="dialog"] [role="tab"]:has-text("Posts")').first();
    this.commentsTab = page.locator('[role="dialog"] button:has-text("Comments"), [role="dialog"] [role="tab"]:has-text("Comments")').first();
    this.peopleTab = page.locator('[role="dialog"] button:has-text("People"), [role="dialog"] [role="tab"]:has-text("People")').first();
    this.libraryTab = page.locator('[role="dialog"] button:has-text("Library"), [role="dialog"] [role="tab"]:has-text("Library")').first();
  }

  async openViaButton() {
    const trigger = this.page.locator('button:has-text("Search"), button[aria-label*="Search" i]').first();
    if (await trigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await trigger.click();
    } else {
      await this.openViaShortcut();
    }
    await this.searchInput.waitFor({ state: 'visible', timeout: 8000 });
  }

  async openViaShortcut() {
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await this.searchInput.waitFor({ state: 'visible', timeout: 5000 });
  }

  async closeViaEscape() {
    await this.page.keyboard.press('Escape');
    await this.dialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  async search(query: string, delayBetweenChars: number = 0) {
    await this.searchInput.fill('');
    if (delayBetweenChars > 0) {
      await this.searchInput.pressSequentially(query, { delay: delayBetweenChars });
    } else {
      await this.searchInput.fill(query);
    }
  }

  async getInputValue(): Promise<string> {
    return await this.searchInput.inputValue();
  }

  async isModalVisible(): Promise<boolean> {
    return await this.dialog.isVisible();
  }
}
