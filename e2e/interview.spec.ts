import fs from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { test, expect, type RecordedRequest } from './fixtures';

const PLAN = { role: 'Backend engineer', level: 'Senior', stack: ['Go'], questions: ['Tell me about a service you scaled.'] };
const QUESTION = 'Hi, thanks for joining. Tell me about a service you scaled.';
const ANSWER = 'We sharded Postgres by tenant.';
const FOLLOW_UP = 'How did you pick the shard key?';
const HINT = 'Think about which queries cross tenants.';
const JOB_POST = 'Senior Go backend engineer, Kafka, Postgres';

type TurnBody = { plan: unknown; history: { who: string; text: string }[]; kind: 'next' | 'hint' };
type Calls = {
	plan: unknown[];
	turn: TurnBody[];
	transcribe: { type: string | undefined; bytes: number }[];
	speech: number;
	events: string[];
};
type Stubs = {
	plan?: (route: Route) => Promise<void>;
	transcribe?: (route: Route) => Promise<void>;
	// Replies to `next` turns after the first wait for this, to simulate a slow DeepSeek call.
	slowTurn?: Promise<void>;
	speakingPolls?: number;
};

async function stubInterview(page: Page, stubs: Stubs = {}): Promise<Calls> {
	const calls: Calls = { plan: [], turn: [], transcribe: [], speech: 0, events: [] };
	const { speakingPolls = 2 } = stubs;
	await page.route('**/api/interview/**', async (route) => {
		const req = route.request();
		const path = new URL(req.url()).pathname;
		if (path === '/api/interview/plan') {
			calls.plan.push(req.postDataJSON());
			return (stubs.plan ?? ((r) => r.fulfill({ json: PLAN })))(route);
		}
		if (path === '/api/interview/turn') {
			const body = req.postDataJSON() as TurnBody;
			calls.turn.push(body);
			const first = body.history.length === 0;
			if (body.kind === 'next' && !first && stubs.slowTurn) await stubs.slowTurn;
			const text = body.kind === 'hint' ? HINT : first ? QUESTION : FOLLOW_UP;
			await route.fulfill({ json: { text } });
			calls.events.push(`turn:${body.kind}`);
			return;
		}
		if (path === '/api/interview/transcribe') {
			calls.transcribe.push({ type: req.headers()['content-type'], bytes: req.postDataBuffer()?.length ?? 0 });
			return (stubs.transcribe ?? ((r) => r.fulfill({ json: { text: ANSWER } })))(route);
		}
		if (path === '/api/interview/speech' && req.method() === 'DELETE') {
			calls.events.push('speech:DELETE');
			return route.fulfill({ status: 204 });
		}
		if (path === '/api/interview/speech') {
			calls.speech++;
			const stopped = calls.events.includes('speech:DELETE');
			return route.fulfill({ json: { speaking: !stopped && calls.speech <= speakingPolls, queued: 0 } });
		}
		throw new Error(`unstubbed interview route: ${req.method()} ${path}`);
	});
	return calls;
}

function gate() {
	let open = () => {};
	const opened = new Promise<void>((resolve) => (open = resolve));
	return { opened, open };
}

async function exposeDisplayStream(page: Page) {
	await page.addInitScript(() => {
		const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
		Object.assign(window, { displayCalls: 0 });
		navigator.mediaDevices.getDisplayMedia = async (options) => {
			const stream = await original(options);
			const w = window as unknown as { displayStream: MediaStream; displayCalls: number };
			w.displayCalls++;
			w.displayStream = stream;
			return stream;
		};
	});
}

const displayCalls = (page: Page) => page.evaluate(() => (window as unknown as { displayCalls: number }).displayCalls);
const displayStates = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { displayStream: MediaStream }).displayStream.getTracks().map((t) => t.readyState)
	);
const screenRow = (page: Page) => page.locator('.dev', { hasText: 'Screen' });
const shareButton = (page: Page) => page.getByRole('button', { name: 'Share screen' });
// Playing videos in the setup preview, named by source.
const previewSources = (page: Page) =>
	page.locator('.studio .screen video').evaluateAll((els) =>
		(els as HTMLVideoElement[])
			.filter((v) => !v.paused && v.readyState >= 2)
			.map((v) => (v.srcObject === (window as unknown as { displayStream: MediaStream }).displayStream ? 'screen' : 'camera'))
	);

async function shareScreen(page: Page) {
	await shareButton(page).click();
	await expect(screenRow(page).locator('.ok')).toHaveText('✓');
	await expect(shareButton(page)).toBeHidden();
}

async function startCall(page: Page) {
	await page.goto('/');
	await expectDevicesReady(page);
	await shareScreen(page);
	await page.getByLabel('Job post').fill(JOB_POST);
	await page.getByRole('button', { name: '● Start interview' }).click();
	await expect(pill(page)).toHaveText('Listening');
	await expect(page.locator('.captions')).toHaveCount(0);
}

const pill = (page: Page) => page.locator('.listen');
const endButton = (page: Page) => page.getByRole('button', { name: 'End interview' });
type Voice = { start(): void; confirm(): void; misfire(): void; end(): void; listening: boolean };
const voice = (page: Page, event: 'start' | 'confirm' | 'misfire' | 'end') =>
	page.evaluate((e) => (window as unknown as { voice: Voice }).voice[e](), event);

async function speakStart(page: Page) {
	await expect.poll(() => page.evaluate(() => 'voice' in window)).toBe(true);
	await voice(page, 'start');
}

async function speak(page: Page) {
	await speakStart(page);
	await voice(page, 'confirm');
	await voice(page, 'end');
}

// Waits for the interviewer to finish first, so the answer is not a barge-in.
async function answerOnce(page: Page, calls: Calls) {
	await expect(page.locator('.tile', { hasText: 'Daniel' })).not.toHaveClass(/talking/);
	await speak(page);
	await expect.poll(() => calls.turn.length).toBe(2);
}

const transcriptPosts = (recordings: RecordedRequest[]) =>
	recordings.filter((r) => new URL(r.url).pathname === '/api/recordings/test.webm/transcript');
const uploads = (recordings: RecordedRequest[]) =>
	recordings.filter((r) => new URL(r.url).pathname === '/api/recordings');

async function expectDevicesReady(page: Page) {
	for (const label of ['Camera', 'Microphone', 'System sound']) {
		await expect(page.locator('.dev', { hasText: label }).locator('.ok')).toHaveText('✓');
	}
}

test('setup prepares questions and the call shows the first question', async ({ page }) => {
	const calls = await stubInterview(page);
	await page.goto('/');
	await expectDevicesReady(page);
	await shareScreen(page);

	const start = page.getByRole('button', { name: '● Start interview' });
	await expect(start).toBeDisabled();
	await page.getByLabel('Job post').fill(JOB_POST);
	await expect(start).toBeEnabled();
	await start.click();

	await expect(pill(page)).toHaveText('Listening');
	await expect(page.locator('.captions')).toHaveCount(0);
	expect(calls.plan).toEqual([{ jobPost: JOB_POST }]);
	expect(calls.turn).toEqual([{ plan: PLAN, history: [], kind: 'next' }]);

	const ai = page.locator('.tile', { hasText: 'Daniel' });
	await expect(ai).toHaveClass(/talking/);
	await expect(ai).not.toHaveClass(/talking/);
	expect(calls.speech).toBe(3);

	const timer = page.locator('.dock .timer');
	await expect(timer).toHaveText(/^0:\d\d$/);
	const before = await timer.textContent();
	await expect(timer).not.toHaveText(before ?? '', { timeout: 3000 });

	await page.getByRole('button', { name: '☰ Transcript' }).click();
	await expect(page.locator('.drawer .msg')).toHaveText([`Daniel${QUESTION}`]);
});

test('Share screen is required before Start, and Start reuses that share', async ({ page }) => {
	await exposeDisplayStream(page);
	const calls = await stubInterview(page);
	await page.goto('/');
	await expectDevicesReady(page);
	await page.getByLabel('Job post').fill(JOB_POST);

	const start = page.getByRole('button', { name: '● Start interview' });
	await expect(screenRow(page).locator('.pend')).toHaveText('○');
	await expect(start).toBeDisabled();
	await shareScreen(page);
	await expect(screenRow(page).locator('small')).not.toBeEmpty();
	await expect(start).toBeEnabled();

	await start.click();
	await expect(pill(page)).toHaveText('Listening');
	await expect(page.locator('.captions')).toHaveCount(0);
	expect(calls.plan).toHaveLength(1);
	expect(await displayCalls(page)).toBe(1);
});

test('stopping the share from the browser before Start resets the Screen row', async ({ page }) => {
	await exposeDisplayStream(page);
	await stubInterview(page);
	await page.goto('/');
	await expectDevicesReady(page);
	await page.getByLabel('Job post').fill(JOB_POST);
	await expect.poll(() => previewSources(page)).toEqual(['camera']);
	await shareScreen(page);
	await expect.poll(() => previewSources(page)).toEqual(['screen', 'camera']);

	await page.evaluate(() =>
		(window as unknown as { displayStream: MediaStream }).displayStream.getVideoTracks()[0]?.dispatchEvent(new Event('ended'))
	);
	await expect(screenRow(page).locator('.pend')).toHaveText('○');
	await expect.poll(() => previewSources(page)).toEqual(['camera']);
	await expect(shareButton(page)).toBeVisible();
	await expect(page.getByRole('button', { name: '● Start interview' })).toBeDisabled();
	expect(await displayStates(page)).toEqual(['ended']);
});

test('plan failure shows the error on setup and keeps the screen share', async ({ page }) => {
	await exposeDisplayStream(page);
	const message = 'plan failed: DEEPSEEK_API_KEY is not set; add it to .env';
	await stubInterview(page, { plan: (route) => route.fulfill({ status: 502, json: { message } }) });
	await page.goto('/');
	await expectDevicesReady(page);
	await shareScreen(page);

	await page.getByLabel('Job post').fill(JOB_POST);
	await page.getByRole('button', { name: '● Start interview' }).click();

	await expect(page.locator('.status')).toHaveText(`Error: ${message}`);
	await expect(page.getByRole('button', { name: '● Start interview' })).toBeEnabled();
	await expect(screenRow(page).locator('.ok')).toHaveText('✓');
	expect(await displayStates(page)).toEqual(['live']);
	expect(await displayCalls(page)).toBe(1);
});

test('the recordings library shows under the setup panel', async ({ page }) => {
	// Read-only look at the real dir; the page lists whatever is there.
	const count = fs.readdirSync('recordings').filter((f) => /^[\w-]+\.webm$/.test(f)).length;
	await page.goto('/');
	await expect(page.locator('.side')).toBeVisible();
	await expect(page.locator('.lib')).toBeAttached();
	await expect(page.locator('.lib .card')).toHaveCount(count);
});

test('speech is transcribed when it ends and asks the next turn', async ({ page }) => {
	const slow = gate();
	const calls = await stubInterview(page, { slowTurn: slow.opened });
	await startCall(page);
	const ai = page.locator('.tile', { hasText: 'Daniel' });
	const you = page.locator('.tile', { hasText: 'You' });
	await expect(ai).not.toHaveClass(/talking/);

	await speakStart(page);
	await expect(pill(page)).toHaveClass(/on/);
	await expect(pill(page)).toHaveText('Hearing you…');
	await expect(you).toHaveClass(/talking/);
	await voice(page, 'confirm');
	await voice(page, 'end');

	await expect(pill(page)).not.toHaveClass(/on/);
	await expect(pill(page)).toHaveText('Thinking…');
	await expect(page.locator('.captions')).toHaveText(`You: ${ANSWER}`);
	expect(calls.transcribe).toHaveLength(1);
	expect(calls.transcribe[0]?.type).toBe('audio/wav');
	expect(calls.transcribe[0]?.bytes).toBeGreaterThan(0);
	await expect.poll(() => calls.turn.length).toBe(2);
	expect(calls.turn[1]).toEqual({
		plan: PLAN,
		history: [
			{ who: 'interviewer', text: QUESTION },
			{ who: 'you', text: ANSWER }
		],
		kind: 'next'
	});
	expect(calls.events).not.toContain('speech:DELETE');

	slow.open();
	await expect(page.locator('.captions')).toHaveCount(0);
	await expect(pill(page)).toHaveText('Listening');
});

test('a blip while the interviewer speaks is ignored; real speech stops him', async ({ page }) => {
	const calls = await stubInterview(page, { speakingPolls: Infinity });
	await startCall(page);
	const ai = page.locator('.tile', { hasText: 'Daniel' });
	await expect(ai).toHaveClass(/talking/);

	await speakStart(page);
	await voice(page, 'misfire');
	await expect(pill(page)).toHaveText('Listening');
	await page.waitForTimeout(300);
	expect(calls.events).not.toContain('speech:DELETE');
	await expect(ai).toHaveClass(/talking/);

	await voice(page, 'start');
	await voice(page, 'confirm');
	await expect.poll(() => calls.events).toContain('speech:DELETE');
	await expect(ai).not.toHaveClass(/talking/);
	await voice(page, 'end');
	await expect.poll(() => calls.turn.length).toBe(2);
});

test('muting pauses voice detection and nothing is captured', async ({ page }) => {
	const calls = await stubInterview(page);
	await startCall(page);
	const mute = page.getByRole('button', { name: 'Mute' });
	await mute.click();
	await expect(mute).toHaveAttribute('aria-pressed', 'true');
	await expect(pill(page)).toHaveText('Muted');
	expect(await page.evaluate(() => (window as unknown as { voice: Voice }).voice.listening)).toBe(false);
	await speak(page);
	await page.waitForTimeout(300);
	expect(calls.transcribe).toHaveLength(0);

	await mute.click();
	await expect(pill(page)).toHaveText('Listening');
	await answerOnce(page, calls);
});

test('hint shows a Hint caption and is not spoken', async ({ page }) => {
	const calls = await stubInterview(page);
	await startCall(page);
	await page.getByRole('button', { name: 'Hint' }).click();
	await expect(page.locator('.captions')).toHaveText(`Hint: ${HINT}`);
	expect(calls.turn[1]?.kind).toBe('hint');
	await page.getByRole('button', { name: '☰ Transcript' }).click();
	await expect(page.locator('.drawer .msg')).toHaveText([`Daniel${QUESTION}`, `Hint${HINT}`]);
});

test('speech while a turn is pending sends nothing', async ({ page }) => {
	const slow = gate();
	const calls = await stubInterview(page, { slowTurn: slow.opened });
	await startCall(page);
	await answerOnce(page, calls);
	await expect(pill(page)).toHaveText('Thinking…');
	await expect(page.getByRole('button', { name: 'Hint' })).toBeDisabled();

	await speak(page);
	await expect(pill(page)).not.toHaveClass(/on/);
	slow.open();
	await expect(page.locator('.captions')).toHaveCount(0);
	await page.waitForTimeout(300);
	expect(calls.transcribe).toHaveLength(1);
	expect(calls.turn).toHaveLength(2);
});

test('End uploads the recording and its transcript, then returns to the library', async ({ page, recordings }) => {
	const calls = await stubInterview(page);
	await startCall(page);
	await answerOnce(page, calls);
	await expect(page.locator('.captions')).toHaveCount(0);

	const reload = page.waitForRequest((r) => new URL(r.url()).pathname === '/__data.json');
	await endButton(page).click();
	await reload;
	await expect(page.locator('.lib')).toBeAttached();
	await expect(screenRow(page).locator('.pend')).toHaveText('○');
	await expect(shareButton(page)).toBeVisible();
	await expect(page).toHaveURL(/\/$/);
	const [upload] = uploads(recordings);
	expect(uploads(recordings)).toHaveLength(1);
	expect(new URL(upload?.url ?? '').searchParams.get('title')).toBe('interview-Backend engineer');
	expect(upload?.body?.length).toBeGreaterThan(0);
	const [transcript] = transcriptPosts(recordings);
	const lines = transcript?.body?.toString().split('\n') ?? [];
	expect(lines.every((l) => /^\[0:\d\d\] /.test(l))).toBe(true);
	expect(lines.map((l) => l.replace(/^\[\d+:\d\d\] /, ''))).toEqual([
		`Daniel: ${QUESTION}`,
		`You: ${ANSWER}`,
		`Daniel: ${FOLLOW_UP}`
	]);
});

test('End during a pending turn waits for it and drops the reply', async ({ page, recordings }) => {
	const slow = gate();
	const calls = await stubInterview(page, { slowTurn: slow.opened });
	await startCall(page);
	await answerOnce(page, calls);

	await endButton(page).click();
	await expect(page.locator('.captions')).toHaveText('Saving...');
	await page.waitForTimeout(300);
	expect(calls.events).not.toContain('speech:DELETE');
	slow.open();

	await expect(page.locator('.lib')).toBeAttached();
	expect(calls.events.indexOf('speech:DELETE')).toBeGreaterThan(calls.events.lastIndexOf('turn:next'));
	const lines = transcriptPosts(recordings)[0]?.body?.toString().split('\n') ?? [];
	expect(lines.map((l) => l.replace(/^\[\d+:\d\d\] /, ''))).toEqual([`Daniel: ${QUESTION}`, `You: ${ANSWER}`]);
});

test('a failed transcript save shows Retry save, which retries without re-uploading', async ({ page, recordings }) => {
	let attempts = 0;
	await page.route(/\/api\/recordings\/[^/]+\/transcript$/, (route) => {
		attempts++;
		if (attempts === 1) return route.fulfill({ status: 500, body: 'disk full' });
		return route.fallback();
	});
	await stubInterview(page);
	await startCall(page);

	await endButton(page).click();
	await expect(page.locator('.captions')).toContainText('Error: disk full');
	const retry = page.getByRole('button', { name: 'Retry save' });
	await expect(retry).toBeVisible();
	await expect(endButton(page)).toBeDisabled();

	await retry.click();
	await expect(page.locator('.lib')).toBeAttached();
	expect(attempts).toBe(2);
	expect(uploads(recordings)).toHaveLength(1);
	expect(transcriptPosts(recordings)).toHaveLength(1);
});

test('End twice during a pending turn uploads once', async ({ page, recordings }) => {
	await exposeDisplayStream(page);
	const slow = gate();
	const calls = await stubInterview(page, { slowTurn: slow.opened });
	await startCall(page);
	await answerOnce(page, calls);

	await endButton(page).click();
	await endButton(page).click({ force: true });
	// The browser ending the screen share takes the same End path.
	await page.evaluate(() =>
		(window as unknown as { displayStream: MediaStream }).displayStream.getVideoTracks()[0]?.dispatchEvent(new Event('ended'))
	);
	slow.open();

	await expect(page.locator('.lib')).toBeAttached();
	expect(uploads(recordings)).toHaveLength(1);
	expect(transcriptPosts(recordings)).toHaveLength(1);
});

test('a transcribe failure shows an Error caption and the call continues', async ({ page }) => {
	const message = 'transcribe failed: STT server not reachable at 127.0.0.1:8790; start it with stt/run.sh';
	const calls = await stubInterview(page, { transcribe: (route) => route.fulfill({ status: 502, json: { message } }) });
	await startCall(page);
	await speak(page);
	await expect(page.locator('.captions')).toHaveText(`Error: ${message}`);
	await expect(pill(page)).toHaveText('Listening');
	expect(calls.turn).toHaveLength(1);
});

test('the call view shows the shared screen', async ({ page }) => {
	await exposeDisplayStream(page);
	await stubInterview(page);
	await startCall(page);
	const video = page.locator('.call .screen video');
	await expect
		.poll(() =>
			video.evaluate((v: HTMLVideoElement) => {
				const s = v.srcObject as MediaStream | null;
				return {
					same: s === (window as unknown as { displayStream: MediaStream }).displayStream,
					live: s?.getVideoTracks()[0]?.readyState,
					width: v.videoWidth > 0
				};
			})
		)
		.toEqual({ same: true, live: 'live', width: true });
});
