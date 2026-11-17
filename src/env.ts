import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	// Optional at startup so the app runs without it; deepseek.ts fails loud per call.
	DEEPSEEK_API_KEY: { schema: (value) => value }
});
