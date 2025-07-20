import { EventEmitter as NodeEventEmitter } from 'node:events';
import { Event, EventEmitter, OutputChannel, tasks, TreeDataProvider, TreeItem, Uri } from 'vscode';
import { DScannerIniSection, Snippet } from 'code-d-api';

import { DubDependency, DubDependencyInfo } from './dub/view.js';
import { DubTaskProvider } from './dub/tasks.js';

import extension, { ActiveDubConfig } from './extension.js';
import DClient from './DClient.js';


export default class ServeD extends NodeEventEmitter implements TreeDataProvider<DubDependency> {
	public outputChannel: OutputChannel;
	public client: DClient;
	public tasksProvider: DubTaskProvider;

	constructor(outputChannel: OutputChannel) {
		super();

		this.outputChannel = outputChannel;
		this.client = new DClient(this);

		this.client.start().then(() => {
			extension.subs.push({
				dispose: () => this.client.stop(),
			});
		});

		this.tasksProvider = new DubTaskProvider(this.client);
		extension.subs.push(tasks.registerTaskProvider('dub', this.tasksProvider));
	}

	private _onDidChangeTreeData: EventEmitter<DubDependency | undefined> = new EventEmitter<DubDependency | undefined>();
	readonly onDidChangeTreeData: Event<DubDependency | undefined> = this._onDidChangeTreeData.event;

	refreshDependencies(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: DubDependency): TreeItem {
		return element;
	}

	getChildren(element?: DubDependency): Thenable<DubDependency[]> {
		return new Promise(resolve => {
			var req = (element && element.info) ? element.info.name : "";
			var items: DubDependency[] = [];
			if (element && element.info) {
				if (element.info.description)
					items.push(new DubDependency(element.info.description, undefined, "description"));
				if (element.info.homepage)
					items.push(new DubDependency(element.info.homepage, {
						command: "open",
						title: "Open",
						arguments: [Uri.parse(element.info.homepage)]
					}, "web"));
				if (element.info.authors && element.info.authors.join("").trim())
					items.push(new DubDependency("Authors: " + element.info.authors.join(), undefined, "authors"));
				if (element.info.license)
					items.push(new DubDependency("License: " + element.info.license, undefined, "license"));
				if (element.info.copyright)
					items.push(new DubDependency(element.info.copyright));
			}
			if (!element || req)
				this.client.sendRequest<DubDependencyInfo[]>("served/listDependencies", req).then((deps) => {
					deps.forEach(dep => items.push(new DubDependency(dep)));
					resolve(items);
				});
			else
				resolve(items);
		});
	}

	getDependencies(parent?: DubDependency): Thenable<DubDependency[]> {
		return this.getChildren(parent);
	}

	triggerDscanner(uri: Uri) {
		this.client.sendNotification("served/doDscanner", {
			textDocument: {
				uri: uri.toString()
			}
		});
	}

	listDScannerConfig(uri?: Uri): Thenable<DScannerIniSection[]> {
		return this.client.sendRequest("served/getDscannerConfig", uri ? {
			textDocument: {
				uri: uri.toString()
			}
		} : {});
	}

	findFiles(query: string): Thenable<string[]> {
		return this.client.sendRequest("served/searchFile", query);
	}

	findFilesByModule(query: string): Thenable<string[]> {
		return this.client.sendRequest("served/findFilesByModule", query);
	}

	addDependencySnippet(params: { requiredDependencies: string[], snippet: Snippet; }): Thenable<boolean> {
		return this.client.sendRequest("served/addDependencySnippet", params);
	}

	getActiveDubConfig(): Thenable<ActiveDubConfig> {
		return this.client.sendRequest("served/getActiveDubConfig");
	}

	forceLoadProjects(roots: string[]): Thenable<boolean[]> {
		return this.client.sendRequest("served/forceLoadProjects", roots);
	}
}