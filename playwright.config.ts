import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	use: { baseURL: 'http://localhost:5199' },
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
			}
		}
	],
	webServer: { command: 'npx vite dev --port 5199 --strictPort', port: 5199 }
});
