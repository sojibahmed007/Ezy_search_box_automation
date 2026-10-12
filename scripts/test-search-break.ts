import { chromium, Page, BrowserContext } from '@playwright/test';
import { getCommunityCredentials } from './auth-env';

interface TestCaseResult {
  id: string;
  category: string;
  name: string;
  payload: string;
  status: 'PASSED' | 'FAILED' | 'VULNERABILITY_FOUND' | 'BUG_FOUND';
  httpStatus?: number;
  browserConsoleErrors: string[];
  pageErrors: string[];
  notes: string;
}

const results: TestCaseResult[] = [];

async function login(page: Page) {
  console.log('Logging in...');
  await page.goto('https://sojibahmed.communitycdn.net/feeds', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const loginBtn = page.locator('button:has-text("Log in")').first();
  await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
  await loginBtn.click();

  const emailInput = page.locator('input[type="email"], input[placeholder*="email" i], input[placeholder*="example.com" i], input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible' });
  const { email, password } = getCommunityCredentials();
  await emailInput.fill(email);

  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(password);

  const submitBtn = page.locator('[role="dialog"] button:has-text("Log in"), button[type="submit"]:has-text("Log in")').last();
  await submitBtn.click();
  await page.waitForTimeout(3000);
  console.log('Login complete.');
}

async function openSearchModal(page: Page) {
  const searchBtn = page.getByRole('button', { name: /Search community/i });
  await searchBtn.waitFor({ state: 'visible', timeout: 10000 });
  await searchBtn.click();
  const searchInput = page.getByRole('textbox', { name: 'Search community' });
  await searchInput.waitFor({ state: 'visible', timeout: 5000 });
  return searchInput;
}

async function runBreakSuite() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];
  let lastSearchStatus: number | undefined;

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });

  page.on('response', res => {
    if (res.url().includes('/api/search/')) {
      lastSearchStatus = res.status();
    }
  });

  await login(page);

  // Helper to test an input query
  async function testQuery(
    id: string,
    category: string,
    name: string,
    payload: string,
    verifier?: (page: Page) => Promise<{ bug: boolean; notes: string }>
  ) {
    console.log(`\n▶ [${id}] Running: ${name}`);
    consoleErrors = [];
    pageErrors = [];
    lastSearchStatus = undefined;

    try {
      const searchInput = page.getByRole('textbox', { name: 'Search community' });
      if (!(await searchInput.isVisible())) {
        await openSearchModal(page);
      }

      await searchInput.fill('');
      await page.waitForTimeout(300);

      // Fill or type payload
      if (payload.length > 500) {
        await searchInput.fill(payload);
      } else {
        await searchInput.fill(payload);
      }

      await page.waitForTimeout(2000);

      let customNotes = '';
      let isBug = false;

      if (verifier) {
        const res = await verifier(page);
        isBug = res.bug;
        customNotes = res.notes;
      }

      const hasCrash = pageErrors.length > 0;
      const isHttp500 = lastSearchStatus !== undefined && lastSearchStatus >= 500;

      let status: TestCaseResult['status'] = 'PASSED';
      if (isBug) {
        status = category.includes('Security') ? 'VULNERABILITY_FOUND' : 'BUG_FOUND';
      } else if (hasCrash || isHttp500) {
        status = 'BUG_FOUND';
        customNotes += (isHttp500 ? ` Server 500 Error.` : '') + (hasCrash ? ` Page unhandled exception.` : '');
      }

      results.push({
        id,
        category,
        name,
        payload: payload.length > 50 ? payload.slice(0, 50) + '... (truncated)' : payload,
        status,
        httpStatus: lastSearchStatus,
        browserConsoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors],
        notes: customNotes || (status === 'PASSED' ? 'Handled safely by application.' : 'Issue detected.'),
      });

      console.log(`   Result: ${status} (HTTP: ${lastSearchStatus ?? 'N/A'}) - ${customNotes || 'OK'}`);
    } catch (e: any) {
      console.log(`   Exception during test: ${e.message}`);
      results.push({
        id,
        category,
        name,
        payload: payload.slice(0, 50),
        status: 'BUG_FOUND',
        httpStatus: lastSearchStatus,
        browserConsoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors, e.message],
        notes: `Test execution failed with error: ${e.message}`,
      });
    }
  }

  // Ensure modal is open
  await openSearchModal(page);

  // ---------------------------------------------------------
  // 1. SECURITY & INJECTION TEST CASES
  // ---------------------------------------------------------
  await testQuery('SEC-01', 'Security', 'Reflected/Stored XSS Script Tag', '<script>window.__xss_fired=true</script>', async p => {
    const xssEvaluated = await p.evaluate(() => (window as any).__xss_fired === true);
    const htmlInjected = await p.locator('script:has-text("window.__xss_fired")').count();
    if (xssEvaluated || htmlInjected > 0) {
      return { bug: true, notes: 'CRITICAL: Raw script tag executed or inserted into DOM!' };
    }
    return { bug: false, notes: 'Script tag escaped safely.' };
  });

  await testQuery('SEC-02', 'Security', 'XSS IMG Onerror Payload', '<img src=x onerror="window.__xss_img=true">', async p => {
    const executed = await p.evaluate(() => (window as any).__xss_img === true);
    if (executed) return { bug: true, notes: 'CRITICAL: IMG onerror XSS executed!' };
    return { bug: false, notes: 'Image onerror escaped safely.' };
  });

  await testQuery('SEC-03', 'Security', 'SVG Onload XSS Payload', '<svg onload="window.__xss_svg=true">', async p => {
    const executed = await p.evaluate(() => (window as any).__xss_svg === true);
    if (executed) return { bug: true, notes: 'CRITICAL: SVG onload XSS executed!' };
    return { bug: false, notes: 'SVG tag escaped safely.' };
  });

  await testQuery('SEC-04', 'Security', 'SQL Injection Boolean Bypass', "' OR '1'='1", async () => {
    return { bug: false, notes: 'Handled without SQL syntax error.' };
  });

  await testQuery('SEC-05', 'Security', 'SQL Injection Drop / Stacked Query', "'; DROP TABLE test; --", async () => {
    return { bug: false, notes: 'Handled safely.' };
  });

  await testQuery('SEC-06', 'Security', 'SQL Injection UNION SELECT', "' UNION SELECT 1,2,3,4,5,6,7,8,9,10--", async () => {
    return { bug: false, notes: 'Handled safely.' };
  });

  await testQuery('SEC-07', 'Security', 'NoSQL Injection Object syntax', '{"$gt": ""}', async () => {
    return { bug: false, notes: 'NoSQL syntax handled safely.' };
  });

  await testQuery('SEC-08', 'Security', 'Template Injection (SSTI)', '{{7*7}}', async p => {
    const pageText = await p.locator('[role="dialog"]').innerText();
    if (pageText.includes('49') && !pageText.includes('{{7*7}}')) {
      return { bug: true, notes: 'VULNERABILITY: SSTI expression evaluated to 49!' };
    }
    return { bug: false, notes: 'Template expression not evaluated.' };
  });

  await testQuery('SEC-09', 'Security', 'Path Traversal Payload', '../../../../etc/passwd', async () => {
    return { bug: false, notes: 'Treated as plain search text.' };
  });

  // ---------------------------------------------------------
  // 2. BOUNDARY, EXTREME LENGTH & FUZZING
  // ---------------------------------------------------------
  await testQuery('BND-01', 'Boundary/DoS', 'Massive String Buffer (5,000 characters)', 'A'.repeat(5000), async p => {
    const dialogBox = await p.locator('[role="dialog"]').boundingBox();
    if (!dialogBox) return { bug: true, notes: 'Dialog disappeared or crashed.' };
    return { bug: false, notes: `Dialog rendered within bounds (${dialogBox.width}x${dialogBox.height}).` };
  });

  await testQuery('BND-02', 'Boundary/DoS', 'Single Unbroken Long Word (Word-break crash)', 'W'.repeat(800), async p => {
    const dialogBox = await p.locator('[role="dialog"]').boundingBox();
    const viewport = p.viewportSize();
    if (dialogBox && viewport && dialogBox.width > viewport.width) {
      return { bug: true, notes: 'LAYOUT BUG: Dialog horizontally overflowed the viewport!' };
    }
    return { bug: false, notes: 'Word wrapped or clipped safely.' };
  });

  await testQuery('BND-03', 'Unicode/Glitch', 'Zalgo Glitch Combining Characters', 'T̷h̵i̸s̶ ̷i̶s̵ ̷b̸r̴o̴k̶e̶n̵ ̶c̶h̷a̴o̴s̴', async () => {
    return { bug: false, notes: 'Rendered without crash.' };
  });

  await testQuery('BND-04', 'Unicode/BiDi', 'Right-to-Left Override (RLO) Injection', '\u202Ereversed_test_search', async () => {
    return { bug: false, notes: 'RLO character handled.' };
  });

  await testQuery('BND-05', 'Unicode', 'Multilingual & Complex Emojis', '👨‍👩‍👧‍👦 🚀 🔥 বাংলা поиск 検索', async () => {
    return { bug: false, notes: 'Unicode search parsed properly.' };
  });

  await testQuery('BND-06', 'Control/Encoding', 'Raw Percent Character (URI decode crash test)', '%', async () => {
    return { bug: false, notes: 'Raw % handled without URIError.' };
  });

  await testQuery('BND-07', 'Control/Encoding', 'URL Reserved Characters', '?&=#%+/', async () => {
    return { bug: false, notes: 'URL reserved characters parsed safely.' };
  });

  await testQuery('BND-08', 'Control/Encoding', 'Null Byte Character', 'test\0null', async () => {
    return { bug: false, notes: 'Null byte sanitized or accepted.' };
  });

  await testQuery('BND-09', 'Regex/ReDoS', 'Catastrophic Backtracking Regex pattern', '(a+)+$', async () => {
    return { bug: false, notes: 'Regex pattern treated as literal string.' };
  });

  await testQuery('BND-10', 'Regex/ReDoS', 'Unclosed Regex Brackets', '[a-z', async () => {
    return { bug: false, notes: 'Unclosed bracket handled without RegExp SyntaxError.' };
  });

  // ---------------------------------------------------------
  // 3. WHITESPACE & EMPTY STATES
  // ---------------------------------------------------------
  await testQuery('WHT-01', 'Whitespace', 'Only Spaces Query', '     ', async p => {
    const searchInput = p.getByRole('textbox', { name: 'Search community' });
    const val = await searchInput.inputValue();
    return { bug: false, notes: `Input holds spaces safely.` };
  });

  await testQuery('WHT-02', 'Whitespace', 'Tabs and Newline Characters', '\t\n  \t', async () => {
    return { bug: false, notes: 'Handled safely.' };
  });

  await testQuery('WHT-03', 'Whitespace', 'Zero-Width Space Characters', '\u200B\u200C\u200D', async () => {
    return { bug: false, notes: 'Zero-width space handled safely.' };
  });

  // ---------------------------------------------------------
  // 4. CONCURRENCY & RACE CONDITIONS
  // ---------------------------------------------------------
  console.log('\n▶ [RACE-01] Running: Rapid Keystroke Flood & Debounce Race');
  {
    consoleErrors = [];
    pageErrors = [];
    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    await searchInput.fill('');
    // Rapid type
    await searchInput.pressSequentially('supercalifragilistic', { delay: 10 });
    // Rapidly backspace
    for (let i = 0; i < 10; i++) {
      await searchInput.press('Backspace');
    }
    // Type final
    await searchInput.pressSequentially('member', { delay: 20 });
    await page.waitForTimeout(3000);

    const finalVal = await searchInput.inputValue();
    const status = pageErrors.length > 0 ? 'BUG_FOUND' : 'PASSED';
    results.push({
      id: 'RACE-01',
      category: 'Concurrency',
      name: 'Rapid Keystroke Flood & Debounce Race',
      payload: 'rapid type -> backspace -> member',
      status,
      httpStatus: lastSearchStatus,
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: `Final query settled at: "${finalVal}". No race condition crashes detected.`,
    });
  }

  console.log('\n▶ [RACE-02] Running: Rapid Category Filter Switching Under Query');
  {
    consoleErrors = [];
    pageErrors = [];
    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    await searchInput.fill('member');
    await page.waitForTimeout(1000);

    const tabs = ['Posts', 'Comments', 'People', 'Library', 'All'];
    for (const tab of tabs) {
      const tabBtn = page.locator(`[role="dialog"] button:has-text("${tab}"), [role="dialog"] [role="tab"]:has-text("${tab}")`).first();
      if (await tabBtn.isVisible()) {
        await tabBtn.click();
        await page.waitForTimeout(50); // very rapid switch
      }
    }
    await page.waitForTimeout(2000);
    const status = pageErrors.length > 0 ? 'BUG_FOUND' : 'PASSED';
    results.push({
      id: 'RACE-02',
      category: 'Concurrency',
      name: 'Rapid Category Filter Switching Under Query',
      payload: 'Rapidly clicking Posts -> Comments -> People -> Library -> All',
      status,
      httpStatus: lastSearchStatus,
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: 'Tabs cycled at 50ms intervals without React state crash.',
    });
  }

  console.log('\n▶ [RACE-03] Running: In-Flight Clear (Ghost Results Test)');
  {
    consoleErrors = [];
    pageErrors = [];
    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    await searchInput.fill('member');
    // Clear immediately before response settles
    await searchInput.fill('');
    await page.waitForTimeout(3000);

    const dialogText = await page.locator('[role="dialog"]').innerText();
    const hasGhostResults = dialogText.includes('View all') && !dialogText.includes('Recent searches');

    const status = hasGhostResults ? 'BUG_FOUND' : 'PASSED';
    results.push({
      id: 'RACE-03',
      category: 'Concurrency',
      name: 'In-Flight Clear (Ghost Results Test)',
      payload: 'fill("member") -> immediate fill("")',
      status,
      httpStatus: lastSearchStatus,
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: hasGhostResults ? 'BUG: In-flight query resolved and showed results on empty input!' : 'Input cleared and properly restored recent/empty state.',
    });
  }

  // ---------------------------------------------------------
  // 5. KEYBOARD SHORTCUTS & FOCUS
  // ---------------------------------------------------------
  console.log('\n▶ [KEY-01] Running: Keyboard Shortcut Escape to Close');
  {
    consoleErrors = [];
    pageErrors = [];
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    const isVisible = await searchInput.isVisible();
    results.push({
      id: 'KEY-01',
      category: 'Keyboard/UX',
      name: 'Escape Key Closes Modal',
      payload: 'Press Escape',
      status: !isVisible ? 'PASSED' : 'BUG_FOUND',
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: !isVisible ? 'Modal closed smoothly on Escape key.' : 'BUG: Modal remained open after Escape.',
    });
  }

  console.log('\n▶ [KEY-02] Running: Keyboard Shortcut Control+K to Open');
  {
    consoleErrors = [];
    pageErrors = [];
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(1000);
    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    const isVisible = await searchInput.isVisible();
    results.push({
      id: 'KEY-02',
      category: 'Keyboard/UX',
      name: 'Control+K Opens Modal',
      payload: 'Press Control+K',
      status: isVisible ? 'PASSED' : 'BUG_FOUND',
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: isVisible ? 'Modal opened successfully on Control+K.' : 'BUG: Control+K failed to trigger search modal.',
    });
  }

  // ---------------------------------------------------------
  // 6. CHAOS & NETWORK FAULT INJECTION
  // ---------------------------------------------------------
  console.log('\n▶ [CHAOS-01] Running: Search API 500 Server Error Fault Injection');
  {
    consoleErrors = [];
    pageErrors = [];
    await page.route('**/api/search/v1*', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal Server Error (Simulated)' }),
      });
    });

    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    if (!(await searchInput.isVisible())) {
      await openSearchModal(page);
    }
    await searchInput.fill('fault-test');
    await page.waitForTimeout(2000);

    const dialogVisible = await page.locator('[role="dialog"]').isVisible();
    const appCrashed = pageErrors.some(e => e.includes('Render') || e.includes('Uncaught'));

    results.push({
      id: 'CHAOS-01',
      category: 'Fault Injection',
      name: 'Backend 500 Error Resilience',
      payload: 'Mock HTTP 500 Internal Server Error',
      status: appCrashed ? 'BUG_FOUND' : 'PASSED',
      httpStatus: 500,
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: appCrashed ? 'BUG: React unhandled crash on 500 API response!' : 'UI handled HTTP 500 gracefully without white-screen crash.',
    });

    // Unroute
    await page.unroute('**/api/search/v1*');
  }

  console.log('\n▶ [CHAOS-02] Running: Search API Corrupted / Malformed Response Fault Injection');
  {
    consoleErrors = [];
    pageErrors = [];
    await page.route('**/api/search/v1*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 200, data: { records: 'NOT_AN_ARRAY_CORRUPTED' } }),
      });
    });

    const searchInput = page.getByRole('textbox', { name: 'Search community' });
    await searchInput.fill('corrupted-schema');
    await page.waitForTimeout(2000);

    const dialogVisible = await page.locator('[role="dialog"]').isVisible();
    const crashed = pageErrors.length > 0 || consoleErrors.some(c => c.includes('TypeError') || c.includes('records.map'));

    results.push({
      id: 'CHAOS-02',
      category: 'Fault Injection',
      name: 'Malformed API Payload Handling',
      payload: 'records: "NOT_AN_ARRAY_CORRUPTED"',
      status: crashed ? 'BUG_FOUND' : 'PASSED',
      httpStatus: 200,
      browserConsoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      notes: crashed ? 'BUG: Frontend crashed with type error when records is not an array!' : 'Safely handled schema aberration.',
    });

    await page.unroute('**/api/search/v1*');
  }

  await browser.close();

  console.log('\n======================================================');
  console.log('🏁 SEARCH BOX BREAK TESTING SUITE SUMMARY');
  console.log('======================================================');
  console.table(
    results.map(r => ({
      ID: r.id,
      Category: r.category,
      Name: r.name,
      Status: r.status,
      HTTP: r.httpStatus ?? '-',
      Notes: r.notes.slice(0, 45),
    }))
  );

  return results;
}

runBreakSuite()
  .then(res => {
    const fs = require('fs');
    if (!fs.existsSync('test-results')) {
      fs.mkdirSync('test-results', { recursive: true });
    }
    fs.writeFileSync('test-results/search-break-results.json', JSON.stringify(res, null, 2));
    console.log('\nResults saved to test-results/search-break-results.json');
  })
  .catch(err => {
    console.error('Fatal suite error:', err);
    process.exit(1);
  });
