import { error, json } from '@sveltejs/kit';
import { saveRecording } from '#lib/server/recordings.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	if (!request.body) error(400, 'empty recording upload');
	const duration = Number(url.searchParams.get('duration')) || null;
	const name = await saveRecording(request.body, url.searchParams.get('title'), duration);
	return json({ name }, { status: 201 });
};
