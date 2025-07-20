import { fail, ok, strictEqual } from 'node:assert';
import { commands, CompletionItem, CompletionList, Position, Selection, TextEditor, window } from 'vscode';


export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function testCompletion(
	editor: TextEditor,
	position: Position,
	expectedCompletionList: CompletionList,
	type: "exact" | "contains",
	testKeys: (keyof CompletionItem)[] = ["label", "kind"]
) {
	editor = await window.showTextDocument(editor.document, editor.viewColumn);
	await sleep(500);
	editor.selection = new Selection(position, position);
	await sleep(500);

	// Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
	const actualCompletionList = (await commands.executeCommand(
		'vscode.executeCompletionItemProvider',
		editor.document.uri,
		position
	)) as CompletionList;

	if (type === "exact") {
		strictEqual(actualCompletionList.items.length, expectedCompletionList.items.length);
		expectedCompletionList.items.forEach((expectedItem, i) => {
			const actualItem = actualCompletionList.items[i];
			testKeys.forEach(key => {
				strictEqual(actualItem[key], expectedItem[key],
					"completion "
					+ JSON.stringify(expectedItem.label)
					+ " mismatch on key " + JSON.stringify(key) + ":\n"
					+ "expected = " + JSON.stringify(expectedItem[key]) + "\n"
					+ "  actual = " + JSON.stringify(actualItem[key]));
			});
		});
	} else if (type === "contains") {
		ok(actualCompletionList.items.length >= expectedCompletionList.items.length,
			"Expected at least " + expectedCompletionList.items.length
			+ " completions, but only got " + actualCompletionList.items.length);

		expectedCompletionList.items.forEach((expectedItem, i) => {
			const actualItem = actualCompletionList.items.find(i => i.label == expectedItem.label);
			if (!actualItem)
				fail("can't find completion item "
					+ JSON.stringify(expectedItem.label)
					+ " in "
					+ JSON.stringify(actualCompletionList.items.map(c => c.label)));

			testKeys.forEach(key => {
				strictEqual(actualItem[key], expectedItem[key],
					"completion "
					+ JSON.stringify(expectedItem.label)
					+ " mismatch on key " + JSON.stringify(key) + ":\n"
					+ "expected = " + JSON.stringify(expectedItem[key]) + "\n"
					+ "  actual = " + JSON.stringify(actualItem[key]));
			});
		});
	} else {
		throw new Error("invalid type");
	}
}
