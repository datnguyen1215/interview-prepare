import { error } from '@sveltejs/kit';
import { saveTranscript } from '#lib/server/recordings.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const text = await request.text();
	if (!text) error(400, `empty transcript for ${params.name}`);
	saveTranscript(params.name, text);
	return new Response(null, { status: 201 });
};
