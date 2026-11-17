import fs from 'node:fs';
import { transcriptPath } from '#lib/server/recordings.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) =>
	new Response(fs.readFileSync(transcriptPath(params.name)), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
