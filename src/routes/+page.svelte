<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Call, { api, preview } from '#lib/Call.svelte';
	import CheckRow from '#lib/CheckRow.svelte';
	import { SCREEN_PENDING, useDevices } from '#lib/devices.svelte.js';
	import { startRecording } from '#lib/media.js';
	import type { Plan } from '#lib/server/interviewer.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const devices = useDevices();

	let phase = $state<'setup' | 'preparing' | 'call' | 'saving'>('setup');
	let status = $state('');
	let jobPost = $state('');
	let plan = $state.raw<Plan>();
	let screen = $state.raw<MediaStream>();
	let startedAt = $state(0);
	let session = $state.raw<ReturnType<typeof startRecording>>();
	let playing = $state<string | null>(null);

	const log = (...args: unknown[]) => console.log('[interview]', ...args);

	onDestroy(releaseScreen);

	const pad = (n: number) => String(n).padStart(2, '0');

	function formatDuration(s: number): string {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
	}

	function formatDate(ms: number): string {
		const d = new Date(ms);
		const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
		if (days === 0) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
		if (days === 1) return 'Yesterday';
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	async function share() {
		log('share screen clicked');
		const display = await devices.acquire('screen', () => navigator.mediaDevices.getDisplayMedia({ video: true }));
		if (!display) return console.error('[interview] screen share failed:', devices.checks.screen.detail);
		// Call.svelte replaces this handler, so stopping mid-call ends the call instead.
		display.getVideoTracks()[0].onended = () => {
			log('screen share ended by browser before start');
			releaseScreen();
		};
		screen = display;
	}

	function releaseScreen() {
		log('releasing screen share', { shared: !!screen });
		screen?.getTracks().forEach((t) => t.stop());
		screen = undefined;
		devices.checks.screen = { ...devices.checks.screen, state: 'pending', detail: SCREEN_PENDING };
	}

	async function saved() {
		log('call saved, back to setup');
		releaseScreen();
		await invalidateAll();
		phase = 'setup';
		log('library reloaded', { recordings: data.recordings.length });
	}

	function fail(message: string) {
		console.error('[interview] start failed:', message);
		status = `Error: ${message}`;
		phase = 'setup';
	}

	async function start() {
		const { camera, mic, system } = devices;
		log('start clicked', { jobPostChars: jobPost.length });
		if (!camera || !mic || !system || !screen) return;
		status = '';
		phase = 'preparing';
		try {
			const t0 = performance.now();
			log('requesting plan');
			plan = await api<Plan>('/api/interview/plan', { jobPost });
			log('plan ready', { ms: Math.round(performance.now() - t0), role: plan.role, questions: plan.questions.length });
			session = startRecording({ screen, camera, mic, system });
		} catch (e) {
			log('screen share kept for retry');
			return fail(e instanceof Error ? e.message : String(e));
		}
		startedAt = Date.now();
		phase = 'call';
		log('call started', { recording: !!session });
	}
</script>

<svelte:head><title>Mock interview</title></svelte:head>

{#if phase === 'call' && plan && screen && session && devices.camera && devices.mic}
	<main class="stage">
		<Call {plan} {screen} camera={devices.camera} mic={devices.mic} recording={session} {startedAt} onsaved={saved} />
	</main>
{:else}
	<main class="studio">
		<div class="screen">
			{#if screen}
				<video use:preview={screen} autoplay muted></video>
			{/if}
			<video class:pip={!!screen} use:preview={devices.camera} autoplay muted></video>
		</div>
		<aside class="side">
			<CheckRow check={devices.checks.camera} />
			<CheckRow check={devices.checks.microphone} />
			<CheckRow check={devices.checks.system} />
			<CheckRow check={devices.checks.screen} />
			{#if !screen}
				<button class="btn" onclick={share}>Share screen</button>
			{/if}
			<textarea
				rows="10"
				bind:value={jobPost}
				placeholder="Paste the job post"
				aria-label="Job post"
				disabled={phase === 'preparing'}
			></textarea>
			<button class="recbtn" onclick={start} disabled={!devices.ready || !screen || !jobPost.trim() || phase === 'preparing'}>
				{phase === 'preparing' ? 'Preparing questions...' : '● Start interview'}
			</button>
			{#if status}
				<small class="status">{status}</small>
			{/if}
		</aside>

		<div class="lib">
			{#each data.recordings as r (r.name)}
				<article class="card">
					<div class="thumb">
						{#if playing === r.name}
							<video controls autoplay src="/recordings/{encodeURIComponent(r.name)}"></video>
						{:else}
							<video preload="metadata" muted src="/recordings/{encodeURIComponent(r.name)}#t=1"></video>
							<button aria-label="Play {r.title}" onclick={() => (playing = r.name)}>▶</button>
							{#if r.duration}
								<span class="dur">{formatDuration(r.duration)}</span>
							{/if}
						{/if}
					</div>
					<div class="meta">
						<div>
							<b>{r.title}</b>
							<small>{formatDate(r.created)} · {Math.max(1, Math.round(r.size / 1e6))} MB{#if r.transcript}{' · '}<a
									href="/recordings/{r.name}/transcript"
									target="_blank">Transcript</a
								>{/if}</small
							>
						</div>
						<form
							method="POST"
							action="?/delete"
							use:enhance={({ cancel }) => {
								if (!confirm(`Delete "${r.title}"?`)) cancel();
							}}
						>
							<input type="hidden" name="name" value={r.name} />
							<button class="icon-btn" aria-label="Delete {r.title}">🗑</button>
						</form>
					</div>
				</article>
			{/each}
		</div>
	</main>
{/if}

<style>
	:global(:root) {
		--bg: #0c0c0d;
		--panel: #16161a;
		--fg: #f4f4f5;
		--muted: #a1a1aa;
		--line: #27272a;
		--accent: #60a5fa;
		--good: #4ade80;
		--bad: #f87171;
	}
	:global(*) {
		box-sizing: border-box;
	}
	:global(html, body) {
		background: var(--bg);
		color: var(--fg);
		margin: 0;
		font-family: system-ui, sans-serif;
	}
	:global(:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	/* Width capped so the 16:9 call plus the 40px padding fits the viewport height. */
	.stage {
		padding: 20px;
		max-width: calc((100vh - 40px) * 16 / 9 + 40px);
		margin: 0 auto;
	}
	.studio {
		max-width: 1100px;
		margin: 0 auto;
		padding: 20px 16px;
		display: grid;
		grid-template-columns: 1fr 280px;
		gap: 16px;
		align-items: start;
	}
	.screen {
		aspect-ratio: 16 / 9;
		border-radius: 8px;
		overflow: hidden;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		border: 1px solid var(--line);
		position: relative;
		container-type: inline-size;
	}
	.screen video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	/* Mirrors composite() in media.ts: camera at 1/4 width, 16px inset on a 1920 frame. */
	.screen .pip {
		position: absolute;
		width: 25%;
		height: auto;
		right: calc(100cqw * 16 / 1920);
		bottom: calc(100cqw * 16 / 1920);
	}
	.side {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	textarea {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 10px;
		width: 100%;
		font: inherit;
	}
	.recbtn {
		min-height: 48px;
		border-radius: 8px;
		border: 0;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
		background: var(--bad);
		color: var(--bg);
	}
	.recbtn:hover {
		filter: brightness(1.1);
	}
	.recbtn:disabled {
		background: var(--line);
		color: var(--muted);
		cursor: not-allowed;
	}
	.btn {
		min-height: 44px;
		padding: 0 16px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--fg);
		font: inherit;
		cursor: pointer;
	}
	.btn:hover {
		border-color: var(--accent);
	}
	.status {
		color: var(--muted);
		font-size: 12px;
	}
	.lib {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	.thumb {
		aspect-ratio: 16 / 9;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		position: relative;
		display: grid;
		place-items: center;
	}
	.thumb video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.thumb button {
		position: relative;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 0;
		background: rgba(244, 244, 245, 0.9);
		cursor: pointer;
	}
	.thumb button:hover {
		background: #fff;
	}
	.dur {
		position: absolute;
		right: 6px;
		bottom: 6px;
		font-size: 12px;
		background: rgba(0, 0, 0, 0.7);
		padding: 1px 5px;
		border-radius: 3px;
	}
	.meta {
		padding: 8px 10px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.meta div {
		min-width: 0;
	}
	.meta b {
		display: block;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta small {
		color: var(--muted);
		font-size: 12px;
	}
	.meta small a {
		color: var(--muted);
	}
	.icon-btn {
		min-width: 44px;
		min-height: 44px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.icon-btn:hover {
		color: var(--bad);
		border-color: var(--line);
	}
	@media (max-width: 760px) {
		.studio {
			grid-template-columns: 1fr;
		}
	}
</style>
