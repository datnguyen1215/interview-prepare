<script lang="ts">
	import { onDestroy } from 'svelte';
	import CheckRow from './CheckRow.svelte';
	import { SCREEN_PENDING, useDevices } from './devices.svelte.js';
	import { startRecording, uploadRecording } from './media.js';

	let { onsaved }: { onsaved: () => void } = $props();

	const devices = useDevices();

	let title = $state('');
	let elapsed = $state(0);
	let status = $state('');
	let recording = $state(false);
	let live = $state<MediaStream | null>(null);

	let screen: MediaStream | undefined;
	let session: ReturnType<typeof startRecording> | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;

	const log = (...args: unknown[]) => console.log('[recorder]', ...args);

	onDestroy(() => screen?.getTracks().forEach((t) => t.stop()));

	async function start() {
		log('start clicked', { title });
		if (!devices.camera || !devices.mic || !devices.system) return;
		status = 'Starting...';
		screen = await devices.acquire('screen', () => navigator.mediaDevices.getDisplayMedia({ video: true }));
		if (!screen) {
			status = `Error: ${devices.checks.screen.detail}`;
			return;
		}
		screen.getVideoTracks()[0].onended = () => {
			log('screen share ended by browser');
			stop();
		};
		session = startRecording({ screen, camera: devices.camera, mic: devices.mic, system: devices.system });
		live = session.stream;
		recording = true;
		status = '';
		elapsed = 0;
		const startedAt = Date.now();
		timer = setInterval(() => (elapsed = Math.floor((Date.now() - startedAt) / 1000)), 500);
	}

	async function stop() {
		log('stop', { recording: !!session });
		if (!session) return;
		const pending = session.stop();
		session = undefined;
		screen?.getTracks().forEach((t) => t.stop());
		screen = undefined;
		devices.checks.screen = { ...devices.checks.screen, state: 'pending', detail: SCREEN_PENDING };
		clearInterval(timer);
		live = null;
		recording = false;
		const blob = await pending;
		status = 'Saving...';
		try {
			await uploadRecording(blob, title, elapsed);
		} catch (e) {
			status = (e as Error).message;
			return;
		}
		status = '';
		onsaved();
	}

	function preview(node: HTMLVideoElement, stream: MediaStream | null | undefined) {
		node.srcObject = stream ?? null;
		return { update: (s: MediaStream | null | undefined) => (node.srcObject = s ?? null) };
	}
</script>

<div class="screen">
	<video use:preview={live ?? devices.camera} autoplay muted></video>
</div>

<aside class="side">
	{#each Object.values(devices.checks) as c (c.label)}
		<CheckRow check={c} />
	{/each}
	<input bind:value={title} placeholder="Title, e.g. design-twitter" aria-label="Title" disabled={recording} />
	{#if recording}
		<button class="recbtn stop" onclick={stop}>
			<span class="rec-dot"></span>Stop · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
		</button>
	{:else}
		<button class="recbtn" onclick={start} disabled={!devices.ready}>● Record</button>
	{/if}
	{#if status}
		<small class="status">{status}</small>
	{/if}
	<a href="/interview" class="status">Mock interview →</a>
</aside>

<style>
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
	input {
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
	.recbtn.stop {
		background: var(--fg);
	}
	.rec-dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--bad);
		margin-right: 6px;
		animation: blink 1s infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.status {
		color: var(--muted);
		font-size: 12px;
	}
</style>
