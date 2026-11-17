<script lang="ts">
	import { onMount } from 'svelte';

	let { onsaved }: { onsaved: () => void } = $props();

	type CheckName = 'camera' | 'microphone' | 'system' | 'screen';
	type Check = { label: string; state: 'pending' | 'ok' | 'fail'; detail: string; level?: number; fix?: string };

	const SYSTEM_LABEL = /System_Audio/i;
	const SYSTEM_SETUP =
		'pactl load-module module-remap-source master=alsa_output.pci-0000_01_00.1.hdmi-stereo.monitor source_name=system_audio source_properties=device.description=System_Audio';
	// Browser voice processing muffles speech and ducks it whenever system audio plays.
	const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

	const SCREEN_PENDING = 'Asked when you start';

	let title = $state('');
	let elapsed = $state(0);
	let status = $state('');
	let recording = $state(false);
	let live = $state<MediaStream | null>(null);
	let checks = $state<Record<CheckName, Check>>({
		camera: { label: 'Camera', state: 'pending', detail: 'Requesting...' },
		microphone: { label: 'Microphone', state: 'pending', detail: 'Requesting...', level: 0 },
		system: { label: 'System sound', state: 'pending', detail: 'Requesting...', level: 0 },
		screen: { label: 'Screen', state: 'pending', detail: SCREEN_PENDING }
	});
	let ready = $derived(checks.camera.state === 'ok' && checks.microphone.state === 'ok' && checks.system.state === 'ok');

	let camera = $state.raw<MediaStream | undefined>();
	let mic: MediaStream | undefined;
	let system: MediaStream | undefined;
	let screen: MediaStream | undefined;
	let recorder: MediaRecorder | undefined;
	let chunks: Blob[] = [];
	let cleanup: (() => void)[] = [];

	const log = (...args: unknown[]) => console.log('[recorder]', ...args);
	const describe = (s: MediaStream) =>
		s.getTracks().map((t) => `${t.kind}:"${t.label}" ${t.readyState} ${JSON.stringify(t.getSettings())}`);

	async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
		log(`${name}...`);
		try {
			const result = await fn();
			log(`${name} ok`, result instanceof MediaStream ? describe(result) : '');
			return result;
		} catch (e) {
			console.error('[recorder]', `${name} failed`, e);
			throw new Error(`${name} failed: ${(e as Error).name}: ${(e as Error).message}`, { cause: e });
		}
	}

	async function acquire(name: CheckName, fn: () => Promise<MediaStream>): Promise<MediaStream | undefined> {
		try {
			const stream = await step(name, fn);
			checks[name] = { ...checks[name], state: 'ok', detail: stream.getTracks()[0].label };
			return stream;
		} catch (e) {
			const cause = (e as Error).cause as Error | undefined;
			checks[name] = { ...checks[name], state: 'fail', detail: cause?.message ?? (e as Error).message };
		}
	}

	async function findSystemDevice(): Promise<MediaStream> {
		const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
		log('audio inputs', inputs.map((d) => d.label));
		const device = inputs.find((d) => SYSTEM_LABEL.test(d.label));
		if (!device) {
			checks.system.fix = SYSTEM_SETUP;
			throw new Error('No System_Audio input');
		}
		return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device.deviceId }, ...RAW_AUDIO } });
	}

	function meter(ac: AudioContext, stream: MediaStream, name: 'microphone' | 'system') {
		const analyser = ac.createAnalyser();
		ac.createMediaStreamSource(stream).connect(analyser);
		const buf = new Float32Array(analyser.fftSize);
		return () => {
			analyser.getFloatTimeDomainData(buf);
			const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
			const db = 20 * Math.log10(rms || 1e-8);
			checks[name].level = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
		};
	}

	onMount(() => {
		let frame = 0;
		const ac = new AudioContext();
		(async () => {
			camera = await acquire('camera', () => navigator.mediaDevices.getUserMedia({ video: true }));
			mic = await acquire('microphone', () => navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO }));
			system = await acquire('system', findSystemDevice);
			const meters = [mic && meter(ac, mic, 'microphone'), system && meter(ac, system, 'system')].filter((m) => !!m);
			const loop = () => {
				meters.forEach((m) => m());
				frame = requestAnimationFrame(loop);
			};
			loop();
		})();
		return () => {
			cancelAnimationFrame(frame);
			ac.close();
			[camera, mic, system, screen].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
		};
	});

	function videoOf(stream: MediaStream): HTMLVideoElement {
		const el = document.createElement('video');
		el.srcObject = stream;
		el.muted = true;
		el.play().catch((e) => console.error('[recorder] hidden video play failed', e));
		return el;
	}

	// Worker timer keeps drawing while this tab is in the background; main-thread timers get throttled.
	function tick(fps: number, fn: () => void) {
		const src = `setInterval(() => postMessage(0), ${1000 / fps})`;
		const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
		worker.onmessage = fn;
		cleanup.push(() => worker.terminate());
	}

	function composite(screen: MediaStream, camera: MediaStream): MediaStreamTrack {
		const screenEl = videoOf(screen);
		const cameraEl = videoOf(camera);
		const { width = 1920, height = 1080 } = screen.getVideoTracks()[0].getSettings();
		log('composite canvas', width, 'x', height);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d')!;
		tick(30, () => {
			ctx.drawImage(screenEl, 0, 0, width, height);
			const camW = width / 4;
			const camH = camW * (cameraEl.videoHeight / cameraEl.videoWidth || 0.75);
			ctx.drawImage(cameraEl, width - camW - 16, height - camH - 16, camW, camH);
		});
		return canvas.captureStream(30).getVideoTracks()[0];
	}

	function mixAudio(sources: MediaStream[]): MediaStreamTrack {
		const ac = new AudioContext();
		const out = ac.createMediaStreamDestination();
		log('mixing', sources.length, 'audio sources');
		for (const s of sources) ac.createMediaStreamSource(s).connect(out);
		cleanup.push(() => ac.close());
		return out.stream.getAudioTracks()[0];
	}

	async function start() {
		log('start clicked', { title });
		if (!camera || !mic || !system) return;
		cleanup = [];
		status = 'Starting...';
		screen = await acquire('screen', () => navigator.mediaDevices.getDisplayMedia({ video: true }));
		if (!screen) {
			status = `Error: ${checks.screen.detail}`;
			return;
		}
		screen.getVideoTracks()[0].onended = () => {
			log('screen share ended by browser');
			stop();
		};
		live = new MediaStream([composite(screen, camera), mixAudio([mic, system])]);
		chunks = [];
		recorder = new MediaRecorder(live, { mimeType: 'video/webm' });
		recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		recorder.onerror = (e) => console.error('[recorder] MediaRecorder error', e);
		recorder.onstop = upload;
		recorder.start(1000);
		log('recording started');
		recording = true;
		status = '';
		elapsed = 0;
		const startedAt = Date.now();
		const timer = setInterval(() => (elapsed = Math.floor((Date.now() - startedAt) / 1000)), 500);
		cleanup.push(() => clearInterval(timer));
	}

	function stop() {
		log('stop', { state: recorder?.state, chunks: chunks.length });
		if (!recorder || recorder.state === 'inactive') return;
		recorder.stop();
		screen?.getTracks().forEach((t) => t.stop());
		screen = undefined;
		checks.screen = { ...checks.screen, state: 'pending', detail: SCREEN_PENDING };
		cleanup.forEach((fn) => fn());
		live = null;
		recording = false;
	}

	async function upload() {
		status = 'Saving...';
		const blob = new Blob(chunks, { type: 'video/webm' });
		log('uploading', chunks.length, 'chunks,', blob.size, 'bytes');
		const query = new URLSearchParams({ title, duration: String(elapsed) });
		const res = await fetch(`/api/recordings?${query}`, { method: 'POST', body: blob });
		if (!res.ok) {
			status = `Save failed: ${res.status} ${await res.text()}`;
			console.error('[recorder]', status);
			return;
		}
		log('saved', await res.json());
		status = '';
		onsaved();
	}

	function preview(node: HTMLVideoElement, stream: MediaStream | null | undefined) {
		node.srcObject = stream ?? null;
		return { update: (s: MediaStream | null | undefined) => (node.srcObject = s ?? null) };
	}
</script>

<div class="screen">
	<video use:preview={live ?? camera} autoplay muted></video>
</div>

<aside class="side">
	{#each Object.values(checks) as c (c.label)}
		<div class="dev">
			{#if c.state === 'ok'}
				<span class="ok" aria-label="ok">✓</span>
			{:else if c.state === 'fail'}
				<span class="fail" aria-label="failed">✗</span>
			{:else}
				<span class="pend" aria-label="pending">○</span>
			{/if}
			<b>{c.label}</b>
			{#if c.level !== undefined && c.state === 'ok'}
				<span class="meter"><i style="width: {c.level}%"></i></span>
			{/if}
			<small>{c.detail}</small>
			{#if c.fix && c.state === 'fail'}
				<code class="fix">{c.fix}</code>
			{/if}
		</div>
	{/each}
	<input bind:value={title} placeholder="Title, e.g. design-twitter" aria-label="Title" disabled={recording} />
	{#if recording}
		<button class="recbtn stop" onclick={stop}>
			<span class="rec-dot"></span>Stop · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
		</button>
	{:else}
		<button class="recbtn" onclick={start} disabled={!ready}>● Record</button>
	{/if}
	{#if status}
		<small class="status">{status}</small>
	{/if}
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
	.dev {
		display: grid;
		grid-template-columns: 22px 1fr;
		gap: 2px 8px;
		align-items: center;
	}
	.dev b {
		font-size: 14px;
	}
	.dev small,
	.dev .meter,
	.dev .fix {
		grid-column: 2;
	}
	.dev small {
		color: var(--muted);
		font-size: 12px;
	}
	.fix {
		font: 11px ui-monospace, monospace;
		background: var(--bg);
		color: var(--bad);
		padding: 6px;
		border-radius: 4px;
		word-break: break-all;
		user-select: all;
	}
	.meter {
		display: inline-block;
		width: 100%;
		height: 6px;
		background: var(--line);
		border-radius: 3px;
		overflow: hidden;
	}
	.meter i {
		display: block;
		height: 100%;
		background: var(--good);
		transition: width 0.08s;
	}
	.ok {
		color: var(--good);
	}
	.fail {
		color: var(--bad);
	}
	.pend {
		color: var(--muted);
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
