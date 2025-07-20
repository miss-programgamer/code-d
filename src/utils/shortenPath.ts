import { relative, dirname } from 'node:path';
import { workspace } from 'vscode';


export default function shortenPath(path: string) {
	if (path.endsWith('serve-d-dummy-workspace')) {
		return '[dummy workspace]';
	}

	let short: string = path;

	for (const { uri } of workspace.workspaceFolders ?? []) {
		if (uri.fsPath.startsWith(path)) {
			short = relative(dirname(uri.fsPath), path);
		}
	}

	return short;
}