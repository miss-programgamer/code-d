import { join } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { Uri } from 'vscode';

import { getDubPackagesHome } from '../../dub/home.js';
import { findDErrorLines, enableResolveAllFilePathsForTest, TerminalFileLink } from '../../DTerminalLinkProvider.js';


suite("terminal links", () => {
	enableResolveAllFilePathsForTest();

	test("DUB path rewriting", async () => {
		deepStrictEqual(await findDErrorLines(
			"../../elsewhere/.dub/packages/msgpack-d-1.0.1/msgpack-d/src/msgpack/common.d(532,9): Deprecation: usage of the `body` keyword is deprecated. Use `do` instead.",
			"/tmp/myproject"
		), <TerminalFileLink[]>[
			{
				startIndex: 0,
				length: 83,
				file: {
					path: Uri.file(join(getDubPackagesHome(), "msgpack-d-1.0.1/msgpack-d/src/msgpack/common.d")),
					line: 532,
					column: 9
				}
			}
		]);
	});

	test("DMD error reporting", async () => {
		deepStrictEqual(await findDErrorLines(
			"source/app.d(5,15): Error: unable to read module `bm`",
			"/tmp/myproject"
		), <TerminalFileLink[]>[
			{
				startIndex: 0,
				length: 18,
				file: {
					path: Uri.file("/tmp/myproject/source/app.d"),
					line: 5,
					column: 15
				}
			}
		]);
	});

	test("D exceptions", async () => {
		deepStrictEqual(await findDErrorLines(
			"core.exception.AssertError@source/app.d(6): Assertion failure",
			"/tmp/myproject"
		), <TerminalFileLink[]>[
			{
				startIndex: 27,
				length: 15,
				file: {
					path: Uri.file("/tmp/myproject/source/app.d"),
					line: 6,
					column: undefined
				}
			}
		]);
	});

	test("mixin errors", async () => {
		deepStrictEqual(await findDErrorLines(
			"source/app.d-mixin-5(7,8): Error: unable to read module `foobar`",
			"/tmp/myproject"
		), <TerminalFileLink[]>[
			{
				startIndex: 0,
				length: 25,
				file: {
					path: Uri.file("/tmp/myproject/source/app.d"),
					line: 5,
					column: undefined
				}
			}
		]);
	});
});