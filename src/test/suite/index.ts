import { resolve } from 'node:path';

import Mocha from 'mocha';
import { glob } from 'glob';


const testsRoot = resolve(__dirname, '..');

export async function run(timeout = 120_000): Promise<void> {
	// Create Mocha instance
	const mocha = new Mocha({ ui: 'tdd', timeout });

	// Find all test files
	const files = await glob('**/**.test.ts', { cwd: testsRoot });

	// Add files to the test suite
	for (const file of files) {
		mocha.addFile(resolve(testsRoot, file));
	}

	// Run our test suite
	return new Promise<void>((resolve, reject) => {
		mocha.run((failures) => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`));
			} else {
				resolve();
			}
		});
	});
}
