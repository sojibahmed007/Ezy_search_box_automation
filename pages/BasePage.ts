import { Page } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForPageLoaded() {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
