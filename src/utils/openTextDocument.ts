import { window, workspace, Uri, Range, TextEditorRevealType, Position, TextEditor, Selection } from 'vscode';


/**
 * @param uri The text document to open and show to the user.
 * @param lineOrRange
 *     If null, only open the text document, don't scroll or select anything (default vscode behavior)
 *     If a number, this is the 0-based line number to focus and put the cursor on.
 *     If a range, this is a range to focus in the center of the editor and put the cursor at the start of.
 */
export default async function openTextDocument(uri: Uri, lineOrRange: null | number | Position | Range): Promise<TextEditor> {
	const doc = await workspace.openTextDocument(uri);
	const editor = await window.showTextDocument(doc);

	if (lineOrRange !== null) {
		if (typeof lineOrRange == 'number') {
			lineOrRange = doc.lineAt(lineOrRange).range;
		}

		if (lineOrRange instanceof Position) {
			lineOrRange = new Range(lineOrRange, lineOrRange);
		}

		editor.revealRange(lineOrRange, TextEditorRevealType.InCenterIfOutsideViewport);
		editor.selection = new Selection(lineOrRange.start, lineOrRange.start);
	}

	return editor;
}