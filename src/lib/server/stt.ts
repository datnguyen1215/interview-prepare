const URL = 'http://127.0.0.1:8790/transcribe';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[stt]', ...args);

export async function transcribe(body: ArrayBuffer): Promise<string> {
	log('transcribe start', { bytes: body.byteLength });
	const t0 = Date.now();
	let res: Response;
	try {
		res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body });
	} catch (e) {
		const code = e instanceof Error && (e.cause as NodeJS.ErrnoException | undefined)?.code;
		log('transcribe request error', { bytes: body.byteLength, ms: Date.now() - t0, code, error: String(e) });
		if (code === 'ECONNREFUSED') throw new Error('STT server not reachable at 127.0.0.1:8790; start it with stt/run.sh');
		throw new Error(`STT request to ${URL} failed: ${e}`);
	}
	if (!res.ok) {
		const text = await res.text();
		log('transcribe failed', { status: res.status, ms: Date.now() - t0, body: text.slice(0, 200) });
		throw new Error(`STT ${res.status}: ${text}`);
	}
	const data: { text?: unknown; ms?: unknown } = await res.json();
	if (typeof data.text !== 'string') throw new Error(`STT reply has no text: ${JSON.stringify(data).slice(0, 200)}`);
	log('transcribe done', { ms: Date.now() - t0, whisperMs: data.ms, chars: data.text.length });
	return data.text;
}
