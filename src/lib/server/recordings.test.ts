import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recordings-test-'));
let rec: typeof import('./recordings.js');

// The module resolves recordings/ from cwd at import, so chdir first to keep the real dir untouched.
beforeAll(async () => {
	process.chdir(tmp);
	rec = await import('./recordings.js');
});

afterAll(() => {
	process.chdir(cwd);
	fs.rmSync(tmp, { recursive: true, force: true });
});

async function makeRecording(title: string): Promise<string> {
	return rec.saveRecording(new Blob(['video']).stream(), title, 5);
}

describe('transcript sidecars', () => {
	it('uses a temp recordings dir', () => {
		expect(rec.DIR).toBe(path.join(fs.realpathSync(tmp), 'recordings'));
	});

	it('saves the text unchanged next to the recording', async () => {
		const name = await makeRecording('save');
		const text = '[0:03] Interviewer: Hi.\n[0:10] You: Hello, I am here.\n';
		rec.saveTranscript(name, text);
		const file = path.join(rec.DIR, name.replace(/\.webm$/, '.txt'));
		expect(fs.readFileSync(file, 'utf8')).toBe(text);
		expect(rec.transcriptPath(name)).toBe(file);
	});

	it('lists whether each recording has a transcript', async () => {
		const withText = await makeRecording('with');
		const without = await makeRecording('without');
		rec.saveTranscript(withText, '[0:01] You: x');
		const byName = new Map(rec.listRecordings().map((r) => [r.name, r.transcript]));
		expect(byName.get(withText)).toBe(true);
		expect(byName.get(without)).toBe(false);
	});

	it('deletes the sidecar with the recording', async () => {
		const name = await makeRecording('delete');
		rec.saveTranscript(name, '[0:01] You: x');
		rec.deleteRecording(name);
		expect(fs.readdirSync(rec.DIR).filter((f) => f.startsWith(name.replace(/\.webm$/, '')))).toEqual([]);
	});

	it('rejects bad names', () => {
		expect(() => rec.saveTranscript('../escape.webm', 'x')).toThrow();
		expect(() => rec.saveTranscript('missing.webm', 'x')).toThrow();
		expect(() => rec.transcriptPath('../escape.webm')).toThrow();
	});
});
