import { setTimeout, clearTimeout } from 'node:timers';
import { basename } from 'node:path';
import { window, Disposable, Progress, ProgressOptions, ProgressLocation, StatusBarItem, StatusBarAlignment, TextEditor, TextDocument } from 'vscode';

import type ServeD from './ServeD.js';
import { formatPercent } from './utils/index.js';
import extension from './extension.js';


export default class StatusBar implements Disposable {
	configSelector: ConfigSelector;
	archSelector: ArchSelector;
	buildSelector: BuildSelector;
	compilerSelector: CompilerSelector;

	startupProgress?: Progress<{ message?: string, increment?: number; }>;
	startupResolve?: () => void;
	startupReject?: (err: unknown) => void;
	startupTimeout?: NodeJS.Timeout;

	constructor(served: ServeD) {
		this.configSelector = new ConfigSelector(served);
		this.archSelector = new ArchSelector(served);
		this.buildSelector = new BuildSelector(served);
		this.compilerSelector = new CompilerSelector(served);
	}

	dispose() {
		this.configSelector.dispose();
		this.archSelector.dispose();
		this.buildSelector.dispose();
		this.compilerSelector.dispose();
	}

	async beginStartupProgress() {
		this.failStartupProgress(new Error('interrupted'));

		const options: ProgressOptions = {
			location: ProgressLocation.Window,
			cancellable: false,
			title: 'D'
		};

		await window.withProgress(options, progress => new Promise<void>((resolve, reject) => {
			this.startupProgress = progress;
			this.startupResolve = resolve;
			this.startupReject = reject;
			this.startupTimeout = setTimeout(() => {
				this.failStartupProgress(new Error('startup timed out'));
			}, 30000);
		}));
	}

	updateStartupProgress(step: number, total: number, title: string, message: string) {
		this.startupProgress?.report({
			message: `${title} (${formatPercent(step / (total || 1))}): ${message}`,
		});

		clearTimeout(this.startupTimeout);
		this.startupTimeout = setTimeout(() => {
			this.failStartupProgress(new Error('startup timed out'));
		}, 30000);
	}

	endStartupProgress() {
		if (this.startupResolve != null) {
			clearTimeout(this.startupTimeout);
			this.startupResolve();

			delete this.startupProgress;
			delete this.startupResolve;
			delete this.startupReject;
			delete this.startupTimeout;
		}
	}

	failStartupProgress(err: unknown) {
		if (this.startupReject != null) {
			clearTimeout(this.startupTimeout);
			this.startupReject(err);

			delete this.startupProgress;
			delete this.startupResolve;
			delete this.startupReject;
			delete this.startupTimeout;
		}
	}

	get selectors(): Generator<GenericSelector> {
		return this.#getSelectors();
	}

	*#getSelectors(): Generator<GenericSelector> {
		yield this.configSelector;
		yield this.archSelector;
		yield this.buildSelector;
		yield this.compilerSelector;
	}
}

type GenericSelectorProps = {
	served: ServeD;
	priority: number;
	command: string;
	tooltip: string;
	event: string;
	method: string;
	fallback: string;
};

class GenericSelector implements Disposable {
	served: ServeD;
	method: string;
	fallback: string;

	item: StatusBarItem;
	disposables: Disposable[] = [];

	constructor({ served, priority, command, tooltip, event, method, fallback }: GenericSelectorProps) {
		this.served = served;
		this.method = method;
		this.fallback = fallback;

		this.item = window.createStatusBarItem(StatusBarAlignment.Left, priority);
		this.item.command = command;
		this.item.tooltip = tooltip;

		this.disposables.push(window.onDidChangeActiveTextEditor(this.updateVisibility.bind(this)));
		this.served.on('workspace-change', this.update.bind(this));

		this.served.on(event, config => {
			this.item.text = config ?? this.fallback;
		});

		this.updateVisibility(window.activeTextEditor);
		this.update();
	}

	dispose() {
		this.disposables.forEach(sub => sub.dispose());
	}

	updateVisibility(editor: TextEditor | undefined) {
		if (checkStatusbarVisibility('alwaysShowDubStatusButtons', editor)) {
			this.item.show();
		} else {
			this.item.hide();
		}
	}

	async update() {
		this.item.text = await this.served.client
			.sendRequest<string | undefined>(this.method) ?? this.fallback;
	}
}

const relevantLanguages = new Set<string>(['d', 'dml', 'diet']);
const relevantFilenames = new Set<string>(['dub.json', 'sub.sdl']);

export function isStatusbarRelevantDocument(document: TextDocument): boolean {
	if (relevantLanguages.has(document.languageId)) {
		return true;
	} else if (relevantFilenames.has(basename(document.fileName).toLowerCase())) {
		return true;
	} else {
		return false;
	}
}

export function checkStatusbarVisibility(overrideConfig: string, editor?: TextEditor): boolean {
	if (editor == null) {
		return extension.settings.get(overrideConfig, false);
	} else {
		editor ??= window.activeTextEditor;

		if (editor != null) {
			return extension.settings.get(overrideConfig, false, editor.document) || isStatusbarRelevantDocument(editor.document);
		} else {
			return false;
		}
	}
}

class ConfigSelector extends GenericSelector {
	constructor(served: ServeD) {
		super({
			served,
			priority: 0.92145,
			command: 'code-d.switchConfiguration',
			tooltip: 'Switch Configuration',
			event: 'config-change',
			method: 'served/getConfig',
			fallback: '(config)',
		});
	}
}

class ArchSelector extends GenericSelector {
	constructor(served: ServeD) {
		super({
			served,
			priority: 0.92144,
			command: 'code-d.switchArchType',
			tooltip: 'Switch Arch Type',
			event: 'arch-type-change',
			method: 'served/getArchType',
			fallback: '(default arch)',
		});
	}
}

class BuildSelector extends GenericSelector {
	constructor(served: ServeD) {
		super({
			served,
			priority: 0.92143,
			command: 'code-d.switchBuildType',
			tooltip: 'Switch Build Type',
			event: 'build-type-change',
			method: 'served/getBuildType',
			fallback: '(build type)',
		});
	}
}

class CompilerSelector extends GenericSelector {
	constructor(served: ServeD) {
		super({
			served,
			priority: 0.92142,
			command: 'code-d.switchCompiler',
			tooltip: 'Switch Compiler',
			event: 'compiler-change',
			method: 'served/getCompiler',
			fallback: '(compiler)',
		});
	}
}
