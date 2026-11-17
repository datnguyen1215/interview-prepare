import { onMount } from 'svelte';
import { findCamera, findSystemDevice, NO_SYSTEM_INPUT, RAW_AUDIO, SYSTEM_SETUP } from './media.js';

export type CheckName = 'camera' | 'microphone' | 'system' | 'screen';
export type Check = { label: string; state: 'pending' | 'ok' | 'fail'; detail: string; level?: number; fix?: string };

export const SCREEN_PENDING = 'Not shared';

const log = (...args: unknown[]) => console.log('[devices]', ...args);
const describe = (s: MediaStream) =>
	s.getTracks().map((t) => `${t.kind}:"${t.label}" ${t.readyState} ${JSON.stringify(t.getSettings())}`);

async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
	log(`${name}...`);
	try {
		const result = await fn();
		log(`${name} ok`, result instanceof MediaStream ? describe(result) : '');
		return result;
	} catch (e) {
		console.error('[devices]', `${name} failed`, e);
		throw new Error(`${name} failed: ${(e as Error).name}: ${(e as Error).message}`, { cause: e });
	}
}

// Call during component init (uses onMount). Never destructure the result: streams arrive after mount.
export function useDevices() {
	const checks = $state<Record<CheckName, Check>>({
		camera: { label: 'Camera', state: 'pending', detail: 'Requesting...' },
		microphone: { label: 'Microphone', state: 'pending', detail: 'Requesting...', level: 0 },
		system: { label: 'System sound', state: 'pending', detail: 'Requesting...', level: 0 },
		screen: { label: 'Screen', state: 'pending', detail: SCREEN_PENDING }
	});
	const ready = $derived(checks.camera.state === 'ok' && checks.microphone.state === 'ok' && checks.system.state === 'ok');
	let camera = $state.raw<MediaStream | undefined>();
	let mic = $state.raw<MediaStream | undefined>();
	let system = $state.raw<MediaStream | undefined>();

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
			// Mic first: its grant unlocks device labels, so findCamera can skip the physical camera.
			mic = await acquire('microphone', () => navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO }));
			camera = await acquire('camera', findCamera);
			system = await acquire('system', findSystemDevice);
			if (checks.system.detail === NO_SYSTEM_INPUT) checks.system.fix = SYSTEM_SETUP;
			const meters = [mic && meter(ac, mic, 'microphone'), system && meter(ac, system, 'system')].filter((m) => !!m);
			const loop = () => {
				meters.forEach((m) => m());
				frame = requestAnimationFrame(loop);
			};
			loop();
		})();
		return () => {
			log('releasing devices');
			cancelAnimationFrame(frame);
			ac.close();
			[camera, mic, system].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
		};
	});

	return {
		checks,
		acquire,
		get ready() {
			return ready;
		},
		get camera() {
			return camera;
		},
		get mic() {
			return mic;
		},
		get system() {
			return system;
		}
	};
}
