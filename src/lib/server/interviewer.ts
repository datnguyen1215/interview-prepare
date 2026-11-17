import { chat, type Message } from './deepseek.js';

export type Plan = { role: string; level: string; stack: string[]; questions: string[] };
export type Entry = { who: 'interviewer' | 'you' | 'hint'; text: string };
export type TurnKind = 'next' | 'hint';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[interviewer]', ...args);

const PLAN_PROMPT = `You prepare a mock job interview. Read the job post and reply with a JSON object:
{"role": string, "level": string, "stack": string[], "questions": string[]}
"questions" holds 6 to 10 interview questions in the order they should be asked, fitted to the level and stack.`;

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '');

export async function preparePlan(jobPost: string): Promise<Plan> {
	log('preparePlan start', { chars: jobPost.length });
	const reply = await chat(
		[
			{ role: 'system', content: PLAN_PROMPT },
			{ role: 'user', content: jobPost }
		],
		{ json: true, maxTokens: 1500 }
	);
	let parsed: Partial<Record<keyof Plan, unknown>>;
	try {
		parsed = JSON.parse(reply);
	} catch {
		throw new Error(`plan reply is not JSON: ${reply.slice(0, 200)}`);
	}
	const { role, level, stack, questions } = parsed;
	if (typeof role !== 'string' || typeof level !== 'string' || !isStrings(stack) || !isStrings(questions) || !questions.length)
		throw new Error(`plan reply is missing role, level, stack or questions: ${reply.slice(0, 200)}`);
	log('preparePlan done', { role, level, stack: stack.length, questions: questions.length });
	return { role, level, stack, questions };
}

function systemPrompt(plan: Plan): string {
	return `You are a job interviewer for a ${plan.level} ${plan.role} position (stack: ${plan.stack.join(', ')}).
Your question plan, in order:
${plan.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Ask one thing at a time. If the candidate's answer is vague or partial, ask a follow-up; otherwise move to the next planned question.
Your replies are spoken aloud: 1 to 2 sentences, plain text, no markdown.
Never grade, score, rate or give feedback on the quality of an answer.`;
}

const HINT_PROMPT =
	'Give the candidate one short nudge for the current question. Do not give the answer. One sentence, plain text.';
const GREET_PROMPT = 'Greet the candidate briefly and ask question 1.';

const toMessage = (e: Entry): Message =>
	e.who === 'you'
		? { role: 'user', content: e.text }
		: { role: 'assistant', content: e.who === 'hint' ? `(hint) ${e.text}` : e.text };

export async function nextTurn(plan: Plan, history: Entry[], kind: TurnKind): Promise<string> {
	log('nextTurn start', { kind, history: history.length });
	const messages: Message[] = [{ role: 'system', content: systemPrompt(plan) }, ...history.map(toMessage)];
	if (kind === 'hint') messages.push({ role: 'system', content: HINT_PROMPT });
	else if (!history.length) messages.push({ role: 'user', content: GREET_PROMPT });
	const text = (await chat(messages, { maxTokens: 200 })).trim();
	if (!text) throw new Error(`DeepSeek returned an empty ${kind} turn`);
	log('nextTurn done', { kind, chars: text.length });
	return text;
}
