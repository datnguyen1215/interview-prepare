import { describe, expect, it } from 'vitest';
import { clock, formatTranscript } from './transcript.js';

describe('transcript', () => {
	it('formats seconds as m:ss like the call timer', () => {
		expect(clock(0)).toBe('0:00');
		expect(clock(65)).toBe('1:05');
		expect(clock(842)).toBe('14:02');
	});

	it('formats entries as [m:ss] Who: text lines in order', () => {
		const text = formatTranscript([
			{ who: 'interviewer', text: 'Tell me about a service you scaled.', at: 1 },
			{ who: 'you', text: 'We sharded Postgres.', at: 12 },
			{ who: 'hint', text: 'Think about write load.', at: 70 }
		]);
		expect(text).toBe(
			'[0:01] Interviewer: Tell me about a service you scaled.\n[0:12] You: We sharded Postgres.\n[1:10] Hint: Think about write load.'
		);
	});
});
