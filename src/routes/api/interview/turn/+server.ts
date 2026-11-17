import { error, json } from '@sveltejs/kit';
import { nextTurn, type Entry, type Plan, type TurnKind } from '#lib/server/interviewer.js';
import * as kokoro from '#lib/server/kokoro.js';
import type { RequestHandler } from './$types';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[api/interview/turn]', ...args);

const WHO = ['interviewer', 'you', 'hint'];
const isEntry = (e: unknown): e is Entry => {
	const { who, text } = (e ?? {}) as Record<string, unknown>;
	return typeof who === 'string' && WHO.includes(who) && typeof text === 'string';
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const POST: RequestHandler = async ({ request }) => {
	const { plan, history, kind }: { plan?: Plan; history?: unknown; kind?: unknown } = await request.json();
	if (!plan || !Array.isArray(plan.questions) || !plan.questions.length) error(400, 'plan with questions is required');
	if (!Array.isArray(history) || !history.every(isEntry)) error(400, 'history must be an array of { who, text }');
	if (kind !== 'next' && kind !== 'hint') error(400, `kind must be 'next' or 'hint', got ${JSON.stringify(kind)}`);
	return json({ text: await turn(plan, history, kind) });
};

async function turn(plan: Plan, history: Entry[], kind: TurnKind): Promise<string> {
	let t0 = Date.now();
	let text: string;
	try {
		text = await nextTurn(plan, history, kind);
	} catch (e) {
		log('turn failed', { kind, ms: Date.now() - t0, error: String(e) });
		error(502, `turn failed: ${message(e)}`);
	}
	log('turn done', { kind, ms: Date.now() - t0 });
	if (kind === 'hint') return text;
	t0 = Date.now();
	try {
		await kokoro.stop();
		await kokoro.say(text);
	} catch (e) {
		log('speech failed', { ms: Date.now() - t0, error: String(e) });
		error(502, `speech failed: ${message(e)}`);
	}
	log('speech queued', { ms: Date.now() - t0 });
	return text;
}
