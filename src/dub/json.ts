import { CompletionItem, CompletionItemKind, DocumentSelector, MarkdownString, SnippetString } from 'vscode';
import { Location } from 'jsonc-parser';

import { listPackages, getPackageInfo, getLatestPackageInfo, autoCompletePath } from './api.js';
import { IJSONContribution, ISuggestionsCollector } from '../json-contributions.js';
import { cmpSemver } from '../utils/index.js';
import extension from '../extension.js';


interface PropertyCompletionItem extends CompletionItem {
	defaultValue?: string;
	isDependency?: boolean;
}

export class DubJSONContribution implements IJSONContribution {
	public getDocumentSelector(): DocumentSelector {
		return [{ language: 'json', pattern: '**/dub.json', scheme: 'file' }];
	}

	public getInfoContribution(fileName: string, location: Location): Thenable<MarkdownString[]> {
		if (location.path.length < 2 || location.path[location.path.length - 2] !== 'dependencies') {
			return Promise.resolve([]);
		}

		let pack = location.path[location.path.length - 1];

		if (typeof pack === 'string') {
			return getLatestPackageInfo(pack).then(info => {
				let htmlContent: MarkdownString[] = [];
				htmlContent.push(new MarkdownString(`Package ${pack}`));
				if (info.description) {
					let block = new MarkdownString(info.description);
					block.isTrusted = false;
					htmlContent.push(block);
				}
				if (info.license || info.copyright) {
					let block = new MarkdownString();
					if (info.license)
						block.appendText(`License: ${info.license}\n`);
					if (info.copyright)
						block.appendText(`Copyright: ${info.copyright}\n`);
					block.isTrusted = false;
					htmlContent.push(block);
				}
				if (info.version) {
					htmlContent.push(new MarkdownString(`Latest version: ${info.version}`));
				}
				return htmlContent;
			});
		}

		return Promise.resolve([]);
	}

	public async collectPropertySuggestions(fileName: string, location: Location, currentWord: string, addValue: boolean, isLast: boolean, result: ISuggestionsCollector): Promise<void> {
		let items: PropertyCompletionItem[] | undefined;

		if (location.isAtPropertyKey) {
			currentWord = location.previousNode?.value || currentWord;
			// complete in { 'dependencies': {...} } - path === ['...root', 'dependencies', '']
			// but not in { 'dependencies': { 'vibe-d': {...} }} - path === ['...root', 'dependencies', 'vibe-d', '']
			try {
				if (location.path[location.path.length - 2] === 'dependencies') {
					items = await this.collectDependencyPropertySuggestions(currentWord);
				} else if (location.path[location.path.length - 2] === 'subConfigurations') {
					items = await this.collectSubConfigurationsPropertySuggestions();
				}
			} catch (err) {
				result.error((err ? (err as Error).message : null) ?? `${err}`);
				return;
			}
		}

		if (!items) {
			return;
		}

		for (const item of items) {
			let insertText = new SnippetString().appendText(JSON.stringify(item.label));

			if (addValue) {
				insertText.appendText(': "').appendPlaceholder(item.defaultValue ?? '').appendText('"');
				if (!isLast) {
					insertText.appendText(',');
				}
			}

			item.insertText = insertText;
			item.filterText = JSON.stringify(item.label);
			result.add(item);
		}
	}

	protected async collectSubConfigurationsPropertySuggestions(): Promise<PropertyCompletionItem[]> {
		const deps = await extension.served?.getDependencies() ?? [];
		return deps
			.filter(d => d.info !== undefined)
			.map(d => {
				let item = new CompletionItem(d.info!.name);
				item.filterText = item.insertText = JSON.stringify(d.info!.name); // add quotes
				item.kind = CompletionItemKind.Property;
				return item;
			});
	}

	protected async collectDependencyPropertySuggestions(currentWord: string): Promise<PropertyCompletionItem[]> {
		let colonIdx = currentWord.indexOf(':');
		let ret: CompletionItem[] = [];
		if (colonIdx !== -1) {
			const pkgName = currentWord.substring(0, colonIdx);
			const info = await getLatestPackageInfo(pkgName);
			try {
				info.subPackages?.forEach(subPkgName => {
					let completionName = `${pkgName}:${subPkgName}`;
					let item = <PropertyCompletionItem>new CompletionItem(completionName, CompletionItemKind.Property);
					item.documentation = info.description;
					item.defaultValue = info.version;
					item.isDependency = true;
					ret.push(item);
				});
			}
			catch (err) {
				throw new Error('Package not found');
			}
		} else {
			const json = await listPackages();
			try {
				json.forEach(element => {
					let item = <PropertyCompletionItem>new CompletionItem(element, CompletionItemKind.Property);
					item.isDependency = true;
					ret.push(item);
				});
			} catch (err) {
				console.log('Error searching for packages');
				console.log(err);
			}
		}
		return ret;
	}

	public collectValueSuggestions(fileName: string, location: Location, result: ISuggestionsCollector): Thenable<any> {
		const inArray = typeof location.path[location.path.length - 1] === 'number';
		let keyName: string;

		if (inArray) {
			keyName = <string>location.path[location.path.length - 2];
		} else {
			keyName = <string>location.path[location.path.length - 1];
		}

		if (typeof (keyName) !== 'string') {
			keyName = '';
		}

		if (['path', 'targetPath', 'sourcePaths', 'stringImportPaths', 'importPaths', 'copyFiles', 'sourceFiles', 'excludedSourceFiles', 'mainSourceFile'].indexOf(keyName) !== -1) {
			return this.collectPathValueSuggestions(fileName, location, result, keyName);
		} else if (!inArray && location.path[location.path.length - 2] === 'dependencies') {
			return this.collectDependencyValueSuggestions(keyName, fileName, location, result);
		} else if (!inArray && location.path[location.path.length - 3] === 'dependencies' && keyName === 'version') {
			return this.collectDependencyValueSuggestions(location.path[location.path.length - 2], fileName, location, result);
		} else {
			return Promise.resolve(null);
		}
	}

	protected collectPathValueSuggestions(fileName: string, location: Location, result: ISuggestionsCollector, key: string): Thenable<any> {
		return autoCompletePath(fileName, key, location.previousNode?.value ?? '', v => result.add(v));
	}

	protected collectDependencyValueSuggestions(currentKey: string | number, fileName: string, location: Location, result: ISuggestionsCollector): Thenable<any> {
		if (typeof currentKey === 'string') {
			return new Promise((resolve, reject) => {
				getPackageInfo(currentKey).then(json => {
					var versions = json.versions;
					if (!versions || !versions.length) {
						result.error('No versions found');
						return resolve(undefined);
					}
					var items: CompletionItem[] = [];
					for (var i = versions.length - 1; i >= 0; i--) {
						var item = new CompletionItem(versions[i].version);
						item.detail = `Released on ${new Date(versions[i].date).toLocaleDateString()}`;
						item.kind = CompletionItemKind.Class;
						item.insertText = new SnippetString(JSON.stringify(`\${0}${versions[i].version}`));
						item.filterText = JSON.stringify(versions[i].version);
						item.sortText = '0';
						items.push(item);
					}
					items.sort((a, b) => cmpSemver(
						typeof b.label === 'string' ? b.label : b.label.label,
						typeof a.label === 'string' ? a.label : a.label.label
					));
					for (let i = 0; i < items.length; i++) {
						items[i].sortText = (10000000 + i).toString(); // lazy 0 pad
						result.add(items[i]);
					}
					resolve(undefined);
				}, error => {
					result.error(error.toString());
					resolve(undefined);
				});
			});
		}
		return Promise.resolve(null);
	}

	public resolveSuggestion(item: CompletionItem): Thenable<CompletionItem> {
		if (item.kind === CompletionItemKind.Property && (<any>item).isDependency) {
			let pack = item.label;

			if (typeof pack !== 'string') {
				pack = pack.label;
			}

			return getLatestPackageInfo(pack).then(info => {
				if (info.description) {
					let doc = new MarkdownString();
					doc.isTrusted = false;
					doc.appendMarkdown(info.description);
					if (info.license || info.copyright) {
						doc.appendText('\n');

						if (info.license) {
							doc.appendText(`\nLicense: ${info.license}`);
						}

						if (info.copyright) {
							if (/copyright/i.exec(info.copyright)) {
								doc.appendText(`\n${info.copyright}`);
							} else {
								doc.appendText(`\nCopyright: ${info.copyright}`);
							}
						}
					}
					item.documentation = doc;
				}

				if (info.version) {
					item.detail = info.version;
					item.insertText = new SnippetString((item.insertText as SnippetString).value.replace(/\{\{\}\}/, `{{${info.version}}}`));
				}

				if (typeof item.label === 'string') {
					item.label = {
						label: item.label,
						detail: ` ${info.version}`
					};

					if (info.description) {
						item.label.description = info.description;
					}
				}

				return item;
			}, err => {
				return <any>undefined;
			});
		}

		return Promise.resolve(<any>undefined);
	}
}