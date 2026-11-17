import { test, expect } from './fixtures';

test('studio records with fake devices and uploads', async ({ page, recordings }) => {
	await page.goto('/');
	for (const label of ['Camera', 'Microphone', 'System sound']) {
		await expect(page.locator('.dev', { hasText: label }).locator('.ok')).toHaveText('✓');
	}
	const record = page.getByRole('button', { name: '● Record' });
	await expect(record).toBeEnabled();
	await record.click();
	await page.waitForTimeout(2000);
	await page.getByRole('button', { name: /Stop/ }).click();
	await expect.poll(() => recordings.find((r) => r.url.includes('/api/recordings'))?.body?.length ?? 0).toBeGreaterThan(0);
});
