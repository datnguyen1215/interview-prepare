<script module lang="ts">
	export async function api<T>(path: string, body?: unknown): Promise<T> {
		const init =
			body === undefined
				? {}
				: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
		const res = await fetch(path, init);
		if (res.ok) return (await res.json()) as T;
		const message = res.headers.get('content-type')?.includes('json')
			? ((await res.json()) as { message?: string }).message
			: await res.text();
		console.error('[call] api failed', path, res.status, message);
		throw new Error(message || `${path} failed: ${res.status}`);
	}

	export function preview(node: HTMLVideoElement, stream: MediaStream | null | undefined) {
		node.srcObject = stream ?? null;
		return { update: (s: MediaStream | null | undefined) => (node.srcObject = s ?? null) };
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { Entry, Plan } from '#lib/server/interviewer.js';

	let {
		plan,
		screen,
		camera,
		startedAt
	}: { plan: Plan; screen: MediaStream; camera: MediaStream; startedAt: number } = $props();

	type Caption = { who: 'Interviewer' | 'You' | 'Hint' | 'Error'; text: string };
	type Speech = { speaking: boolean; queued: number };

	const CAPTION_STYLE: Record<Caption['who'], string | undefined> = {
		Interviewer: undefined,
		You: 'color:var(--good)',
		Hint: 'color:var(--warn)',
		Error: 'color:var(--bad)'
	};
	const WHO = { interviewer: 'Interviewer', you: 'You', hint: 'Hint' } as const;

	let elapsed = $state(0);
	let caption = $state<Caption>();
	let entries = $state<Entry[]>([]);
	let aiTalking = $state(false);
	let drawerOpen = $state(false);
	let alive = true;

	const log = (...args: unknown[]) => console.log('[call]', ...args);
	const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const since = (t0: number) => Math.round(performance.now() - t0);

	onMount(() => {
		log('mounted', { role: plan.role, level: plan.level, questions: plan.questions.length });
		const timer = setInterval(() => (elapsed = Math.floor((Date.now() - startedAt) / 1000)), 500);
		next();
		return () => {
			log('unmounted', { elapsed, entries: entries.length });
			alive = false;
			clearInterval(timer);
		};
	});

	function showError(step: string, e: unknown) {
		console.error('[call]', `${step} failed`, e);
		caption = { who: 'Error', text: e instanceof Error ? e.message : String(e) };
	}

	async function next() {
		log('turn next', { history: entries.length });
		const t0 = performance.now();
		try {
			const { text } = await api<{ text: string }>('/api/interview/turn', { plan, history: entries, kind: 'next' });
			log('turn done', { ms: since(t0), chars: text.length });
			if (!alive) return;
			entries.push({ who: 'interviewer', text });
			caption = { who: 'Interviewer', text };
		} catch (e) {
			showError('turn', e);
			return;
		}
		await waitForSpeech();
	}

	async function waitForSpeech() {
		log('speaking: polling until idle');
		const t0 = performance.now();
		aiTalking = true;
		try {
			let s: Speech;
			do {
				await sleep(300);
				if (!alive) return;
				s = await api<Speech>('/api/interview/speech');
				console.debug('[call] speech', s);
			} while (s.speaking || s.queued > 0);
			log('speaking done', { ms: since(t0) });
		} catch (e) {
			showError('speech status', e);
		}
		aiTalking = false;
	}
</script>

<div class="call">
	<div class="main"><div class="screen"><video use:preview={screen} autoplay muted></video></div></div>
	<button class="btn drawer-btn" onclick={() => (drawerOpen = !drawerOpen)}>☰ Transcript</button>
	{#if drawerOpen}
		<div class="drawer">
			{#each entries as e, i (i)}
				<div class="msg" class:ai={e.who !== 'you'} class:me={e.who === 'you'}>
					<span class="who" style={e.who === 'hint' ? 'color:var(--warn)' : undefined}>{WHO[e.who]}</span><span
						class="body">{e.text}</span
					>
				</div>
			{/each}
		</div>
	{/if}
	<div class="tiles">
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<div class="tile" class:talking={aiTalking}><div class="avatar">AI</div><label>Interviewer</label></div>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<div class="tile"><video class="me" use:preview={camera} autoplay muted></video><label>You</label></div>
	</div>
	{#if caption}
		<div class="captions"><b style={CAPTION_STYLE[caption.who]}>{caption.who}:</b> {caption.text}</div>
	{/if}
	<div class="dock">
		<span class="timer">{clock(elapsed)}</span>
		<button class="round" aria-label="Mute">🎙</button>
		<button class="ptt" aria-pressed="false">Hold Space to talk</button>
		<button class="round" aria-label="Hint">?</button>
		<button class="round end">End interview</button>
	</div>
</div>

<style>
	.call {
		--warn: #fbbf24;
		position: relative;
		background: #000;
		border-radius: 10px;
		overflow: hidden;
	}
	button {
		font: inherit;
	}
	.screen {
		position: relative;
		aspect-ratio: 16/9;
		border-radius: 8px;
		overflow: hidden;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		border: 1px solid var(--line);
	}
	.screen video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.call .main {
		aspect-ratio: 16/9;
	}
	.call .main .screen {
		border-radius: 0;
		border: 0;
		height: 100%;
	}
	.call .tiles {
		position: absolute;
		right: 12px;
		top: 12px;
		display: grid;
		gap: 8px;
		width: 200px;
	}
	.tile {
		aspect-ratio: 16/10;
		border-radius: 8px;
		background: #1c1c22;
		border: 2px solid transparent;
		display: grid;
		place-items: center;
		position: relative;
	}
	.tile.talking {
		border-color: var(--good);
	}
	.tile .avatar {
		width: 54px;
		height: 54px;
		border-radius: 50%;
		background: linear-gradient(135deg, #60a5fa, #a78bfa);
		display: grid;
		place-items: center;
		font-weight: 700;
		color: #0c0c0d;
	}
	.tile .me {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 6px;
	}
	.tile label {
		position: absolute;
		left: 6px;
		bottom: 4px;
		font-size: 12px;
		background: rgba(0, 0, 0, 0.6);
		padding: 1px 6px;
		border-radius: 4px;
	}
	.call .captions {
		position: absolute;
		left: 50%;
		bottom: 76px;
		transform: translateX(-50%);
		max-width: 70%;
		background: rgba(0, 0, 0, 0.78);
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 16px;
		line-height: 1.4;
		text-align: center;
	}
	.call .captions b {
		color: var(--accent);
		font-weight: 600;
	}
	.call .dock {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		gap: 10px;
		justify-content: center;
		align-items: center;
		padding: 12px;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
	}
	.timer {
		font-variant-numeric: tabular-nums;
	}
	.call .dock .timer {
		position: absolute;
		left: 16px;
		color: var(--muted);
	}
	.btn {
		min-height: 44px;
		padding: 0 16px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--fg);
		cursor: pointer;
	}
	.btn:hover {
		border-color: var(--accent);
	}
	.ptt {
		min-height: 48px;
		padding: 0 18px;
		border-radius: 99px;
		border: 2px solid var(--good);
		background: transparent;
		color: var(--good);
		font-weight: 700;
		cursor: pointer;
		user-select: none;
	}
	.round {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: 0;
		background: #2a2a31;
		color: var(--fg);
		cursor: pointer;
		font-size: 18px;
	}
	.round:hover {
		background: #3a3a43;
	}
	.round.end {
		background: var(--bad);
		color: #0c0c0d;
		width: auto;
		padding: 0 18px;
		border-radius: 24px;
		font-size: 15px;
		font-weight: 700;
	}
	.drawer-btn {
		position: absolute;
		left: 12px;
		top: 12px;
	}
	.drawer {
		position: absolute;
		left: 12px;
		top: 64px;
		width: 340px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 14px;
		display: grid;
		gap: 12px;
		align-content: start;
		font-size: 14px;
		max-height: 300px;
		overflow: auto;
	}
	.msg {
		display: grid;
		gap: 2px;
	}
	.msg .who {
		font-size: 12px;
		color: var(--muted);
	}
	.msg.ai .body {
		color: var(--fg);
	}
	.msg.me .body {
		color: #cbd5e1;
	}
	@media (max-width: 900px) {
		.call .tiles {
			width: 120px;
		}
	}
</style>
