import { error, json } from '@sveltejs/kit';
import { transcribe } from '#lib/server/stt.js';
import type { RequestHandler } from './$types';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[api/interview/transcribe]', ...args);

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.arrayBuffer();
	if (!body.byteLength) error(400, 'empty audio body');
	const t0 = Date.now();
	try {
		const text = await transcribe(body);
		log('done', { bytes: body.byteLength, ms: Date.now() - t0, chars: text.length });
		return json({ text });
	} catch (e) {
		log('failed', { bytes: body.byteLength, ms: Date.now() - t0, error: String(e) });
		error(502, `transcribe failed: ${e instanceof Error ? e.message : e}`);
	}
};
