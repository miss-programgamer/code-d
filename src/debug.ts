import { join, isAbsolute } from 'node:path';
import { extensions, debug, DebugConfigurationProvider, Extension, DebugConfiguration, WorkspaceFolder, workspace, window, Task, TaskPanelKind, TaskRevealKind, TaskGroup, tasks } from 'vscode';
import { CancellationToken } from 'vscode-languageclient';
import which from 'which';
import stringArgv from 'string-argv';

import { getEscapeShellParamFn } from './utils/index.js';

import type ServeD from './ServeD.js';
import extension from './extension.js';


export function registerDebuggers() {
	const webfreakDebug = extensions.getExtension('webfreak.debug');
	const cppDebug = extensions.getExtension('ms-vscode.cpptools');
	const codeLLDB = extensions.getExtension('vadimcn.vscode-lldb');

	debugProvider = new DDebugProvider({ webfreakDebug, cppDebug, codeLLDB });
	extension.subs.push(debug.registerDebugConfigurationProvider('code-d', debugProvider));
}

var debugProvider: DDebugProvider;
export function linkDebuggersWithServed(served: ServeD) {
	debugProvider.served = served;
}

async function hasDebugger(name: string): Promise<boolean> {
	return await which(name, { nothrow: true }) != null;
}

class DDebugProvider implements DebugConfigurationProvider {
	public served?: ServeD;

	private webfreakDebug: Extension<any> | undefined;
	private cppDebug: Extension<any> | undefined;
	private codeLLDB: Extension<any> | undefined;

	constructor({ webfreakDebug, cppDebug, codeLLDB }: DebuggerMap) {
		this.webfreakDebug = webfreakDebug;
		this.cppDebug = cppDebug;
		this.codeLLDB = codeLLDB;
	}

	makeNativeDebugConfiguration(type: string, debugConfiguration: DebugConfiguration): DebugConfiguration {
		const platform = debugConfiguration.platform ?? process.platform;
		const args = debugConfiguration.args;

		const config: DebugConfiguration = {
			name: `dlang ${debugConfiguration.name}`,
			request: 'launch',
			type: type,
			target: debugConfiguration.program,
			cwd: debugConfiguration.cwd,
			env: debugConfiguration.env,
			valuesFormatting: 'prettyPrinters',
		};

		if (type === 'gdb') {
			config.autorun = [`source ${this.pyGDBEntrypoint}`];
		} else if (type === 'lldb-mi') {
			config.autorun = [`command script import "${this.pyLLDBEntrypoint}"`];
		}

		if (Array.isArray(args) && args.length > 0) {
			const escapeShellParam = getEscapeShellParamFn(platform);
			config.arguments = args.map(escapeShellParam).join(' ');
		} else if (typeof args === 'string' && args.length > 0) {
			config.arguments = args;
		}

		return config;
	}

	makeCodeLLDBConfiguration(debugConfiguration: DebugConfiguration): DebugConfiguration {
		const args = debugConfiguration.args;

		const config: DebugConfiguration = {
			name: `dlang ${debugConfiguration.name}`,
			request: 'launch',
			type: 'lldb',
			program: debugConfiguration.program,
			cwd: debugConfiguration.cwd,
			env: debugConfiguration.env,
			initCommands: [`command script import "${this.pyLLDBEntrypoint}"`]
		};

		if (Array.isArray(args) && args.length > 0) {
			config.args = args;
		} else if (typeof args === 'string' && args.length > 0) {
			config.args = stringArgv(args);
		}

		return config;
	}

	makeCppMiConfiguration(type: string | undefined, debugConfiguration: DebugConfiguration): DebugConfiguration {
		const args = debugConfiguration.args;

		const config: DebugConfiguration = {
			name: `dlang ${debugConfiguration.name}`,
			request: 'launch',
			type: 'cppdbg',
			program: debugConfiguration.program,
			cwd: debugConfiguration.cwd,
			environment: debugConfiguration.env,
			setupCommands: [
				{
					description: 'Enable python pretty printing for D extensions',
					ignoreFailures: true,
					text: '-enable-pretty-printing',
				}
			],
			MIMode: type
		};

		if (type == null || type === 'gdb') {
			config.setupCommands.push({
				description: 'Enable python pretty printing for D extensions',
				ignoreFailures: true,
				text: `-interpreter-exec console "source ${this.pyGDBEntrypoint}"`,
			});
		}

		if (type == null || type === 'lldb') {
			config.setupCommands.push({
				description: 'Enable python pretty printing for D extensions',
				ignoreFailures: true,
				text: `-interpreter-exec console "command script import ${this.pyLLDBEntrypoint}"`,
			});
		}

		if (Array.isArray(args) && args.length > 0) {
			config.args = args;
		} else if (typeof args === 'string' && args.length > 0) {
			config.args = stringArgv(args);
		}

		return config;
	}

	makeCppVsdbgConfiguration(debugConfiguration: DebugConfiguration): DebugConfiguration {
		const args = debugConfiguration.args;

		const config: DebugConfiguration = {
			name: `dlang ${debugConfiguration.name}`,
			request: 'launch',
			type: 'cppvsdbg',
			program: debugConfiguration.program,
			cwd: debugConfiguration.cwd,
			environment: debugConfiguration.env,
			visualizerFile: this.vsdbgNatvis
		};

		if (Array.isArray(args) && args.length > 0) {
			config.args = args;
		} else if (typeof args === 'string' && args.length > 0) {
			config.args = stringArgv(args);
		}

		return config;
	}

	async makeDebugConfiguration(debugConfiguration: DebugConfiguration): Promise<DebugConfiguration> {
		const platform = debugConfiguration.platform ?? process.platform;

		if (!isAbsolute(debugConfiguration.program) && debugConfiguration.cwd) {
			debugConfiguration.program = join(debugConfiguration.cwd, debugConfiguration.program);
		}

		let debugType: DebuggerTypeOrNone = debugConfiguration.debugger ?? 'autodetect';

		if (debugType === 'autodetect') {
			debugType = 'no-ext';

			if (this.hasCodeLLDB && debugType.startsWith('no-') && platform !== 'win32') {
				debugType = 'code-lldb';
			}

			if (this.hasCppDebug && debugType.startsWith('no-')) {
				debugType = 'no-dbg';

				if (process.platform === 'win32') {
					// https://github.com/microsoft/vscode-cpptools/blob/76e427fdb24014399497f0598727f2fd2a097454/Extension/package.json#L2751-L2757
					// always available on these platforms, so let's default to it
					if (process.arch === 'x64' || process.arch === 'ia32') {
						debugType = 'vsdbg';
					} else {
						debugType = 'cpp-auto';
					}
				} else {
					debugType = 'cpp-auto';
				}
			}

			if (this.hasWebfreakDebug && debugType.startsWith('no-')) {
				debugType = 'no-dbg';

				switch (process.platform) {
					case 'win32':
						if (await hasDebugger('mago-mi')) {
							debugType = 'mago';
						} else if (await hasDebugger('gdb')) {
							debugType = 'nd-gdb';
						} else if (await hasDebugger('lldb-mi')) {
							debugType = 'nd-lldb';
						}
						break;

					case 'darwin':
						// prefer LLDB on OSX
						if (await hasDebugger('lldb-mi')) {
							debugType = 'nd-lldb';
						} else if (await hasDebugger('gdb')) {
							debugType = 'nd-gdb';
						}
						break;

					default:
						if (await hasDebugger('gdb')) {
							debugType = 'nd-gdb';
						} else if (await hasDebugger('lldb-mi')) {
							debugType = 'nd-lldb';
						}
						break;
				}
			}

			if (this.hasCodeLLDB && debugType.startsWith('no-') && platform === 'win32') {
				debugType = 'code-lldb';
			}

			if (debugType === 'no-ext') {
				throw new Error('No debugging extension installed. Please install ms-vscode.cpptools and/or webfreak.debug! To force a debugger, explicitly specify `debugger` in the debug launch config.');
			} else if (debugType === 'no-dbg') {
				if (process.platform === 'win32') {
					throw new Error('No debugger installed. Please install Visual Studio, GDB, LLDB or mago-mi or force a debugger by specifying `debugger` in the debug launch config!');
				} else {
					throw new Error('No debugger installed. Please install GDB or LLDB or force a debugger by specifying `debugger` in the debug launch config!');
				}
			}
		}

		if (debugType === 'gdb') {
			if (this.hasCppDebug) {
				debugType = 'cpp-gdb';
			} else if (this.hasWebfreakDebug) {
				debugType = 'nd-gdb';
			} else {
				throw new Error('No debugging extension installed. Please install ms-vscode.cpptools and/or webfreak.debug! To force a debugger, explicitly specify `debugger` in the debug launch config.');
			}
		}

		if (debugType === 'lldb') {
			if (this.hasCodeLLDB && platform !== 'win32') {
				debugType = 'code-lldb';
			} else if (this.hasCppDebug) {
				debugType = 'cpp-lldb';
			} else if (this.hasWebfreakDebug) {
				debugType = 'nd-lldb';
			} else {
				throw new Error('No debugging extension installed. Please install ms-vscode.cpptools and/or webfreak.debug! To force a debugger, explicitly specify `debugger` in the debug launch config.');
			}
		}

		let config = debugConfiguration;

		switch (debugType) {
			case 'code-lldb':
				config = this.makeCodeLLDBConfiguration(debugConfiguration);
				break;

			case 'cpp-auto':
				config = this.makeCppMiConfiguration(undefined, debugConfiguration);
				break;

			case 'cpp-gdb':
				config = this.makeCppMiConfiguration('gdb', debugConfiguration);
				break;

			case 'cpp-lldb':
				config = this.makeCppMiConfiguration('lldb', debugConfiguration);
				break;

			case 'vsdbg':
				config = this.makeCppVsdbgConfiguration(debugConfiguration);
				break;

			case 'nd-gdb':
				config = this.makeNativeDebugConfiguration('gdb', debugConfiguration);
				break;

			case 'nd-lldb':
				config = this.makeNativeDebugConfiguration('lldb-mi', debugConfiguration);
				break;

			case 'mago':
				config = this.makeNativeDebugConfiguration('mago-mi', debugConfiguration);
				break;

			default:
				throw new Error(`Unrecognized debug type "${debugType}"`);
		}

		if (debugType.startsWith('cpp-') || debugType === 'vsdbg') {
			await this.cppDebug?.activate();
		} else if (debugType.startsWith('nd-') || debugType === 'mago') {
			await this.webfreakDebug?.activate();
		} else if (debugType === 'code-lldb') {
			await this.codeLLDB?.activate();
		}

		if (debugConfiguration.config != null) {
			for (const key of Object.getOwnPropertyNames(debugConfiguration.config)) {
				config[key] = debugConfiguration.config[key];
			}
		}

		return config;
	}

	async resolveDebugConfigurationWithSubstitutedVariables?(_folder: WorkspaceFolder | undefined, debugConfiguration: DebugConfiguration, _token?: CancellationToken): Promise<DebugConfiguration | undefined | null> {
		const config = await this.makeDebugConfiguration(debugConfiguration);

		this.served?.outputChannel?.appendLine(`Generated debugging configuration:\n\n${JSON.stringify(config, null, '\t')}`);

		if (!debugConfiguration.dubBuild) {
			return config;
		}

		var dubconfig = await this.served?.getActiveDubConfig();

		var hasCDebugInfo = (dubconfig?.buildOptions?.indexOf('debugInfoC') ?? -1) !== -1
			|| (dubconfig?.dflags?.indexOf('-gc') ?? -1) !== -1;

		var isSDL = dubconfig?.recipePath?.endsWith('.sdl') ?? false;

		console.log(dubconfig);

		this.served?.outputChannel?.appendLine(`Active DUB project info:\n\n${JSON.stringify(dubconfig, null, '\t')}`);

		async function warnBuildSettings(msg: string): Promise<boolean> {
			let ignore = 'Ignore';
			let edit = isSDL ? 'Edit dub.sdl' : 'Edit dub.json';
			let ws = workspace.workspaceFolders != null ? workspace.workspaceFolders[0] : undefined;
			let config = workspace.getConfiguration('d', ws);
			let ignoreAlways = ws ? 'Always Ignore (Workspace)' : 'Always Ignore (Global)';

			if (config.get('ignoreDebugHints', false)) {
				return true;
			}

			const button = await window.showWarningMessage(msg, ignore, edit, ignoreAlways);

			if (button === ignoreAlways) {
				config.update('ignoreDebugHints', true);
				return true;
			}

			if (button === edit) {
				if (dubconfig?.recipePath == null) {
					throw new Error('Unable to open recipe, please open manually');
				} else {
					const docPath = dubconfig.recipePath;
					const doc = await workspace.openTextDocument(docPath);
					await window.showTextDocument(doc);
				}
			}

			return button === ignore;
		}

		if (!hasCDebugInfo && config.type === 'cppvsdbg') {
			const sdlWarnMessage = 'C Debug Information (`-gc`) has not been enabled. This is however recommended for use with the C++ VSDBG debugger.\n\nPlease add `buildOptions \"debugInfoC\" platform=\"windows\"` to your dub.sdl (globally or best placed inside the debug configuration or a special configuration) and retry debugging or disable dub building.';
			const jsonWarnMessage = 'C Debug Information (`-gc`) has not been enabled. This is however recommended for use with the C++ VSDBG debugger.\n\nPlease add `\"buildOptions-windows\": [\"debugInfoC\"]` to your dub.json (globally or best placed inside the debug configuration or a special configuration) and retry debugging or disable dub building.';
			if (!await warnBuildSettings(isSDL ? sdlWarnMessage : jsonWarnMessage)) {
				return undefined;
			}
		} else if (hasCDebugInfo && (config.type === 'cppdbg' || config.type === 'gdb' || config.type === 'lldb' || config.type === 'lldb-mi')) {
			const warnMessage = 'C Debug Information (`-gc`) has been enabled. For the best experience with GDB/LLDB debuggers it is recommended to omit this option.\n\nTo fix this, remove or restrict the affecting `buildOptions` (debugInfoC) or `dflags` to e.g. Windows only, create a new build configuration or disable dub building.';
			if (!await warnBuildSettings(warnMessage)) {
				return undefined;
			}
		}

		let exitCode = await new Promise<number>(async (done) => {
			let task: Task = await this.served?.tasksProvider?.resolveTask({
				definition: {
					type: 'dub',
					run: false,
					compiler: '$current',
					archType: '$current',
					buildType: '$current',
					configuration: '$current',
					name: 'debug dub build',
					_id: `coded-debug-id-${Math.random().toString(36)}`
				},
				isBackground: false,
				name: 'debug dub build',
				source: 'dlang debug',
				runOptions: {
					reevaluateOnRerun: false
				},
				presentationOptions: {
					clear: true,
					echo: true,
					panel: TaskPanelKind.Dedicated,
					reveal: TaskRevealKind.Silent,
					showReuseMessage: false
				},
				problemMatchers: ['$dmd'],
				group: TaskGroup.Build,
				scope: undefined
			}, undefined)!;

			// hacky wait until finished task
			let finished = false;

			let waiter = tasks.onDidEndTask((e) => {
				if (!finished && e.execution.task.definition._id === task.definition._id) {
					setTimeout(() => {
						if (!finished) {
							finished = true;
							waiter.dispose();
							procWaiter.dispose();
							done(-1);
						}
					}, 100);
				}
			});

			let procWaiter = tasks.onDidEndTaskProcess((e) => {
				if (!finished && e.execution.task.definition._id === task.definition._id) {
					finished = true;
					waiter.dispose();
					procWaiter.dispose();
					done(e.exitCode == null ? -1 : e.exitCode);
				}
			});

			await tasks.executeTask(task);
		});

		if (exitCode === -1) {
			window.showErrorMessage('Could not start dub build task before debugging!');
			return null;
		} else if (exitCode !== 0) {
			window.showErrorMessage(`dub build exited with error code ${exitCode}`);
			return undefined;
		}

		return config;
	}

	get hasWebfreakDebug(): boolean {
		return this.webfreakDebug != null;
	}

	get hasCppDebug(): boolean {
		return this.cppDebug != null;
	}

	get hasCodeLLDB(): boolean {
		return this.codeLLDB != null;
	}

	get pyLLDBEntrypoint(): string {
		return extension.context.asAbsolutePath('dlang-debug/lldb_dlang.py');
	}

	get pyGDBEntrypoint(): string {
		return extension.context.asAbsolutePath('dlang-debug/gdb_dlang.py');
	}

	get vsdbgNatvis(): string {
		return extension.context.asAbsolutePath('dlang-debug/dlang_cpp.natvis');
	}
}

type DebuggerType = 'autodetect' | 'gdb' | 'lldb' | 'mago' | 'vsdbg' | 'cpp-auto' | 'cpp-gdb' | 'cpp-lldb' | 'nd-gdb' | 'nd-lldb' | 'code-lldb';
type DebuggerTypeOrNone = DebuggerType | 'no-ext' | 'no-dbg';

type DebuggerMap = {
	webfreakDebug: Extension<any> | undefined;
	cppDebug: Extension<any> | undefined;
	codeLLDB: Extension<any> | undefined;
};
