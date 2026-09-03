import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedPin, signIn } from './session';

/**
 * What the forms do with what a person types, and what they say back. The sweep
 * in ui-audit.spec.ts looks at screens standing still; this one types into them:
 * blank submits, whitespace, out-of-range numbers, dates in the future, letters
 * in a numeric field, the keyboard-only path, and whether an answer to any of it
 * is put somewhere the person typing can actually see.
 *
 * Findings are recorded rather than asserted -- the run is a report, not a gate.
 */

// Outside test-results/: Playwright wipes that directory at the start of every run.
const OUT = 'ui-report';
type Finding = { screen: string; kind: string; detail: string };
const findings: Finding[] = [];

function record(screen: string, kind: string, detail: string) {
  findings.push({ screen, kind, detail });
}

function save(screen: string) {
  mkdirSync(OUT, { recursive: true });
  const name = 'io-' + screen.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  writeFileSync(OUT + '/' + name + '.json', JSON.stringify(findings.filter((f) => f.screen === screen), null, 2));
}

async function shot(page: Page, info: TestInfo, name: string) {
  mkdirSync(OUT, { recursive: true });
  const file = OUT + '/io-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png';
  await page.screenshot({ path: file, fullPage: true });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function openBhw(page: Page, path: string) {
  await signIn(page, { role: 'bhw', userId: 'bhw-1' });
  await seedPin(page, 'bhw-1', '2749');
  await page.goto(path);

  const gate = page.getByRole('dialog');
  const nav = page.getByRole('navigation', { name: /sections/i });

  // Whichever settles first. The screen's chunk is fetched on demand, so right
  // after a navigation neither is mounted yet — and `count()` does not wait, so
  // asking it straight away reads "no gate" and then times out on a nav the gate
  // is in fact still covering.
  await expect(gate.or(nav).first()).toBeVisible();

  if (await gate.count()) {
    await gate.locator('input.pin-input').fill('2749');
    await gate.getByRole('button').last().click();
  }

  await expect(nav).toBeVisible();
}

/** Where the first complaint landed relative to what the person can see. */
async function reportErrorVisibility(page: Page, screen: string) {
  const state = await page.evaluate(() => {
    const errors = Array.from(document.querySelectorAll('.field-error, .form-alert, [role="alert"]')) as HTMLElement[];
    if (errors.length === 0) return { count: 0, firstTop: 0, inView: false, coveredByBar: false };

    const first = errors[0];
    const box = first.getBoundingClientRect();
    const bar = document.querySelector('.bhw-bottom-nav')?.getBoundingClientRect();

    return {
      count: errors.length,
      firstTop: Math.round(box.top),
      inView: box.top >= 0 && box.bottom <= window.innerHeight,
      coveredByBar: Boolean(bar && box.bottom > bar.top && box.top < bar.bottom),
    };
  });

  if (state.count === 0) {
    record(screen, 'silent rejection', 'the form refused the submit with no visible message at all');
    return;
  }

  if (!state.inView) {
    record(screen, 'error off screen', `first message sits at y=${state.firstTop}, outside the viewport, and nothing scrolled to it`);
  }

  if (state.coveredByBar) record(screen, 'error under the bottom bar', 'the first message is behind the fixed navigation');
}

test.describe('register resident: what the form does with what is typed', () => {
  test('an empty submit', async ({ page }, info) => {
    const screen = 'register resident — empty submit';
    await openBhw(page, '/bhw/register-resident');

    const submit = page.getByRole('button', { name: /save complete household/i });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(300);

    await reportErrorVisibility(page, screen);

    await shot(page, info, screen);
    save(screen);
  });

  test('spaces where a name should be', async ({ page }, info) => {
    const screen = 'register resident — whitespace only';
    await openBhw(page, '/bhw/register-resident');

    await page.getByLabel('Household Number').fill('   ');
    await page.getByLabel('First Name').fill('   ');
    await page.getByLabel('Last Name').fill('  ');

    const submit = page.getByRole('button', { name: /save complete household/i });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(300);

    const errors = await page.locator('.field-error').count();
    if (errors === 0) record(screen, 'whitespace accepted', 'a household number and name of spaces alone passed validation');
    else record(screen, 'ok', `${errors} field message(s) — whitespace is rejected`);

    await shot(page, info, screen);
    save(screen);
  });

  test('a birthdate in the future and letters in the numeric field', async ({ page }, info) => {
    const screen = 'register resident — bad values';
    await openBhw(page, '/bhw/register-resident');

    const birthday = page.getByLabel('Birthdate');
    await birthday.fill('2099-12-31');
    const kept = await birthday.inputValue();
    if (kept === '2099-12-31') record(screen, 'future birthdate held', 'the field takes a date past its own max and keeps it — nothing says so while typing');

    const philhealth = page.getByLabel('PhilHealth Number');
    await philhealth.fill('abc-not-a-number');
    const philValue = await philhealth.inputValue();
    if (/[a-z]/i.test(philValue)) {
      record(screen, 'letters in a numeric field', `PhilHealth Number holds "${philValue}" — inputMode only picks the keyboard, it does not filter`);
    }

    // Does the future birthdate survive a submit attempt?
    await page.getByLabel('Household Number').fill('HH-TEST-1');
    await page.getByLabel('First Name').fill('Ana');
    await page.getByLabel('Last Name').fill('Cruz');
    const submit = page.getByRole('button', { name: /save complete household/i });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(500);

    const complained = await page.locator('.field-error, .form-alert').allInnerTexts();
    record(
      screen,
      complained.length ? 'messages after submit' : 'no message after submit',
      complained.map((text) => text.replace(/\s+/g, ' ').trim()).join(' | ').slice(0, 240) || 'nothing said about a birthdate of 2099-12-31',
    );

    await shot(page, info, screen);
    save(screen);
  });

  test('the keyboard-only path through the form', async ({ page }, info) => {
    const screen = 'register resident — keyboard only';
    await openBhw(page, '/bhw/register-resident');

    await page.locator('body').press('Tab');
    const seen: string[] = [];
    let reachedSubmit = false;

    for (let i = 0; i < 60; i += 1) {
      const here = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 30),
          type: (el as HTMLInputElement).type ?? '',
          ring: style.outlineStyle !== 'none' || style.boxShadow !== 'none',
        };
      });

      if (!here) break;
      seen.push(`${here.tag}${here.type ? ':' + here.type : ''}`);

      if (!here.ring) record(screen, 'no focus ring', `${here.tag}${here.type ? ':' + here.type : ''} "${here.text}" shows nothing when focused by keyboard`);
      if (/save complete household/i.test(here.text)) {
        reachedSubmit = true;
        break;
      }

      await page.keyboard.press('Tab');
    }

    if (!reachedSubmit) record(screen, 'submit unreachable by keyboard', `60 tabs did not reach the save button; path was ${seen.slice(0, 12).join(' > ')}`);

    save(screen);
    await shot(page, info, screen);
  });

  test('Enter pressed in a text field', async ({ page }, info) => {
    const screen = 'register resident — Enter key';
    await openBhw(page, '/bhw/register-resident');

    await page.getByLabel('Household Number').fill('HH-002');
    await page.getByLabel('Household Number').press('Enter');
    await page.waitForTimeout(400);

    const errors = await page.locator('.field-error, .form-alert').count();
    if (errors > 0) record(screen, 'Enter submits a half-filled form', `${errors} message(s) appeared from pressing Enter in the first field`);
    else record(screen, 'ok', 'Enter in a text field does not submit the form');

    await shot(page, info, screen);
    save(screen);
  });
});

test.describe('health assessment: numbers out of range', () => {
  test('a weight and height no person has', async ({ page }, info) => {
    const screen = 'health assessment — out of range';
    await openBhw(page, '/bhw/health-assessment');

    await page.getByLabel('Weight (kg)').fill('999');
    await page.getByLabel('Height (cm)').fill('0');

    const submit = page.getByRole('button', { name: /save assessment/i });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(300);

    const messages = await page.locator('.field-error, .form-alert').allInnerTexts();
    if (messages.length === 0) record(screen, 'no range message', '999 kg and 0 cm produced no complaint');
    else record(screen, 'range messages', messages.join(' | ').slice(0, 200));

    await reportErrorVisibility(page, screen);
    await shot(page, info, screen);
    save(screen);
  });

  test('letters typed into a number field', async ({ page }, info) => {
    const screen = 'health assessment — letters in a number field';
    await openBhw(page, '/bhw/health-assessment');

    const weight = page.getByLabel('Weight (kg)');
    await weight.click();
    await page.keyboard.type('abc');
    const value = await weight.inputValue();

    if (value === '') {
      record(screen, 'typing swallowed', 'letters typed into Weight (kg) vanish with no message — the field looks broken to the person typing');
    } else {
      record(screen, 'letters held', `Weight (kg) holds "${value}"`);
    }

    await shot(page, info, screen);
    save(screen);
  });
});

test.describe('supply release: quantity limits', () => {
  test('a quantity beyond the stated maximum', async ({ page }, info) => {
    const screen = 'supply release — quantity limits';
    await openBhw(page, '/bhw/supply-disbursement');

    await page.getByLabel('Quantity').fill('99999');

    const submit = page.getByRole('button', { name: /save disbursement/i });
    // To the end of the page, not just into view: scrollIntoViewIfNeeded stops as
    // soon as the button is inside the viewport, which the sticky bar overlaps.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);

    // Is the button reachable at all once scrolled to?
    const covered = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((b) => /save disbursement/i.test(b.textContent || ''));
      if (!button) return 'missing';
      const box = button.getBoundingClientRect();
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return at && !button.contains(at) && at !== button ? (at.className || at.tagName).toString() : '';
    });

    if (covered === 'missing') record(screen, 'missing control', 'no save button on the disbursement form');
    else if (covered) record(screen, 'save button covered', `after scrolling to it, the point at its centre belongs to "${covered}"`);

    await submit.click({ force: true });
    await page.waitForTimeout(300);

    const messages = await page.locator('.field-error, .form-alert').allInnerTexts();
    record(screen, messages.length ? 'messages' : 'no message', messages.join(' | ').slice(0, 200) || '99999 with no stock produced nothing');

    await reportErrorVisibility(page, screen);
    await shot(page, info, screen);
    save(screen);
  });

});

test.describe('what comes back out', () => {
  test('a complete household, saved and looked for again', async ({ page }, info) => {
    const screen = 'register resident — save and read back';
    await openBhw(page, '/bhw/register-resident');

    await page.getByLabel('Household Number').fill('HH-E2E-1');
    await page.getByLabel('First Name').fill('Ana');
    await page.getByLabel('Last Name').fill('Cruz');
    await page.getByLabel('Birthdate').fill('1980-04-05');

    // The three checkbox groups are all required; tick the first box of each the
    // way a person does -- on the label, one at a time.
    const groups = page.locator('fieldset.choice-group');
    const groupCount = await groups.count();
    for (let i = 0; i < groupCount; i += 1) {
      const first = groups.nth(i).locator('label.choice').first();
      if (await first.count()) {
        await first.click();
        await expect(first.locator('input[type="checkbox"]')).toBeChecked();
      }
    }

    // Member 1 is already the head on a blank form; only tick it if it is not.
    const head = page.locator('label.choice', { hasText: /this person is a household head/i }).first();
    const headBox = head.locator('input[type="checkbox"]');
    if ((await head.count()) && !(await headBox.isChecked())) await head.click();
    await expect(headBox).toBeChecked();

    const submit = page.getByRole('button', { name: /save complete household/i });
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await page.waitForTimeout(1500);

    const after = await page.evaluate(() => ({
      url: location.pathname,
      alerts: Array.from(document.querySelectorAll('.form-alert, [role="alert"], [role="status"], .notice')).map((n) =>
        (n.textContent || '').trim().slice(0, 120),
      ),
      errors: Array.from(document.querySelectorAll('.field-error')).map((n) => (n.textContent || '').trim().slice(0, 80)),
    }));

    record(screen, 'after save', `at ${after.url}; said: ${after.alerts.join(' | ') || 'nothing'}${after.errors.length ? '; field errors: ' + after.errors.join(' | ') : ''}`);

    await shot(page, info, screen + ' after submit');

    await page.goto('/bhw/residents');
    const gate = page.getByRole('dialog');
    const nav = page.getByRole('navigation', { name: /sections/i });

    // Same wait as `openBhw` above, for the same reason.
    await expect(gate.or(nav).first()).toBeVisible();

    if (await gate.count()) {
      await gate.locator('input.pin-input').fill('2749');
      await gate.getByRole('button').last().click();
    }
    await page.waitForTimeout(1200);

    const listed = await page.getByText(/cruz/i).count();
    if (listed === 0) record(screen, 'saved record not listed', 'the resident just saved does not appear on the Residents screen');
    else record(screen, 'ok', 'the saved resident appears on the Residents screen');

    await shot(page, info, screen + ' residents list');
    save(screen);
  });
});
