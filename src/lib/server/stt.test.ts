import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribe } from './stt.js';

afterEach(() => vi.unstubAllGlobals());

describe('transcribe', () => {
	it('posts the audio and returns the text', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'hello world', ms: 300 })));
		vi.stubGlobal('fetch', fetch);
		const body = new Uint8Array([1, 2, 3]).buffer;
		expect(await transcribe(body)).toBe('hello world');
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('http://127.0.0.1:8790/transcribe');
		expect(init).toMatchObject({ method: 'POST', body, headers: { 'content-type': 'audio/webm' } });
	});

	it('throws the start hint when the server refuses the connection', async () => {
		const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause: refused })));
		await expect(transcribe(new ArrayBuffer(1))).rejects.toThrow(
			'STT server not reachable at 127.0.0.1:8790; start it with stt/run.sh'
		);
	});

	it('throws with status and body on a server error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"bad audio"}', { status: 500 })));
		await expect(transcribe(new ArrayBuffer(1))).rejects.toThrow('STT 500: {"error":"bad audio"}');
	});
});
