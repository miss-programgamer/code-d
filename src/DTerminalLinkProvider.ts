import { stat } from 'fs/promises';
import { join, delimiter, resolve } from 'path';
import { CancellationToken, Disposable, Position, TerminalLink, TerminalLinkContext, TerminalLinkProvider, Uri, window, workspace } from 'vscode';

import { isDigit, openTextDocument } from './utils/index.js';
import { getDubPackagesHome } from './dub/home.js';


export type TerminalFileLink = TerminalLink & {
	file: { path: Uri, line?: number, column?: number; };
};

export default class DTerminalLinkProvider implements TerminalLinkProvider {
	async provideTerminalLinks({ line }: TerminalLinkContext, _token?: CancellationToken): Promise<TerminalFileLink[]> {
		// context.terminal.creationOptions.cwd is useless here, possibly
		// pointing to entirely different paths because vscode reuses terminals
		// (or sessions) across different workspaces, keeping old defaults.
		const firstWorkspaceFolder = workspace.workspaceFolders != null ? workspace.workspaceFolders[0] : undefined;
		return await findDErrorLines(line, firstWorkspaceFolder?.uri.fsPath ?? process.cwd());
	}

	handleTerminalLink(link: TerminalFileLink) {
		let range: null | number | Position = null;

		if (link.file.line != null && link.file.column != null) {
			range = new Position(link.file.line - 1, link.file.column - 1);
		} else if (link.file.line != null) {
			range = link.file.line - 1;
		}

		openTextDocument(link.file.path, range);
	}

	static register(): Disposable {
		const provider = new DTerminalLinkProvider();
		return window.registerTerminalLinkProvider(provider);
	}
}

export async function findDErrorLines(line: string, cwd: string): Promise<TerminalFileLink[]> {
	const result: Promise<TerminalFileLink | null>[] = [];

	// for (let i = 0; ; ++i) {
	// 	const idx = line.indexOf('(', i);

	// 	if (idx !== -1) {
	// 		i = idx;
	// 	} else {
	// 		break;
	// 	}

	// 	const nextChar = line[i + 1];
	// }

	let i = 0;
	while (true) {
		i = line.indexOf('(', i);

		if (i === -1) {
			break;
		}

		let firstLineDigit = line[i + 1];

		if (isDigit(firstLineDigit) && (
			line.endsWith('.d', i)
			|| line.endsWith('.di', i)
			|| line.endsWith('.dt', i) // diet templates
			|| endsWithMixin(line, i)
		)) {
			result.push(extractFileLinkAt(cwd, line, i));
		}

		i++;
	}

	return (await Promise.all(result)).filter(value => value != null);
}

function endsWithMixin(line: string, endIndex: number): boolean {
	// format = "file.d-mixin-5(5, 8)"
	if (endIndex === 0 || !isDigit(line[endIndex - 1])) {
		return false;
	}

	endIndex--;
	while (endIndex > 0 && isDigit(line[endIndex - 1])) {
		endIndex--;
	}

	return line.endsWith('-mixin-', endIndex);
}

const invalidFilePathParts = new Set([
	' ', '(', ')', '[', ']', ':', '@', '`', '"', '\'', ',', '!', '?',
]);

function isValidFilePathPart(c: string) {
	return !invalidFilePathParts.has(c);
}

async function extractFileLinkAt(cwd: string, line: string, idx: number): Promise<TerminalFileLink | null> {
	let endOffset = 0;
	let gotDriveLetter = false;
	let prefixDone = false;

	function isValidPrefix(c: string) {
		if (prefixDone) {
			return false;
		}

		if (process.platform === 'win32' && c === ':' && !gotDriveLetter) {
			gotDriveLetter = true;
			return true;
		}

		if (gotDriveLetter) {
			if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z') {
				prefixDone = true;
				return true;
			} else {
				idx++;
				return false;
			}
		}

		return isValidFilePathPart(c) || c === ':';
	}

	let lineNo: number | undefined = undefined;
	let column: number | undefined = undefined;

	while (idx > 0 && isValidPrefix(line[idx - 1])) {
		idx--;
	}

	let file = line.substring(idx);

	let end = 0;
	while (isValidFilePathPart(file[end])) {
		end++;
	}

	if (end === 0 || file[end - 1] === '.') {
		return null;
	}

	const lineNoMatcher = /^[(:](\d+)(?:[,:](\d+))?/;
	const lineNoMatch = file.substring(end).match(lineNoMatcher);

	if (lineNoMatch) {
		lineNo = parseInt(lineNoMatch[1]);
		if (lineNoMatch[2]) {
			column = parseInt(lineNoMatch[2]);
		}
		endOffset += lineNoMatch[0].length;
		if (lineNoMatch[0][0] === '(') {
			endOffset++;
		}
	}

	if (endsWithMixin(file, end)) {
		const newEnd = file.lastIndexOf('-mixin-', end);

		if (newEnd === -1) {
			throw new Error('this should not happen');
		}

		lineNo = parseInt(file.substring(newEnd + 7, end));
		column = undefined;
		endOffset += (end - newEnd);
		end = newEnd;
	}

	const filePath = await resolveFilePath(file.substring(0, end), cwd);

	if (filePath != null) {
		return {
			startIndex: idx,
			length: end + endOffset,
			file: {
				path: filePath,
				line: lineNo,
				column: column
			}
		};
	} else {
		return null;
	}
}

let resolveAllFilePathsForTest: boolean = false;
export function enableResolveAllFilePathsForTest() {
	return resolveAllFilePathsForTest = true;
}

const dubFileSearch = join('dub', 'packages') + delimiter;

async function resolveFilePath(path: string, cwd: string): Promise<Uri | null> {
	path = resolve(cwd, path);

	const stats = await stat(path);
	if (stats.isFile()) {
		return Uri.file(path);
	}

	const dubPathStart = path.indexOf(dubFileSearch);

	if (dubPathStart !== -1) {
		const sufix = path.substring(dubPathStart + dubFileSearch.length);
		path = join(getDubPackagesHome(), sufix);
		const stats = await stat(path);

		return stats.isFile() || resolveAllFilePathsForTest
			? Uri.file(path)
			: null;
	} else {
		return resolveAllFilePathsForTest
			? Uri.file(path)
			: null;
	}
}
