export const SYSTEM_LABEL = /System_Audio/i;
export const SYSTEM_SETUP =
	"pw-loopback -n system_audio_loopback --capture-props='stream.capture.sink=true node.passive=true node.name=system_audio_capture' --playback-props='media.class=Audio/Source node.name=system_audio node.description=System_Audio'";
export const NO_SYSTEM_INPUT = 'No System_Audio input';
// Browser voice processing muffles speech and ducks it whenever system audio plays.
export const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

type Cleanup = (() => void)[];

const log = (...args: unknown[]) => console.log('[media]', ...args);

export async function findSystemDevice(): Promise<MediaStream> {
	const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
	log('audio inputs', inputs.map((d) => d.label));
	const device = inputs.find((d) => SYSTEM_LABEL.test(d.label));
	if (!device) throw new Error(NO_SYSTEM_INPUT);
	return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: device.deviceId }, ...RAW_AUDIO } });
}

export function videoOf(stream: MediaStream): HTMLVideoElement {
	const el = document.createElement('video');
	el.srcObject = stream;
	el.muted = true;
	el.play().catch((e) => console.error('[media] hidden video play failed', e));
	return el;
}

// Worker timer keeps drawing while this tab is in the background; main-thread timers get throttled.
export function tick(fps: number, fn: () => void, cleanup: Cleanup) {
	const src = `setInterval(() => postMessage(0), ${1000 / fps})`;
	const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
	worker.onmessage = fn;
	cleanup.push(() => worker.terminate());
}

export function composite(screen: MediaStream, camera: MediaStream, cleanup: Cleanup): MediaStreamTrack {
	const screenEl = videoOf(screen);
	const cameraEl = videoOf(camera);
	const { width = 1920, height = 1080 } = screen.getVideoTracks()[0].getSettings();
	log('composite canvas', width, 'x', height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d')!;
	tick(
		30,
		() => {
			ctx.drawImage(screenEl, 0, 0, width, height);
			const camW = width / 4;
			const camH = camW * (cameraEl.videoHeight / cameraEl.videoWidth || 0.75);
			ctx.drawImage(cameraEl, width - camW - 16, height - camH - 16, camW, camH);
		},
		cleanup
	);
	return canvas.captureStream(30).getVideoTracks()[0];
}

export function mixAudio(sources: MediaStream[], cleanup: Cleanup): MediaStreamTrack {
	const ac = new AudioContext();
	const out = ac.createMediaStreamDestination();
	log('mixing', sources.length, 'audio sources');
	for (const s of sources) ac.createMediaStreamSource(s).connect(out);
	cleanup.push(() => ac.close());
	return out.stream.getAudioTracks()[0];
}

export type Sources = { screen: MediaStream; camera: MediaStream; mic: MediaStream; system: MediaStream };

// `stream` is the composited output, exposed so the page can preview what is being recorded.
export function startRecording({ screen, camera, mic, system }: Sources): { stream: MediaStream; stop(): Promise<Blob> } {
	const cleanup: Cleanup = [];
	const stream = new MediaStream([composite(screen, camera, cleanup), mixAudio([mic, system], cleanup)]);
	const chunks: Blob[] = [];
	const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
	recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
	recorder.onerror = (e) => console.error('[media] MediaRecorder error', e);
	recorder.start(1000);
	log('recording started');

	function stop(): Promise<Blob> {
		log('stop', { state: recorder.state, chunks: chunks.length });
		if (recorder.state === 'inactive') throw new Error('stop called on an inactive recording');
		const done = new Promise<Blob>((resolve) => {
			recorder.onstop = () => {
				const blob = new Blob(chunks, { type: 'video/webm' });
				log('stopped', chunks.length, 'chunks,', blob.size, 'bytes');
				resolve(blob);
			};
		});
		recorder.stop();
		cleanup.forEach((fn) => fn());
		return done;
	}

	return { stream, stop };
}

export async function uploadRecording(blob: Blob, title: string, duration: number): Promise<string> {
	log('uploading', blob.size, 'bytes', { title, duration });
	const query = new URLSearchParams({ title, duration: String(duration) });
	const res = await fetch(`/api/recordings?${query}`, { method: 'POST', body: blob });
	if (!res.ok) {
		const message = `Save failed: ${res.status} ${await res.text()}`;
		console.error('[media]', message);
		throw new Error(message);
	}
	const { name } = (await res.json()) as { name: string };
	log('saved', name);
	return name;
}
