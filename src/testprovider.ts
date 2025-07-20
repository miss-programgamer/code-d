import { basename } from 'node:path';
import { Disposable, Event, EventEmitter, Uri, workspace, WorkspaceFolder } from 'vscode';
import { TestLoadStartedEvent, TestLoadFinishedEvent, TestRunStartedEvent, TestRunFinishedEvent, TestSuiteEvent, TestEvent, TestAdapter, TestHub, TestSuiteInfo } from 'vscode-test-adapter-api';
import { DocumentUri, Range } from 'vscode-languageclient';

import type ServeD from './ServeD.js';


export interface UnittestProject {
	/// Workspace uri which may or may not map to an actual workspace folder
	/// but rather to some folder inside one.
	workspaceUri: DocumentUri;
	name: string;
	modules: UnittestModule[];
	needsLoad: boolean;
}

export interface UnittestModule {
	moduleName: string;
	uri: DocumentUri;
	tests: UnittestInfo[];
}

export interface UnittestInfo {
	id: string;
	name: string;
	containerName: string;
	range: Range;
}

export class TestAdapterGenerator implements Disposable {
	private adapters: Record<string, ServeDTestProvider> = {};

	constructor(
		public served: ServeD,
		public testHub: TestHub
	) {
	}

	updateTests(tests: UnittestProject) {
		// no lazy load in TestAdapter API
		if (tests.needsLoad) {
			return;
		}

		let adapter = this.adapters[tests.workspaceUri];

		if (!adapter) {
			const uri = Uri.parse(tests.workspaceUri);
			adapter = new ServeDTestProvider(
				this.served,
				tests.workspaceUri,
				tests.name || basename(uri.fsPath),
				workspace.getWorkspaceFolder(uri),
				tests.needsLoad
			);
			this.adapters[tests.workspaceUri] = adapter;
			this.testHub.registerTestAdapter(adapter);
		}

		adapter.updateModules(tests.needsLoad, tests.modules);
	}

	dispose() {
		Disposable.from(...Object.values(this.adapters)).dispose();
	}
}

export class ServeDTestProvider implements TestAdapter, Disposable {
	private disposables: { dispose(): void; }[] = [];

	private readonly testsEmitter = new EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new EventEmitter<void>();

	get tests(): Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): Event<void> | undefined { return this.autorunEmitter.event; }

	private modules: UnittestModule[] = [];
	private firstLoad: boolean;

	constructor(
		public served: ServeD,
		public folderId: string,
		public folderName: string,
		public workspace?: WorkspaceFolder,
		public needsLoad?: boolean
	) {
		this.firstLoad = true;
	}

	updateModules(needsLoad: boolean, modules: UnittestModule[]) {
		this.needsLoad = needsLoad;
		this.modules = modules;

		const suite: TestSuiteInfo = {
			id: `project_${this.folderId}`,
			label: this.folderName,
			type: 'suite',
			debuggable: true,
			children: []
		};

		modules.forEach(module => {
			const file = Uri.parse(module.uri).fsPath;

			const moduleInfo: TestSuiteInfo = {
				type: 'suite',
				debuggable: true,
				id: `module_${module.uri}`,
				label: module.moduleName.startsWith('(file)')
					? 'File ' + module.moduleName.substring(6).trim()
					: 'Module ' + module.moduleName,
				children: [],
				file: file,
			};

			module.tests.forEach(test => {
				moduleInfo.children.push({
					type: 'test',
					id: `test_${test.id}`,
					label: test.name,
					description: test.containerName
						? `in ${test.containerName}`
						: undefined,
					debuggable: true,
					file: file,
					line: test.range.start.line
				});
			});

			suite.children.push(moduleInfo);
		});

		this.testsEmitter.fire({ type: 'finished', suite });
	}

	async load(): Promise<void> {
		// skip first load (already emitting loaded), only do reloads
		if (this.firstLoad) {
			this.firstLoad = false;
			return;
		}

		await this.served.client.sendRequest('served/rescanTests', { uri: this.folderId });
	}

	async run(tests: string[]): Promise<void> {
		// TODO: implement this
	}

	async debug(tests: string[]): Promise<void> {
		// TODO: implement this
	}

	cancel(): void {
		// in a "real" TestAdapter this would kill the child process for the
		// current test run (if there is any)
		throw new Error('Method not implemented.');
	}

	dispose() {
		this.cancel();
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}