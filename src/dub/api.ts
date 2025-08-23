import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { CompletionItem, CompletionItemKind, QuickPickItem, SnippetString } from 'vscode';
import { AxiosError } from 'axios';

import { reqJson } from '../utils/index.js';


export async function searchDubPackages(query: string): Promise<any[]> {
	try {
		const body = await dubAPI().get(`/api/packages/search?q=${encodeURIComponent(query)}`);
		return body.data;
	} catch (e) {
		if (e instanceof AxiosError && e.response != null) {
			throw new Error('No packages found');
		} else {
			throw e;
		}
	}
}

export async function listPackages(): Promise<any[]> {
	try {
		const body = await dubAPI().get('/packages/index.json');
		return body.data;
	} catch (e) {
		if (e instanceof AxiosError && e.response != null) {
			throw new Error('No packages found');
		} else {
			throw e;
		}
	}
}

var packageCache: any;
var packageCacheDate = new Date(0);

export async function listPackageOptions(): Promise<QuickPickItem[]> {
	if (new Date().getTime() - packageCacheDate.getTime() < 15 * 60 * 1000) {
		return Promise.resolve(packageCache);
	}

	try {
		const body = await dubAPI().get<{ name: string; description: string; version: string; }[]>('/api/packages/search');
		var ret: QuickPickItem[] = [];
		body.data.forEach(element => {
			ret.push({
				label: element.name,
				description: element.version,
				detail: element.description
			});
		});
		packageCache = ret;
		packageCacheDate = new Date();
		return ret;
	} catch (e) {
		if (e instanceof AxiosError && e.response != null) {
			throw new Error('No packages found');
		} else {
			throw e;
		}
	}
}

export async function getPackageInfo(pkg: string): Promise<any> {
	try {
		const body = await dubAPI().get(`/api/packages/${encodeURIComponent(pkg)}/info`);
		return body.data;
	} catch (e) {
		if (e instanceof AxiosError && e.response != null) {
			throw new Error('No packages found');
		} else {
			throw e;
		}
	}
}

export async function getLatestPackageInfo(pkg: string): Promise<{ description?: string; version?: string; subPackages?: string[], readme?: string, readmeMarkdown?: boolean, license?: string, copyright?: string; }> {
	const body = await dubAPI().get<any>(`/api/packages/${encodeURIComponent(pkg)}/latest/info`);

	var json = body.data;
	var subPackages: string[] = [];

	if (json.info.subPackages) {
		json.info.subPackages.forEach((pkg_1: any) => {
			subPackages.push(pkg_1.name);
		});
	}

	return {
		version: json.version,
		description: json.info.description,
		license: json.info.license,
		copyright: json.info.copyright,
		subPackages: subPackages,
		readme: json.readme,
		readmeMarkdown: json.readmeMarkdown
	};
}

export async function autoCompletePath(fileName: string, key: string, currentValue: string, addResult: (v: CompletionItem) => any): Promise<any> {
	let folderOnly = ['path', 'targetPath', 'sourcePaths', 'stringImportPaths', 'importPaths'].indexOf(key) != -1;
	let fileRegex = ['copyFiles'].indexOf(key) != -1 ? null : /\.di?$/i;

	if (currentValue !== '') {
		let end = currentValue.lastIndexOf('/');
		if (end != -1) {
			currentValue = currentValue.substr(0, end);
		}
	}

	let dir = join(dirname(fileName), currentValue);
	const files = await readdir(dir, { withFileTypes: true });

	for (const file of files) {
		if (file.name[0] == '.') {
			return;
		}

		if (folderOnly && !file.isDirectory()) {
			return;
		}

		if (!file.isDirectory() && fileRegex && !fileRegex.exec(file.name)) {
			return;
		}

		let kind: CompletionItemKind = CompletionItemKind.Text;

		if (file.isSymbolicLink()) {
			kind = CompletionItemKind.Reference;
		} else if (file.isDirectory()) {
			kind = CompletionItemKind.Folder;
		} else if (file.isFile()) {
			kind = CompletionItemKind.File;
		}

		let value = join(currentValue, file.name).replace(/\\/g, '/');
		if (file.isDirectory() && !folderOnly) {
			value += '/';
		}
		value = JSON.stringify(value);

		const item = new CompletionItem(value, kind);
		if (file.isDirectory()) {
			item.insertText = new SnippetString(`${value.slice(0, -1)}\${0}\"`);
		}
		addResult(item);
	}
}

function dubAPI() {
	return reqJson('https://code.dlang.org/');
}
