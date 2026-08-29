import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedPin, signIn } from './session';

/**
 * An exploratory sweep rather than a regression guard: it walks every screen on
 * both surfaces and records the layout and reachability faults a person would
 * hit -- overflow, unreadable type, taps too small for a thumb, controls with no
 * name, content buried under the fixed bar. Nothing here fails the run; the
 * point is the report and the screenshots under test-results/ui-audit/.
 */

// Outside test-results/: Playwright wipes that directory at the start of every run.
const OUT = 'ui-report';

type Finding = { screen: string; kind: string; detail: string };
const findings: Finding[] = [];

function record(screen: string, kind: string, detail: string) {
  findings.push({ screen, kind, detail });
}

function slug(name: string) {
  return name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function audit(page: Page, screen: string, info: TestInfo) {
  await page.waitForTimeout(400);

  // Measure from the end of the page: that is where a person stands when they
  // reach a form's last control, and it is the only position where content
  // sitting under the sticky bar means the control cannot be reached at all.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const out = {
      docOverflow: 0,
      wide: [] as string[],
      smallTaps: [] as string[],
      unnamed: [] as string[],
      unlabelledInputs: [] as string[],
      tinyText: [] as string[],
      buriedUnderBar: [] as string[],
    };

    const label = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return tag + (cls ? '.' + cls : '') + (text ? ' "' + text + '"' : '');
    };

    const root = document.scrollingElement || document.documentElement;
    out.docOverflow = root.scrollWidth - root.clientWidth;

    const viewportWidth = window.innerWidth;
    const visible = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });

    for (const el of visible) {
      const box = el.getBoundingClientRect();
      if ((box.right > viewportWidth + 1 || box.left < -1) && getComputedStyle(el).position !== 'fixed') {
        out.wide.push(label(el) + ' [' + Math.round(box.left) + '..' + Math.round(box.right) + ' of ' + viewportWidth + ']');
      }
    }

    const interactive = visible.filter(
      (el) =>
        ['button', 'a', 'input', 'select', 'textarea'].includes(el.tagName.toLowerCase()) ||
        el.getAttribute('role') === 'button',
    );

    for (const el of interactive) {
      const tag = el.tagName.toLowerCase();
      if ((el as HTMLInputElement).type === 'hidden') continue;

      const box = el.getBoundingClientRect();
      if (box.width < 44 || box.height < 44) {
        out.smallTaps.push(label(el) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
      }

      const labelled = (el as HTMLInputElement).labels ? (el as HTMLInputElement).labels!.length > 0 : false;
      const name =
        (el.getAttribute('aria-label') || '').trim() ||
        (el.textContent || '').trim() ||
        (el.getAttribute('title') || '').trim() ||
        (labelled ? 'labelled' : '');

      if (!name) {
        if (tag === 'input' || tag === 'select' || tag === 'textarea') out.unlabelledInputs.push(label(el));
        else out.unnamed.push(label(el));
      }
    }

    for (const el of visible) {
      const hasOwnText = Array.from(el.childNodes).some(
        (node) => node.nodeType === 3 && (node.textContent || '').trim().length > 1,
      );
      if (!hasOwnText) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14) out.tinyText.push(label(el) + ' ' + size + 'px');
    }

    const bar = document.querySelector('.bhw-bottom-nav');
    if (bar) {
      const barBox = bar.getBoundingClientRect();
      for (const el of interactive) {
        if (bar.contains(el)) continue;
        const box = el.getBoundingClientRect();
        if (!(box.bottom > barBox.top && box.top < barBox.bottom)) continue;
        const mid = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (mid && mid !== el && !el.contains(mid)) out.buriedUnderBar.push(label(el));
      }
    }

    const dedupe = (list: string[]) => Array.from(new Set(list)).slice(0, 12);
    out.wide = dedupe(out.wide);
    out.smallTaps = dedupe(out.smallTaps);
    out.unnamed = dedupe(out.unnamed);
    out.unlabelledInputs = dedupe(out.unlabelledInputs);
    out.tinyText = dedupe(out.tinyText);
    out.buriedUnderBar = dedupe(out.buriedUnderBar);
    return out;
  });

  if (result.docOverflow > 1) record(screen, 'horizontal overflow', 'page scrolls ' + result.docOverflow + 'px sideways');
  for (const item of result.wide) record(screen, 'element past viewport', item);
  for (const item of result.smallTaps) record(screen, 'tap target under 44px', item);
  for (const item of result.unnamed) record(screen, 'control with no accessible name', item);
  for (const item of result.unlabelledInputs) record(screen, 'input with no label', item);
  for (const item of result.tinyText) record(screen, 'text under 14px', item);
  for (const item of result.buriedUnderBar) record(screen, 'control buried under bottom bar', item);

  // Back to the top before the picture: a sticky sidebar is captured wherever it
  // is standing, and a shot taken from the bottom of the page shows it adrift.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);

  mkdirSync(OUT, { recursive: true });
  const shot = OUT + '/' + slug(screen) + '.png';
  await page.screenshot({ path: shot, fullPage: true });
  await info.attach(screen, { path: shot, contentType: 'image/png' });

  // Written per screen so the report survives however the run is sharded.
  writeFileSync(OUT + '/' + slug(screen) + '.json', JSON.stringify(findings.filter((f) => f.screen === screen), null, 2));
}

function watchConsole(page: Page, screen: string) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') record(screen, 'console error', msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => record(screen, 'uncaught exception', String(err).slice(0, 200)));
}

async function unlockBhw(page: Page) {
  await signIn(page, { role: 'bhw', userId: 'bhw-1' });
  await seedPin(page, 'bhw-1', '2749');
  await page.goto('/bhw');
  await passGate(page);
}

/** A reload re-locks the device, so every direct navigation meets the gate again. */
async function passGate(page: Page) {
  const gate = page.getByRole('dialog');
  if (await gate.count()) {
    await gate.locator('input.pin-input').fill('2749');
    await gate.getByRole('button').last().click();
  }
  await expect(page.getByRole('navigation', { name: /sections/i })).toBeVisible();
}

test.describe('BHW phone screens', () => {
  const screens: Array<[string, string]> = [
    ['bhw dashboard', '/bhw'],
    ['bhw register resident', '/bhw/register-resident'],
    ['bhw residents', '/bhw/residents'],
    ['bhw health assessment', '/bhw/health-assessment'],
    ['bhw supply release', '/bhw/supply-disbursement'],
    ['bhw profile', '/bhw/profile'],
  ];

  for (const [name, path] of screens) {
    test('audit ' + name, async ({ page }, info) => {
      watchConsole(page, name);
      await unlockBhw(page);
      if (path !== '/bhw') {
        await page.goto(path);
        await passGate(page);
      }
      await audit(page, name, info);
    });
  }

  test('audit bhw pin gate', async ({ page }, info) => {
    watchConsole(page, 'bhw pin gate');
    await signIn(page, { role: 'bhw', userId: 'bhw-new' });
    await page.goto('/bhw');
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'bhw pin gate', info);
  });

  test('audit bhw register resident after an empty submit', async ({ page }, info) => {
    const name = 'bhw register resident (empty submit)';
    watchConsole(page, name);
    await unlockBhw(page);
    await page.goto('/bhw/register-resident');
    await passGate(page);
    const submit = page.getByRole('button', { name: /save|register|submit/i }).last();

    if (await submit.count()) {
      await submit.click({ timeout: 5000 }).catch(() => record(name, 'unclickable control', 'the save button could not be clicked'));
    } else {
      record(name, 'missing control', 'no save/register button found on the form');
    }

    await audit(page, name, info);
  });
});

test.describe('admin portal screens', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  const screens: Array<[string, string]> = [
    ['admin dashboard', '/admin'],
    ['admin residents', '/admin/residents'],
    ['admin inventory', '/admin/inventory'],
    ['admin accounts', '/admin/accounts'],
    ['admin reports', '/admin/reports'],
  ];

  for (const [name, path] of screens) {
    test('audit ' + name, async ({ page }, info) => {
      watchConsole(page, name);
      await signIn(page, { role: 'barangay_admin', userId: 'admin-1' });
      await page.goto(path);
      await page.waitForTimeout(600);
      await audit(page, name, info);
    });
  }

  test('audit admin dashboard on a narrow window', async ({ page }, info) => {
    const name = 'admin dashboard at 800px';
    watchConsole(page, name);
    await page.setViewportSize({ width: 800, height: 900 });
    await signIn(page, { role: 'barangay_admin', userId: 'admin-1' });
    await page.goto('/admin');
    await audit(page, name, info);
  });
});
