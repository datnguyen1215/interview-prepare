import type { Entry } from '#lib/server/interviewer.js';

export const INTERVIEWER = 'Daniel';

export type TimedEntry = Entry & { at: number };

const WHO = { interviewer: INTERVIEWER, you: 'You', hint: 'Hint' } as const;

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const whoLabel = (who: Entry['who']) => WHO[who];

export const formatTranscript = (entries: readonly TimedEntry[]) =>
	entries.map((e) => `[${clock(e.at)}] ${WHO[e.who]}: ${e.text}`).join('\n');
