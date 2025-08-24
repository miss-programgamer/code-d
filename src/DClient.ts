import { window, workspace, commands, env, Uri, QuickPickItem, TextEditor, TextEditorEdit, Position, Range, SnippetString, ConfigurationTarget, OutputChannel } from 'vscode';
import { CloseAction, CloseHandlerResult, DocumentFilter, ErrorAction, ErrorHandler, LanguageClient, ErrorHandlerResult, Message, RevealOutputChannelOn, TextEdit } from 'vscode-languageclient/node.js';
import expandTilde from 'expand-tilde';

import { showQuickPickWithInput } from './utils/index.js';
import { listCompilers, makeCompilerDescription } from './compilers.js';
import { getLatestPackageInfo, listPackageOptions } from './dub/api.js';
import { DubDependency } from './dub/view.js';

import type ServeD from './ServeD.js';
import extension from './extension.js';
import mode from './dmode.js';


const args = [
	'--require', 'D',
	'--lang', env.language,
	'--provide', 'http',
	'--provide', 'implement-snippets',
	'--provide', 'context-snippets',
	'--provide', 'default-snippets',
	'--provide', 'tasks-current',
	'--provide', 'async-ask-load',
];

type ArchTypeInfo = { value: string, label?: string; } | string;

export default class DClient extends LanguageClient {
	private served: ServeD;

	constructor(served: ServeD) {
		super('serve-d', 'code-d & serve-d', {
			run: {
				command: expandTilde(extension.settings.servedPath),
				args: args,
				options: {
					cwd: extension.path
				}
			},
			debug: {
				//command: 'gdbserver',
				//args: ['--once', ':2345', servedPath, '--require', 'D', '--lang', env.language],
				command: expandTilde(extension.settings.servedPath),
				args: args.concat('--wait'),
				options: {
					cwd: extension.path
				}
			}
		}, {
			documentSelector: <DocumentFilter[]>[mode.D_MODE, mode.SDL_MODE, mode.DUB_MODE, mode.DIET_MODE, mode.DML_MODE, mode.DSCANNER_INI_MODE, mode.PROFILEGC_MODE],
			synchronize: {
				configurationSection: ['d', 'dfmt', 'dscanner', 'sdl', 'editor', 'git'],
				fileEvents: [
					workspace.createFileSystemWatcher('**/*.d'),
					workspace.createFileSystemWatcher('**/dub.json'),
					workspace.createFileSystemWatcher('**/dub.sdl'),
					workspace.createFileSystemWatcher('**/profilegc.log'),
					workspace.createFileSystemWatcher('**/compile_commands.json'),
				]
			},
			revealOutputChannelOn: RevealOutputChannelOn.Never,
			outputChannel: served.outputChannel,
			errorHandler: new DLanguageErrorHandler(served.outputChannel),
			markdown: {
				isTrusted: true,
				supportHtml: true
			}
		});

		this.served = served;

		extension.subs.push(commands.registerCommand('code-d.switchConfiguration', this.switchConfigurationCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.switchArchType', this.switchArchTypeCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.switchBuildType', this.switchBuildTypeCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.switchCompiler', this.switchCompilerCommand.bind(this)));

		extension.subs.push(commands.registerTextEditorCommand('code-d.sortImports', this.sortImportsCommand.bind(this)));
		extension.subs.push(commands.registerTextEditorCommand('code-d.implementMethods', this.implementMethodsCommand.bind(this)));
		extension.subs.push(commands.registerTextEditorCommand('code-d.addImport', this.addImportCommand.bind(this)));

		extension.subs.push(commands.registerTextEditorCommand('code-d.ignoreDscannerKey', this.ignoreDscannerKeyCommand.bind(this)));

		extension.subs.push(commands.registerCommand('code-d.killServer', this.killServerCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.restartServer', this.restartServerCommand.bind(this)));

		extension.subs.push(commands.registerCommand('code-d.reloadImports', this.reloadImportsCommand.bind(this)));

		extension.subs.push(commands.registerTextEditorCommand('code-d.convertDubRecipe', this.convertDubRecipeCommand.bind(this)));

		extension.subs.push(commands.registerCommand('code-d.addDependency', this.addDependencyCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.updateDependency', this.updateDependencyCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.removeDependency', this.removeDependencyCommand.bind(this)));

		extension.subs.push(commands.registerCommand('code-d.insertDscanner', this.insertDscannerCommand.bind(this)));
		extension.subs.push(commands.registerCommand('code-d.dumpServedInfo', this.dumpServedInfoCommand.bind(this)));
	}

	async listConfigurations(): Promise<string[]> {
		return await this.sendRequest<string[]>('served/listConfigurations');
	}

	async switchConfig(config: string): Promise<boolean> {
		return await this.sendRequest<boolean>('served/switchConfig', config);
	}

	async listArchTypes({ withMeaning = true }: { withMeaning: boolean; }): Promise<ArchTypeInfo[]> {
		return await this.sendRequest<ArchTypeInfo[]>('served/listArchTypes', { withMeaning });
	}

	async switchArchType(value: string): Promise<boolean> {
		const success = await this.sendRequest<boolean>('served/switchArchType', value);
		return success;
	}

	async listBuildTypes(): Promise<string[]> {
		return await this.sendRequest<string[]>('served/listBuildTypes');
	}

	async switchBuildType(type: string) {
		return await this.sendRequest<boolean>('served/switchBuildType', type);
	}

	async getCompiler(): Promise<string> {
		return await this.sendRequest<string>('served/getCompiler');
	}

	async switchCompiler(compiler: string): Promise<boolean> {
		return await this.sendRequest<boolean>('served/switchCompiler', compiler);
	}

	async sortImports(uri: Uri, location: any): Promise<TextEdit[]> {
		return await this.sendRequest<TextEdit[]>('served/sortImports', {
			textDocument: { uri: uri.toString() },
			location: location,
		});
	}

	async addImport(uri: Uri, name: string, location: any): Promise<TextEdit> {
		return await this.sendRequest<TextEdit>('served/addImport', {
			textDocument: { uri: uri.toString() },
			name: name,
			location: location,
		});
	}

	async implementMethods(uri: Uri, location: any): Promise<TextEdit[]> {
		return await this.sendRequest<TextEdit[]>('served/implementMethods', {
			textDocument: { uri: uri.toString() },
			location: location,
		});
	}

	async killServer(): Promise<void> {
		return await this.sendNotification('served/killServer');
	}

	async restartServer(): Promise<boolean> {
		return await this.sendRequest<boolean>('served/restartServer');
	}

	async updateImports(): Promise<boolean> {
		return await this.sendRequest<boolean>('served/updateImports');
	}

	async convertDubFormat(uri: Uri): Promise<void> {
		return await this.sendNotification('served/convertDubFormat', {
			textDocument: { uri: uri.toString() },
			newFormat: uri.toString().toLowerCase().endsWith('.sdl') ? 'json' : 'sdl',
		});
	}

	private async switchConfigurationCommand() {
		try {
			const configurations = await this.listConfigurations();
			const config = await window.showQuickPick(configurations);

			if (config != null) {
				if (await this.switchConfig(config)) {
					this.served.emit('config-change', config);
				} else {
					window.showErrorMessage(`Invalid configuration: ${config}`);
				}
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			await window.showErrorMessage(`Failed to switch configuration.`);
		}
	}

	private async switchArchTypeCommand() {
		type CustomQuickPickItem = QuickPickItem & { _value?: string; };

		try {
			const archTypes = await this.listArchTypes({ withMeaning: true });
			const pickItems = archTypes.map<CustomQuickPickItem>(archType => {
				if (typeof archType === 'string') {
					return {
						label: archType,
						_value: archType,
					};
				} else {
					return {
						label: (archType.label != null && archType.label.length > 0) ? archType.label : archType.value,
						_value: archType.value,
					};
				}
			});

			const arch: CustomQuickPickItem | undefined = await showQuickPickWithInput(pickItems, {
				canPickMany: false,
				matchOnDescription: true,
				placeHolder: 'Pick architecture or enter custom triple',
				title: 'Pick new target architecture'
			});

			if (arch != null) {
				const value = (arch._value != null && arch._value.length > 0) ? arch._value : arch.label;

				if (value === '(compiler default)') {
					switch (process.arch) {
						case 'x64':
							if (await this.switchArchType('x86_64')) {
								this.served.emit('arch-type-change', 'x86_64');
							} else {
								window.showErrorMessage(`Failed switching to x86_64`);
							}
							break;

						default:
							if (await this.switchArchType(process.arch)) {
								this.served.emit('arch-type-change', process.arch);
							} else {
								window.showErrorMessage(`Invalid architecture type: ${value} (process.arch)`);
							}
							break;
					}
				} else {
					this.switchArchType(value).then(success => {
						if (success) {
							this.served.emit('arch-type-change', value);
						} else {
							window.showErrorMessage(`Invalid architecture type: ${value}`);
						}
					});
				}
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			await window.showErrorMessage('Failed to switch arch type.');
		}
	}

	private async switchBuildTypeCommand() {
		try {
			const type = await window.showQuickPick(this.listBuildTypes());

			if (type != null) {
				if (await this.switchBuildType(type)) {
					this.served.emit('build-type-change', type);
				} else {
					window.showErrorMessage(`Invalid build type: ${type}`);
				}
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			await window.showErrorMessage('Failed to switch build type.');
		}
	}

	private async switchCompilerCommand() {
		type CustomQuickPickItem = QuickPickItem & { value: string; custom?: undefined; };

		try {
			const compiler = await this.getCompiler();
			const settingCompiler = extension.settings.dubCompiler;

			const extra: CustomQuickPickItem[] = settingCompiler
				? [{ label: settingCompiler, value: settingCompiler, description: '(from User Settings)' }]
				: [];

			const compilers = await listCompilers();

			const items = extra.concat(compilers.filter(c => c.name && c.path).map<CustomQuickPickItem>(c => ({
				label: c.name ? c.name : '',
				value: c.path ?? (c.name ? c.name : ''),
				description: makeCompilerDescription(c),
			})));

			const value = await showQuickPickWithInput(items, {
				canPickMany: false,
				matchOnDescription: true,
				placeHolder: 'Enter compiler name (e.g. dmd, ldc2, gdc) or full exe path',
				title: 'Pick new dub build compiler'
			});

			if (value) {
				const compiler: string = value.custom ? value.label : value.value;

				if (await this.switchCompiler(compiler)) {
					this.served.emit('compiler-change', compiler);
				} else {
					window.showErrorMessage(`Invalid compiler: ${compiler}`);
				}
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			window.showErrorMessage('Failed to switch compiler');
		}
	}

	private async sortImportsCommand(editor: TextEditor, edit: TextEditorEdit, location: any) {
		try {
			if (typeof location !== 'number') {
				location = editor.document.offsetAt(editor.selection.start);
			}

			const change = await this.sortImports(editor.document.uri, location);

			if (change.length > 0) {
				const { line: startLine, character: startChar } = change[0].range.start;
				const { line: endLine, character: endChar } = change[0].range.end;
				const start = new Position(startLine, startChar);
				const end = new Position(endLine, endChar);
				edit.replace(new Range(start, end), change[0].newText);
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			window.showErrorMessage('Could not sort imports');
		}
	}

	private async implementMethodsCommand(editor: TextEditor, _edit: TextEditorEdit, location: any) {
		try {
			if (typeof location !== 'number') {
				location = editor.document.offsetAt(editor.selection.start);
			}

			const change = await this.implementMethods(editor.document.uri, location);

			if (change.length > 0) {
				const { line: startLine, character: startChar } = change[0].range.start;
				const start = new Position(startLine, startChar);
				editor.insertSnippet(new SnippetString(change[0].newText), start);
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			window.showErrorMessage('Could not implement methods');
		}
	}

	private async addImportCommand(editor: TextEditor, edit: TextEditorEdit, name: string, location: any) {
		try {
			const change: any = await this.addImport(editor.document.uri, name, location);
			this.outputChannel.appendLine(`Importer resolve: ${JSON.stringify(change)}`);

			if (change.rename) {
				window.showWarningMessage('No renames from addImport command.');
				return;
			}

			for (let i = change.replacements.length - 1; i >= 0; i--) {
				const r = change.replacements[i];
				if (r.range[0] === r.range[1]) {
					edit.insert(editor.document.positionAt(r.range[0]), r.content);
				} else if (r.content === '') {
					edit.delete(new Range(editor.document.positionAt(r.range[0]), editor.document.positionAt(r.range[1])));
				} else {
					edit.replace(new Range(editor.document.positionAt(r.range[0]), editor.document.positionAt(r.range[1])), r.content);
				}
			}

			this.outputChannel.appendLine('Done.');
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			window.showErrorMessage('Could not add import.');
		}
	}

	private async ignoreDscannerKeyCommand(editor: TextEditor, edit: TextEditorEdit, key: string, mode?: boolean | 'line') {
		const client = this;

		let ignored = workspace.getConfiguration('dscanner', editor.document.uri).get('ignoredKeys');

		if (!ignored) {
			ignored = workspace.getConfiguration('dscanner', null).get('ignoredKeys');
		}

		async function doChange(key: string, global?: boolean) {
			if (Array.isArray(ignored)) {
				ignored.push(key);
			} else {
				ignored = [key];
			}

			const target = global ? ConfigurationTarget.Global : ConfigurationTarget.WorkspaceFolder;
			await workspace.getConfiguration('dscanner', editor.document.uri).update('ignoredKeys', ignored, target);
			client.served.triggerDscanner(editor.document.uri);
		};

		if (typeof key !== 'string' || key.length === 0) {
			const available: string[] = [
				'dscanner.bugs.backwards_slices',
				'dscanner.bugs.if_else_same',
				'dscanner.bugs.logic_operator_operands',
				'dscanner.bugs.self_assignment',
				'dscanner.confusing.argument_parameter_mismatch',
				'dscanner.confusing.brexp',
				'dscanner.confusing.builtin_property_names',
				'dscanner.confusing.constructor_args',
				'dscanner.confusing.function_attributes',
				'dscanner.confusing.lambda_returns_lambda',
				'dscanner.confusing.logical_precedence',
				'dscanner.confusing.struct_constructor_default_args',
				'dscanner.deprecated.delete_keyword',
				'dscanner.deprecated.floating_point_operators',
				'dscanner.if_statement',
				'dscanner.performance.enum_array_literal',
				'dscanner.style.allman',
				'dscanner.style.alias_syntax',
				'dscanner.style.doc_missing_params',
				'dscanner.style.doc_missing_returns',
				'dscanner.style.doc_non_existing_params',
				'dscanner.style.explicitly_annotated_unittest',
				'dscanner.style.has_public_example',
				'dscanner.style.imports_sortedness',
				'dscanner.style.long_line',
				'dscanner.style.number_literals',
				'dscanner.style.phobos_naming_convention',
				'dscanner.style.undocumented_declaration',
				'dscanner.suspicious.auto_ref_assignment',
				'dscanner.suspicious.catch_em_all',
				'dscanner.suspicious.comma_expression',
				'dscanner.suspicious.incomplete_operator_overloading',
				'dscanner.suspicious.incorrect_infinite_range',
				'dscanner.suspicious.label_var_same_name',
				'dscanner.suspicious.length_subtraction',
				'dscanner.suspicious.local_imports',
				'dscanner.suspicious.missing_return',
				'dscanner.suspicious.object_const',
				'dscanner.suspicious.redundant_attributes',
				'dscanner.suspicious.redundant_parens',
				'dscanner.suspicious.static_if_else',
				'dscanner.suspicious.unmodified',
				'dscanner.suspicious.unused_label',
				'dscanner.suspicious.unused_parameter',
				'dscanner.suspicious.unused_variable',
				'dscanner.suspicious.useless_assert',
				'dscanner.unnecessary.duplicate_attribute',
				'dscanner.useless.final',
				'dscanner.useless-initializer',
				'dscanner.vcall_ctor',
				'dscanner.syntax',
			];

			if (Array.isArray(ignored)) {
				ignored.forEach(element => {
					const i = available.indexOf(element);
					if (i !== -1) {
						available.splice(i, 1);
					}
				});
			}

			const key = await window.showQuickPick(available, {
				placeHolder: 'Select which key to ignore'
			});

			if (key != null) {
				if (typeof mode === 'string') {
					editor.edit(edit => {
						edit.insert(editor.document.lineAt(editor.selection.end).range.end, ` // @suppress(${key})`);
						client.served.triggerDscanner(editor.document.uri);
					});
				} else {
					doChange(key, mode);
				}
			}
		} else {
			if (typeof mode === 'string') {
				edit.insert(editor.document.lineAt(editor.selection.end).range.end, ` // @suppress(${key})`);
				client.served.triggerDscanner(editor.document.uri);
			} else {
				doChange(key, mode);
			}
		}
	}

	private async killServerCommand() {
		await this.killServer();

		const pick = await window.showInformationMessage('Killed DCD-Server', 'Restart');

		if (pick === 'Restart') {
			await commands.executeCommand('code-d.restartServer');
		}
	}

	private async restartServerCommand() {
		if (await this.restartServer()) {
			await window.showInformationMessage('Restarted DCD-Server');
		} else {
			await window.showErrorMessage('Failed to restart DCD-Server');
		}
	}

	private async reloadImportsCommand() {
		try {
			if (await this.updateImports()) {
				window.showInformationMessage('Successfully reloaded import paths');
			} else {
				window.showWarningMessage('Import paths are empty!');
			}
		} catch (err) {
			this.outputChannel.appendLine(`${err}`);
			window.showErrorMessage('Could not update imports. dub might not be initialized yet!');
		}
	}

	private async convertDubRecipeCommand(editor: TextEditor, _edit: TextEditorEdit) {
		if (editor.document.isUntitled) {
			window.showErrorMessage('Please save the file first.');
		} else {
			if (editor.document.isDirty) {
				if (!await editor.document.save()) {
					window.showErrorMessage('Failed to save file before converting.');
					return;
				}
			}

			await this.convertDubFormat(editor.document.uri);
		}
	}

	private async addDependencyCommand() {
		const pkg = await window.showQuickPick(listPackageOptions(), {
			placeHolder: 'Dependency Name',
			matchOnDescription: false,
			matchOnDetail: true,
		});

		if (pkg != null) {
			this.sendNotification('served/installDependency', {
				name: pkg.label,
				version: pkg.description,
			});
		}
	}

	private async updateDependencyCommand(dep: DubDependency) {
		if (dep.info) {
			const pkg = await getLatestPackageInfo(dep.info.name);
			await this.sendNotification('served/updateDependency', {
				name: dep.info.name,
				version: pkg.version
			});
		}
	}

	private async removeDependencyCommand(dep: DubDependency) {
		if (dep.info) {
			await this.sendNotification('served/uninstallDependency', {
				name: dep.info.name
			});
		}
	}

	private async insertDscannerCommand() {
		const defaultDscannerIni = '[analysis.config.StaticAnalysisConfig]\nstyle_check=\"enabled\"\n';

		if (!window.activeTextEditor) {
			return window.showErrorMessage('No text editor active');
		}

		const ini = await this.served.listDScannerConfig(window.activeTextEditor.document.uri);

		let text = '';
		ini.forEach(section => {
			text += `; ${section.description}\n`;
			text += `[${section.name}]\n`;
			section.features.forEach(feature => {
				text += `; ${feature.description}\n`;
				text += `${feature.name}=\"${feature.enabled}\"\n`;
			});
			text += '\n';
		});

		text = text.length > 0 ? text : defaultDscannerIni;

		if (!window.activeTextEditor) {
			return;
		}

		await window.activeTextEditor.edit((bld) => {
			if (window.activeTextEditor) {
				bld.insert(window.activeTextEditor.selection.start, text);
			}
		});
	}

	private async dumpServedInfoCommand() {
		const info = await this.sendRequest('served/getInfo', {
			includeConfig: true,
			includeIndex: true,
			includeTasks: true,
		});

		this.outputChannel.appendLine('');
		this.outputChannel.appendLine('---');
		this.outputChannel.appendLine('serve-d dump:');
		this.outputChannel.appendLine(JSON.stringify(info, null, '\t'));
		this.outputChannel.appendLine('---');
		this.outputChannel.appendLine('');

		this.outputChannel.show(true);
	}
}

export class DLanguageErrorHandler implements ErrorHandler {
	private restarts: number[];

	constructor(private output: OutputChannel) {
		this.restarts = [];
	}

	public error(error: Error, message: Message, count: number): ErrorHandlerResult {
		return { action: ErrorAction.Continue };
	}

	public closed(): CloseHandlerResult {
		this.restarts.push(Date.now());
		if (this.restarts.length < 10) {
			return { action: CloseAction.Restart };
		} else {
			let diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
			if (diff <= 60 * 1000) {
				// TODO: run automated diagnostics about current code file here
				this.output.appendLine(`Server crashed 10 times in the last minute. The server will not be restarted.`);
				return { action: CloseAction.DoNotRestart };
			} else {
				this.restarts.shift();
				return { action: CloseAction.Restart };
			}
		}
	}
}
