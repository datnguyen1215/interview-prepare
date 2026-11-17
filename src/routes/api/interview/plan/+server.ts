import { error, json } from '@sveltejs/kit';
import { preparePlan } from '#lib/server/interviewer.js';
import type { RequestHandler } from './$types';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[api/interview/plan]', ...args);

export const POST: RequestHandler = async ({ request }) => {
	const { jobPost }: { jobPost?: unknown } = await request.json();
	if (typeof jobPost !== 'string' || !jobPost.trim()) error(400, 'jobPost must be a non-empty string');
	const t0 = Date.now();
	try {
		const plan = await preparePlan(jobPost);
		log('done', { ms: Date.now() - t0, questions: plan.questions.length });
		return json(plan);
	} catch (e) {
		log('failed', { ms: Date.now() - t0, error: String(e) });
		error(502, `plan failed: ${e instanceof Error ? e.message : e}`);
	}
};
