import { join } from 'node:path';


export function getDubHome(): string | undefined {
	const env = process.env;

	const dubHome = env['DUB_HOME'];

	if (dubHome != null) {
		return dubHome;
	} else {
		const dpath = env['DPATH'];
		if (dpath != null) {
			return join(dpath, 'dub');
		}
	}
}

export function getDubPackagesHome(): string {
	const dubHome = getDubHome();
	if (dubHome != null) {
		return join(dubHome, 'packages');
	}

	const cwd = process.cwd();
	const env = process.env;

	switch (process.platform) {
		case 'win32':
			return join(env['LOCALAPPDATA'] ?? env['APPDATA'] ?? cwd, 'dub', 'packages');
		default:
			return join(env['HOME'] ?? cwd, '.dub', 'packages');
	}
}
