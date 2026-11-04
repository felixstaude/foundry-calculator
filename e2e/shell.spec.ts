import { expect, test } from '@playwright/test';

test('shell renders under the base path without console errors @live', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Foundry Calculator' })).toBeVisible();
  expect(errors).toEqual([]);
});

/** Set by the post-deploy smoke test: the page and version.json must both be this build (no stale CDN copy). */
const expected = process.env.EXPECTED_COMMIT;

test('version.json and the page name the build commit @live', async ({ page, request }) => {
  const res = await request.get('./version.json');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { commit: string; builtAt: string };
  expect(body.commit).toMatch(/^(dev|[0-9a-f]{40})$/);
  if (expected) {
    expect(body.commit).toBe(expected);
    await page.goto('./');
    await expect(page.getByTestId('commit')).toHaveText(expected.slice(0, 7));
  }
});
