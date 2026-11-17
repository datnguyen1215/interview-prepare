import type { MicVAD } from '@ricky0123/vad-web';

// Long enough to pause and think mid-answer without being cut off.
export const END_SILENCE_MS = 1500;
export const MIN_SPEECH_MS = 300;
// Copied from node_modules by `npm run vad-assets`.
const ASSETS = '/vad/';

export type VoiceHandlers = {
	onStart: () => void;
	onRealStart: () => void;
	onMisfire: () => void;
	onEnd: (wav: Blob) => void;
};
export type Voice = Pick<MicVAD, 'start' | 'pause' | 'destroy'>;

const log = (...args: unknown[]) => console.log('[vad]', ...args);

// Imported lazily: onnxruntime-web must not load during SSR.
export async function listen(mic: MediaStream, h: VoiceHandlers): Promise<Voice> {
	const t0 = performance.now();
	log('loading', { assets: ASSETS, endSilenceMs: END_SILENCE_MS, minSpeechMs: MIN_SPEECH_MS });
	const { MicVAD, utils } = await import('@ricky0123/vad-web');
	const vad = await MicVAD.new({
		model: 'v5',
		baseAssetPath: ASSETS,
		onnxWASMBasePath: ASSETS,
		// The default pause stops the tracks; this mic is shared with the recording.
		getStream: async () => mic,
		pauseStream: async () => {},
		resumeStream: async () => mic,
		redemptionMs: END_SILENCE_MS,
		minSpeechMs: MIN_SPEECH_MS,
		onSpeechStart: h.onStart,
		onSpeechRealStart: h.onRealStart,
		onVADMisfire: h.onMisfire,
		onSpeechEnd: (audio) => {
			log('speech end', { samples: audio.length, ms: Math.round(audio.length / 16) });
			h.onEnd(new Blob([utils.encodeWAV(audio)], { type: 'audio/wav' }));
		}
	});
	log('ready', { ms: Math.round(performance.now() - t0) });
	return vad;
}
