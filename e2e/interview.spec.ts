import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';

const PLAN = { role: 'Backend engineer', level: 'Senior', stack: ['Go'], questions: ['Tell me about a service you scaled.'] };
const QUESTION = 'Hi, thanks for joining. Tell me about a service you scaled.';
const JOB_POST = 'Senior Go backend engineer, Kafka, Postgres';

type Calls = { plan: unknown[]; turn: unknown[]; speech: number };

async function stubInterview(page: Page, plan: (route: Route) => Promise<void>): Promise<Calls> {
	const calls: Calls = { plan: [], turn: [], speech: 0 };
	await page.route('**/api/interview/**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (path === '/api/interview/plan') {
			calls.plan.push(req.postDataJSON());
			return plan(route);
		}
		if (path === '/api/interview/turn') {
			calls.turn.push(req.postDataJSON());
			return route.fulfill({ json: { text: QUESTION } });
		}
		if (path === '/api/interview/speech') {
			calls.speech++;
			return route.fulfill({ json: { speaking: calls.speech <= 2, queued: 0 } });
		}
		throw new Error(`unstubbed interview route: ${req.method()} ${path}`);
	});
	return calls;
}

async function expectDevicesReady(page: Page) {
	for (const label of ['Camera', 'Microphone', 'System sound']) {
		await expect(page.locator('.dev', { hasText: label }).locator('.ok')).toHaveText('✓');
	}
}

test('setup prepares questions and the call shows the first question', async ({ page }) => {
	const calls = await stubInterview(page, (route) => route.fulfill({ json: PLAN }));
	await page.goto('/interview');
	await expectDevicesReady(page);

	const start = page.getByRole('button', { name: '● Start interview' });
	await expect(start).toBeDisabled();
	await page.getByLabel('Job post').fill(JOB_POST);
	await expect(start).toBeEnabled();
	await start.click();

	await expect(page.locator('.captions')).toHaveText(`Interviewer: ${QUESTION}`);
	expect(calls.plan).toEqual([{ jobPost: JOB_POST }]);
	expect(calls.turn).toEqual([{ plan: PLAN, history: [], kind: 'next' }]);

	const ai = page.locator('.tile', { hasText: 'Interviewer' });
	await expect(ai).toHaveClass(/talking/);
	await expect(ai).not.toHaveClass(/talking/);
	expect(calls.speech).toBe(3);

	const timer = page.locator('.dock .timer');
	await expect(timer).toHaveText(/^0:\d\d$/);
	const before = await timer.textContent();
	await expect(timer).not.toHaveText(before ?? '', { timeout: 3000 });

	await page.getByRole('button', { name: '☰ Transcript' }).click();
	await expect(page.locator('.drawer .msg')).toHaveText([`Interviewer${QUESTION}`]);
});

test('plan failure shows the error on setup and stops the screen share', async ({ page }) => {
	await page.addInitScript(() => {
		const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
		navigator.mediaDevices.getDisplayMedia = async (options) => {
			const stream = await original(options);
			Object.assign(window, { displayStream: stream });
			return stream;
		};
	});
	const message = 'plan failed: DEEPSEEK_API_KEY is not set; add it to .env';
	await stubInterview(page, (route) => route.fulfill({ status: 502, json: { message } }));
	await page.goto('/interview');
	await expectDevicesReady(page);

	await page.getByLabel('Job post').fill(JOB_POST);
	await page.getByRole('button', { name: '● Start interview' }).click();

	await expect(page.locator('.status')).toHaveText(`Error: ${message}`);
	await expect(page.getByRole('button', { name: '● Start interview' })).toBeEnabled();
	const states = await page.evaluate(() =>
		(window as unknown as { displayStream: MediaStream }).displayStream.getTracks().map((t) => t.readyState)
	);
	expect(states).toEqual(['ended']);
});
