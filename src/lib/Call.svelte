<script module lang="ts">
	export async function send(path: string, init: RequestInit = {}): Promise<Response> {
		const res = await fetch(path, init);
		if (res.ok) return res;
		const message = res.headers.get('content-type')?.includes('json')
			? ((await res.json()) as { message?: string }).message
			: await res.text();
		console.error('[call] api failed', init.method ?? 'GET', path, res.status, message);
		throw new Error(message || `${path} failed: ${res.status}`);
	}

	export async function api<T>(path: string, body?: unknown): Promise<T> {
		const init =
			body === undefined
				? {}
				: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
		return (await (await send(path, init)).json()) as T;
	}

	export function preview(node: HTMLVideoElement, stream: MediaStream | null | undefined) {
		node.srcObject = stream ?? null;
		return { update: (s: MediaStream | null | undefined) => (node.srcObject = s ?? null) };
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { uploadRecording, type startRecording } from '#lib/media.js';
	import type { Plan } from '#lib/server/interviewer.js';
	import { clock, formatTranscript, whoLabel, type TimedEntry } from '#lib/transcript.js';

	let {
		plan,
		screen,
		camera,
		mic,
		recording,
		startedAt
	}: {
		plan: Plan;
		screen: MediaStream;
		camera: MediaStream;
		mic: MediaStream;
		recording: ReturnType<typeof startRecording>;
		startedAt: number;
	} = $props();

	type Caption = { who?: 'Interviewer' | 'You' | 'Hint' | 'Error'; text: string };
	type Speech = { speaking: boolean; queued: number };
	type Clip = { recorder: MediaRecorder; chunks: Blob[]; t0: number; at: number };

	const CAPTION_STYLE: Record<NonNullable<Caption['who']>, string | undefined> = {
		Interviewer: undefined,
		You: 'color:var(--good)',
		Hint: 'color:var(--warn)',
		Error: 'color:var(--bad)'
	};
	const MIN_CLIP_MS = 300;

	let elapsed = $state(0);
	let caption = $state<Caption>();
	let entries = $state<TimedEntry[]>([]);
	let aiTalking = $state(false);
	let youTalking = $state(false);
	let drawerOpen = $state(false);
	let busy = $state(false);
	let muted = $state(false);
	let ended = $state(false);
	let saveFailed = $state(false);
	let inflight: Promise<void> = Promise.resolve();
	let speechLoop = 0;
	let clip: Clip | undefined;
	let captionBeforeHold: Caption | undefined;
	let saved: { blob: Blob; duration: number; name?: string } | undefined;

	const log = (...args: unknown[]) => console.log('[call]', ...args);
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const since = (t0: number) => Math.round(performance.now() - t0);
	const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
	const history = () => entries.map(({ who, text }) => ({ who, text }));

	onMount(() => {
		log('mounted', { role: plan.role, level: plan.level, questions: plan.questions.length });
		const timer = setInterval(() => (elapsed = Math.floor((Date.now() - startedAt) / 1000)), 500);
		screen.getVideoTracks()[0].onended = () => end('screen share ended by browser');
		run('first turn', () => next(performance.now()));
		return () => {
			log('unmounted', { elapsed, entries: entries.length });
			ended = true;
			speechLoop++;
			clearInterval(timer);
		};
	});

	function showError(step: string, e: unknown) {
		console.error('[call]', `${step} failed`, e);
		caption = { who: 'Error', text: message(e) };
	}

	// One /transcribe or /turn at a time; End awaits `inflight` so a late reply is never spoken or saved.
	function run(name: string, task: () => Promise<void>) {
		log('busy:', name);
		busy = true;
		inflight = task().finally(() => {
			busy = false;
			log('idle after', name);
		});
	}

	async function next(t0: number) {
		log('turn next', { history: entries.length });
		const tTurn = performance.now();
		let text: string;
		try {
			({ text } = await api<{ text: string }>('/api/interview/turn', { plan, history: history(), kind: 'next' }));
		} catch (e) {
			if (ended) return log('turn error dropped after End', message(e));
			return showError('turn', e);
		}
		log('turn done', { ms: since(tTurn), chars: text.length });
		if (ended) return log('turn reply dropped after End', { chars: text.length });
		entries.push({ who: 'interviewer', text, at: elapsed });
		caption = { who: 'Interviewer', text };
		void waitForSpeech(t0);
	}

	async function waitForSpeech(t0: number) {
		const id = ++speechLoop;
		log('speaking: polling until idle', { loop: id });
		aiTalking = true;
		let heard = false;
		try {
			let s: Speech;
			do {
				await sleep(300);
				if (id !== speechLoop) return log('speech polling stopped', { loop: id });
				s = await api<Speech>('/api/interview/speech');
				console.debug('[call] speech', s);
				if (s.speaking && !heard) log('first speech', { msSinceStart: since(t0) });
				heard ||= s.speaking;
			} while (s.speaking || s.queued > 0);
			log('speaking done', { ms: since(t0) });
		} catch (e) {
			if (id === speechLoop) showError('speech status', e);
		}
		if (id === speechLoop) aiTalking = false;
	}

	async function stopSpeech() {
		const t0 = performance.now();
		log('stopping speech');
		await send('/api/interview/speech', { method: 'DELETE' });
		log('speech stopped', { ms: since(t0) });
	}

	function press() {
		if (youTalking || busy || ended) return log('press ignored', { youTalking, busy, ended });
		const wasTalking = aiTalking;
		log('push-to-talk down', { bargeIn: wasTalking });
		youTalking = true;
		aiTalking = false;
		captionBeforeHold = caption;
		caption = { who: 'You', text: '…' };
		if (wasTalking) {
			speechLoop++;
			stopSpeech().catch((e) => showError('stop speech', e));
		}
		const recorder = new MediaRecorder(mic, { mimeType: 'audio/webm;codecs=opus' });
		clip = { recorder, chunks: [], t0: performance.now(), at: elapsed };
		const { chunks } = clip;
		recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		recorder.onerror = (e) => console.error('[call] clip MediaRecorder error', e);
		recorder.start();
	}

	function release() {
		if (!youTalking || !clip) return;
		const held = clip;
		const ms = since(held.t0);
		clip = undefined;
		youTalking = false;
		if (ms < MIN_CLIP_MS) {
			log('clip dropped: too short', { ms });
			held.recorder.stop();
			caption = captionBeforeHold;
			return;
		}
		log('push-to-talk up', { recordMs: ms });
		run('answer', () => answer(held));
	}

	function stopClip(c: Clip): Promise<Blob> {
		const done = new Promise<Blob>((resolve) => {
			c.recorder.onstop = () => resolve(new Blob(c.chunks, { type: 'audio/webm' }));
		});
		c.recorder.stop();
		return done;
	}

	async function answer(c: Clip) {
		const t0 = performance.now();
		const blob = await stopClip(c);
		log('clip recorded', { bytes: blob.size, chunks: c.chunks.length });
		let text: string;
		try {
			const res = await send('/api/interview/transcribe', {
				method: 'POST',
				headers: { 'content-type': 'audio/webm' },
				body: blob
			});
			({ text } = (await res.json()) as { text: string });
		} catch (e) {
			if (ended) return log('transcribe error dropped after End', message(e));
			return showError('transcribe', e);
		}
		log('transcribe done', { ms: since(t0), chars: text.length });
		if (ended) return log('transcript dropped after End', { chars: text.length });
		if (!text.trim()) {
			console.warn('[call] transcribe returned empty text; no turn', { bytes: blob.size });
			caption = captionBeforeHold;
			return;
		}
		entries.push({ who: 'you', text, at: c.at });
		caption = { who: 'You', text };
		await next(t0);
	}

	function hint() {
		if (youTalking || busy || ended) return log('hint ignored', { youTalking, busy, ended });
		run('hint', async () => {
			const t0 = performance.now();
			log('turn hint', { history: entries.length });
			let text: string;
			try {
				({ text } = await api<{ text: string }>('/api/interview/turn', { plan, history: history(), kind: 'hint' }));
			} catch (e) {
				if (ended) return log('hint error dropped after End', message(e));
				return showError('hint', e);
			}
			log('hint done', { ms: since(t0), chars: text.length });
			if (ended) return log('hint dropped after End');
			entries.push({ who: 'hint', text, at: elapsed });
			caption = { who: 'Hint', text };
		});
	}

	function toggleMute() {
		muted = !muted;
		mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
		log('mic', muted ? 'muted' : 'unmuted');
	}

	function onKey(e: KeyboardEvent) {
		if (e.code !== 'Space') return;
		const t = e.target;
		if (t instanceof HTMLElement && (t.matches('input, textarea') || t.isContentEditable)) return;
		// Without this, Space clicks the focused button (End interview stays focused after a click).
		e.preventDefault();
		if (e.repeat) return;
		if (e.type === 'keydown') press();
		else release();
	}

	async function end(reason: string) {
		if (ended) return log('end ignored: already ended', { reason });
		ended = true;
		log('end', { reason, busy, holding: youTalking, entries: entries.length });
		if (clip) {
			log('discarding held clip');
			clip.recorder.stop();
			clip = undefined;
			youTalking = false;
		}
		caption = { text: 'Saving...' };
		await inflight;
		log('in-flight request settled');
		speechLoop++;
		aiTalking = false;
		await stopSpeech().catch((e) => console.error('[call] stop speech on End failed', e));
		saved = { blob: await recording.stop(), duration: elapsed };
		screen.getTracks().forEach((t) => t.stop());
		await save();
	}

	async function save() {
		if (!saved) throw new Error('save called before the recording was stopped');
		saveFailed = false;
		caption = { text: 'Saving...' };
		try {
			saved.name ??= await uploadRecording(saved.blob, 'interview-' + plan.role, saved.duration);
			log('posting transcript', { name: saved.name, entries: entries.length });
			await send(`/api/recordings/${encodeURIComponent(saved.name)}/transcript`, {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: formatTranscript(entries)
			});
		} catch (e) {
			showError('save', e);
			saveFailed = true;
			return;
		}
		log('saved', { name: saved.name });
		await goto('/');
	}
</script>

<svelte:window onkeydowncapture={onKey} onkeyupcapture={onKey} />

<div class="call">
	<div class="main"><div class="screen"><video use:preview={screen} autoplay muted></video></div></div>
	<button class="btn drawer-btn" onclick={() => (drawerOpen = !drawerOpen)}>☰ Transcript</button>
	{#if drawerOpen}
		<div class="drawer">
			{#each entries as e, i (i)}
				<div class="msg" class:ai={e.who !== 'you'} class:me={e.who === 'you'}>
					<span class="who" style={e.who === 'hint' ? 'color:var(--warn)' : undefined}>{whoLabel(e.who)}</span><span
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
		<div class="tile" class:talking={youTalking}><video class="me" use:preview={camera} autoplay muted></video><label>You</label></div>
	</div>
	{#if caption}
		<div class="captions">
			{#if caption.who}<b style={CAPTION_STYLE[caption.who]}>{caption.who}:</b>{/if}
			{caption.text}
			{#if saveFailed}<button class="btn" onclick={save}>Retry save</button>{/if}
		</div>
	{/if}
	<div class="dock">
		<span class="timer">{clock(elapsed)}</span>
		<button class="round" aria-label="Mute" aria-pressed={muted} onclick={toggleMute}>🎙</button>
		<button
			class="ptt"
			aria-pressed={youTalking}
			disabled={busy}
			onpointerdown={press}
			onpointerup={release}
			onpointerleave={release}
		>
			{youTalking ? '● Listening… release to send' : 'Hold Space to talk'}
		</button>
		<button class="round" aria-label="Hint" disabled={busy} onclick={hint}>?</button>
		<button class="round end" disabled={ended} onclick={() => end('End interview clicked')}>End interview</button>
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
	.ptt[aria-pressed='true'] {
		background: var(--good);
		color: #0c0c0d;
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
