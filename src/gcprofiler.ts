import { window, Uri } from 'vscode';

import extension from './extension.js';
import { openTextDocument } from './utils/index.js';


export default class GCProfiler {
	profiles: any[] = [];

	static async listProfileCache() {
		const entries = await extension.served?.client.sendRequest<any[]>("served/getProfileGCEntries") ?? [];

		const items = entries.map(entry => ({
			description: entry.type,
			detail: `${entry.bytesAllocated} bytes allocated / ${entry.allocationCount} allocations`,
			label: `${entry.displayFile}:${entry.line}`,
			uri: entry.uri,
			line: entry.line
		}));

		const item = await window.showQuickPick(items);

		if (item != null) {
			openTextDocument(Uri.parse(item.uri), item.line - 1);
		}
	}
}
