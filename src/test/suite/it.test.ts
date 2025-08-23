import { notStrictEqual, strictEqual } from 'assert';
import { CompletionItem, CompletionItemKind, CompletionList, extensions, Position, Uri, ViewColumn, window, workspace } from 'vscode';

import { sleep, testCompletion } from '../utils.js';


suite('Integration Tests', () => {
	window.showInformationMessage('Start all tests.');

	// sanity test that we have the correct window open
	let workspaces = workspace.workspaceFolders;

	strictEqual(workspaces?.length, 1);
	strictEqual(
		workspaces[0].uri.fsPath.toLowerCase(),
		process.env['PROJECT_DIR']!.toLowerCase()
	);

	test('check dlang installed', async () => {
		let coded = extensions.getExtension('code-d')!;
		notStrictEqual(coded, undefined, 'code-d not installed?!');
	});

	test('Wait for python and dlang extensions', async () => {
		let coded = extensions.getExtension('code-d')!;
		await coded.activate();
		await sleep(5000); // give sufficient startup time
	});

	test('Recipe file', async () => {
		let recipe = await window.showTextDocument(
			await workspace.openTextDocument(file('dub.sdl')),
			ViewColumn.One
		);

		await recipe.edit((edit) => {
			edit.insert(new Position(2, 0), 'dep');
		});

		await testCompletion(
			recipe,
			new Position(2, 3),
			new CompletionList([
				new CompletionItem(
					'dependency',
					CompletionItemKind.Field
				),
			]),
			'contains'
		);
	});
});

function file(relative: string): Uri {
	return Uri.joinPath(workspace.workspaceFolders![0].uri, relative);
}