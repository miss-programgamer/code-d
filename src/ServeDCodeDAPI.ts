import { Uri } from 'vscode';
import { CodedAPI, Snippet } from 'code-d-api';

import type ServeD from './ServeD.js';
import { DScannerIniSection } from './extension.js';

/** Implementation of the dlang API using serve-d. */
export default class ServeDCodeDAPI implements CodedAPI {
	protected served: ServeD;

	constructor(served: ServeD) {
		this.served = served;
	}

	// protected dependencySnippetsToRegister: [string[], Snippet][] = [];
	registerDependencyBasedSnippet(requiredDependencies: string[], snippet: Snippet): void {
		// this.dependencySnippetsToRegister.push([requiredDependencies, snippet]);

		this.served?.addDependencySnippet({
			requiredDependencies: requiredDependencies,
			snippet: snippet
		});
	}

	registerDependencyBasedSnippets(requiredDependencies: string[], snippets: Snippet[]): void {
		snippets.forEach(snippet => {
			this.registerDependencyBasedSnippet(requiredDependencies, snippet);
		});
	}

	refreshDependencies(): boolean {
		if (this.served) {
			this.served.refreshDependencies();
			return true;
		} else {
			return false;
		}
	}

	triggerDscanner(uri: string | Uri): boolean {
		if (this.served) {
			if (typeof uri === 'string') {
				uri = Uri.parse(uri);
			}

			this.served.triggerDscanner(uri);
			return true;
		} else {
			return false;
		}
	}

	async listDscannerConfig(uri: string | Uri): Promise<DScannerIniSection[]> {
		if (typeof uri === 'string') {
			uri = Uri.parse(uri);
		}

		return this.served.listDScannerConfig(uri);
	}

	async findFiles(query: string): Promise<string[]> {
		return this.served.findFiles(query);
	}

	async findFilesByModule(query: string): Promise<string[]> {
		return this.served.findFilesByModule(query);
	}

	async getActiveDubConfig(): Promise<{ packagePath: string, packageName: string, [unstableExtras: string]: any; }> {
		return this.served.getActiveDubConfig();
	}
}
