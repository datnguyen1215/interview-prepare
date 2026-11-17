import { error, json } from '@sveltejs/kit';
import * as kokoro from '#lib/server/kokoro.js';
import type { RequestHandler } from './$types';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[api/interview/speech]', ...args);

const fail = (step: string, t0: number, e: unknown): never => {
	log(`${step} failed`, { ms: Date.now() - t0, error: String(e) });
	error(502, `${step} failed: ${e instanceof Error ? e.message : e}`);
};

export const GET: RequestHandler = async () => {
	const t0 = Date.now();
	const s = await kokoro.status().catch((e) => fail('speech status', t0, e));
	log('status', { ms: Date.now() - t0, ...s });
	return json(s);
};

export const DELETE: RequestHandler = async () => {
	const t0 = Date.now();
	await kokoro.stop().catch((e) => fail('speech stop', t0, e));
	log('stopped', { ms: Date.now() - t0 });
	return new Response(null, { status: 204 });
};
