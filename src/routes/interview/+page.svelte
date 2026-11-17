<script lang="ts">
	import { onDestroy } from 'svelte';
	import Call, { api, preview } from '#lib/Call.svelte';
	import CheckRow from '#lib/CheckRow.svelte';
	import { useDevices } from '#lib/devices.svelte.js';
	import { startRecording } from '#lib/media.js';
	import type { Plan } from '#lib/server/interviewer.js';

	const devices = useDevices();

	let phase = $state<'setup' | 'preparing' | 'call' | 'saving'>('setup');
	let status = $state('');
	let jobPost = $state('');
	let plan = $state.raw<Plan>();
	let screen = $state.raw<MediaStream>();
	let startedAt = $state(0);
	let session = $state.raw<ReturnType<typeof startRecording>>();

	const log = (...args: unknown[]) => console.log('[interview]', ...args);

	onDestroy(() => screen?.getTracks().forEach((t) => t.stop()));

	function fail(message: string) {
		console.error('[interview] start failed:', message);
		status = `Error: ${message}`;
		phase = 'setup';
	}

	async function start() {
		const { camera, mic, system } = devices;
		log('start clicked', { jobPostChars: jobPost.length });
		if (!camera || !mic || !system) return;
		status = '';
		phase = 'preparing';
		const display = await devices.acquire('screen', () => navigator.mediaDevices.getDisplayMedia({ video: true }));
		if (!display) return fail(devices.checks.screen.detail);
		try {
			const t0 = performance.now();
			log('requesting plan');
			plan = await api<Plan>('/api/interview/plan', { jobPost });
			log('plan ready', { ms: Math.round(performance.now() - t0), role: plan.role, questions: plan.questions.length });
			session = startRecording({ screen: display, camera, mic, system });
		} catch (e) {
			display.getTracks().forEach((t) => t.stop());
			log('display tracks stopped after failure');
			return fail(e instanceof Error ? e.message : String(e));
		}
		screen = display;
		startedAt = Date.now();
		phase = 'call';
		log('call started', { recording: !!session });
	}
</script>

<svelte:head><title>Mock interview</title></svelte:head>

{#if phase === 'call' && plan && screen && session && devices.camera && devices.mic}
	<main class="stage">
		<Call {plan} {screen} camera={devices.camera} mic={devices.mic} recording={session} {startedAt} />
	</main>
{:else}
	<main class="studio">
		<div class="screen">
			<video use:preview={devices.camera} autoplay muted></video>
		</div>
		<aside class="side">
			<CheckRow check={devices.checks.camera} />
			<CheckRow check={devices.checks.microphone} />
			<CheckRow check={devices.checks.system} />
			<textarea
				rows="10"
				bind:value={jobPost}
				placeholder="Paste the job post"
				aria-label="Job post"
				disabled={phase === 'preparing'}
			></textarea>
			<button class="recbtn" onclick={start} disabled={!devices.ready || !jobPost.trim() || phase === 'preparing'}>
				{phase === 'preparing' ? 'Preparing questions...' : '● Start interview'}
			</button>
			{#if status}
				<small class="status">{status}</small>
			{/if}
		</aside>
	</main>
{/if}

<style>
	/* Same tokens as the Studio page, which is not loaded when /interview is opened directly. */
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
	}
	.screen video {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
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
	.status {
		color: var(--muted);
		font-size: 12px;
	}
	@media (max-width: 760px) {
		.studio {
			grid-template-columns: 1fr;
		}
	}
</style>
