import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { error } from '@sveltejs/kit';

export const DIR = path.resolve('recordings');
const NAME_RE = /^[\w-]+\.webm$/;

fs.mkdirSync(DIR, { recursive: true });

export type Recording = { name: string; title: string; duration: number | null; size: number; created: number; transcript: boolean };

// Names look like <iso-timestamp>_<title>[_<seconds>s].webm
const PARTS_RE = /^[\dTZ-]+?Z_(.+?)(?:_(\d+)s)?\.webm$/;

function parseName(name: string): Pick<Recording, 'title' | 'duration'> {
	const m = name.match(PARTS_RE);
	if (!m) return { title: name, duration: null };
	return { title: m[1].replace(/_/g, ' '), duration: m[2] ? Number(m[2]) : null };
}

const sidecarOf = (file: string) => file.replace(/\.webm$/, '.txt');

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[recordings]', ...args);

export function listRecordings(): Recording[] {
	const items = fs
		.readdirSync(DIR)
		.filter((f) => NAME_RE.test(f))
		.map((name) => {
			const stat = fs.statSync(path.join(DIR, name));
			const transcript = fs.existsSync(sidecarOf(path.join(DIR, name)));
			return { name, ...parseName(name), size: stat.size, created: stat.mtimeMs, transcript };
		})
		.sort((a, b) => b.created - a.created);
	log('list', items.length, 'recordings');
	return items;
}

export function recordingPath(name: string): string {
	const file = path.join(DIR, name);
	if (!NAME_RE.test(name) || !fs.existsSync(file)) error(404, `recording not found: ${name}`);
	return file;
}

export async function saveRecording(
	body: ReadableStream<Uint8Array>,
	title: string | null,
	duration: number | null
): Promise<string> {
	const safe = (title || 'recording').replace(/[^\w-]+/g, '_').slice(0, 60);
	const suffix = duration ? `_${Math.round(duration)}s` : '';
	const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${safe}${suffix}.webm`;
	const file = path.join(DIR, name);
	log('save start', name);
	await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(file));
	log('save done', name, fs.statSync(file).size, 'bytes');
	return name;
}

export function deleteRecording(name: string): void {
	const file = recordingPath(name);
	fs.unlinkSync(file);
	fs.rmSync(sidecarOf(file), { force: true });
	log('deleted', name, 'and its transcript if any');
}

export function saveTranscript(name: string, text: string): void {
	const file = sidecarOf(recordingPath(name));
	fs.writeFileSync(file, text);
	log('transcript saved', path.basename(file), text.length, 'chars');
}

export function transcriptPath(name: string): string {
	const file = sidecarOf(recordingPath(name));
	if (!fs.existsSync(file)) error(404, `transcript not found: ${name}`);
	return file;
}
