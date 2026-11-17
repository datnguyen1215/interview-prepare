import { test as base } from '@playwright/test';

export type RecordedRequest = { method: string; url: string; body: Buffer | null };

function fakeMedia() {
	const devices = navigator.mediaDevices;
	const enumerate = devices.enumerateDevices.bind(devices);
	devices.enumerateDevices = async () => {
		const list = await enumerate();
		const mic = list.find((d) => d.kind === 'audioinput');
		if (!mic) return list;
		const system = { deviceId: mic.deviceId, groupId: mic.groupId, kind: mic.kind, label: 'System_Audio' };
		return [...list, { ...system, toJSON: () => system }];
	};
	devices.getDisplayMedia = async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 1280;
		canvas.height = 720;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('fake getDisplayMedia: no 2d context');
		ctx.fillStyle = '#336';
		ctx.fillRect(0, 0, 1280, 720);
		return canvas.captureStream(30);
	};
}

// Auto fixture: every test stubs the recordings API so the real recordings/ dir is never written.
export const test = base.extend<{ recordings: RecordedRequest[] }>({
	recordings: [
		async ({ page }, use) => {
			const requests: RecordedRequest[] = [];
			await page.addInitScript(fakeMedia);
			// Pathname match: globs like '**/api/recordings' miss the upload's ?title=&duration= query.
			const isRecordingsApi = (url: URL) => /^\/api\/recordings(\/|$)/.test(url.pathname);
			await page.route(isRecordingsApi, (route) => {
				const req = route.request();
				requests.push({ method: req.method(), url: req.url(), body: req.postDataBuffer() });
				return route.fulfill({ status: 201, json: { name: 'test.webm' } });
			});
			await use(requests);
		},
		{ auto: true }
	]
});

export { expect } from '@playwright/test';
