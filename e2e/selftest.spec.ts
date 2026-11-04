import { expect, test } from '@playwright/test';

test('library self-test passes in the production bundle @live', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./#selftest');
  await expect(page.getByTestId('selftest-status')).toHaveText('ok', { timeout: 30_000 });
  const results = JSON.parse((await page.getByTestId('selftest-result').textContent()) ?? '[]') as {
    name: string;
    ok: boolean;
  }[];
  expect(results.map((r) => [r.name, r.ok])).toEqual([
    ['yalps', true],
    ['lz-string', true],
    ['elk-worker', true],
  ]);
  await expect(page.getByTestId('selftest-flow').locator('.react-flow__node')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a missing ELK worker script fails the self-test instead of hanging', async ({ page }) => {
  await page.route('**/assets/elk-worker.min-*.js', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('./#selftest');
  await expect(page.getByTestId('selftest-status')).toHaveText('failed', { timeout: 15_000 });
  const results = JSON.parse((await page.getByTestId('selftest-result').textContent()) ?? '[]') as {
    name: string;
    ok: boolean;
  }[];
  expect(results.map((r) => [r.name, r.ok])).toEqual([
    ['yalps', true],
    ['lz-string', true],
    ['elk-worker', false],
  ]);
});
