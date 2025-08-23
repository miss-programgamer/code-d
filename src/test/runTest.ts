import { join, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { } from 'node:child_process';

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { rimraf } from 'rimraf';


async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = resolve(__dirname, '../../');

		// The path to the extension test runner script
		// Passed to --extensionTestsPath
		const extensionTestsPath = resolve(__dirname, './suite/index');

		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		const [cliPath, ...args] =
			resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

		// for (const extensionId of packageJson.extensionDependencies) {
		//   cp.spawnSync(cliPath, [...args, '--install-extension', extensionId], {
		//     encoding: 'utf-8',
		//     stdio: 'inherit',
		//   });
		// }

		await rimraf('.vscode-test/user-data');

		let cwd = await mkdtemp(join(tmpdir(), 'coded_project'));
		await writeFile(join(cwd, 'dub.sdl'), 'name "codedproject"\n');
		await mkdir(join(cwd, 'source'));
		await writeFile(
			join(cwd, 'source', 'app.d'),
			'import std.stdio;\n\nvoid main() {\n\twriteln("hello world");\n}\n'
		);

		// Download VS Code, unzip it and run the integration test
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			launchArgs: [cwd],
			extensionTestsPath,
			extensionTestsEnv: {
				PROJECT_DIR: cwd,
			},
		});
	} catch (err) {
		console.error(err);
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
