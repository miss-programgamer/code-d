import { stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { spawn, SpawnOptionsWithoutStdio } from 'node:child_process';
import { window, workspace, commands, Uri, Disposable, ConfigurationTarget, QuickPickItem, QuickPickItemKind, ProgressLocation, type ExtensionContext, type WorkspaceFolder, OutputChannel, ConfigurationChangeEvent } from 'vscode';
import { NotificationType, MessageType, } from 'vscode-languageclient/node.js';
import { default as expandTilde } from 'expand-tilde';
import { CodedAPI } from 'code-d-api';

import { checkCompilers, DetectedCompiler, makeCompilerInstallButtons, registerCompilerInstaller } from './compilers.js';
import { restoreCreateProjectPackageBackup } from './project-creator.js';
import { registerDebuggers, linkDebuggersWithServed } from './debug.js';
import { shortenPath, getPackageVersion, httpProxy, cmpSemver } from './utils/index.js';
import { addSDLProviders } from './sdl/sdl-contributions.js';
import { addJSONProviders } from './json-contributions.js';
import { CoverageAnalyzer } from './coverage.js';
import { registerCommands } from './commands.js';
import { DubDependency } from './dub/view.js';
import { builtinPlugins } from "./builtin_plugins.js";

import Installer, { Release } from './installer.js';
import ServeDCodeDAPI from './ServeDCodeDAPI.js';
import StatusBar from './StatusBar.js';
import GCProfiler from './GCProfiler.js';
import ServeD from './ServeD.js';
import DTerminalLinkProvider from './DTerminalLinkProvider.js';
import DubEditor from './dub/editor.js';
import Globals from './globals.js';
import Settings from './Settings.js';


/**
 * Extension entry point.
 * 
 * @param context VS Code extension context handle.
 * @returns An instance of the dlang API.
 */
export async function activate(context: ExtensionContext): Promise<CodedAPI | undefined> {
	if (await extension.init(context)) {
		extension.greetNewUsers();
		await extension.start();
	}

	return extension.api;
}

export class Extension {
	#output: OutputChannel;
	#installer: Installer;
	#settings: Settings;
	#context: ExtensionContext;
	#globals: Globals;

	#version?: string;
	#served?: ServeD;
	#api?: ServeDCodeDAPI;

	#compiler?: DetectedCompiler;

	#reloading: boolean = false;
	#started: boolean = false;
	#outdated: boolean = false;

	#lastConfigUpdateWasInternal?: number;

	constructor() {
		this.#output = window.createOutputChannel('D Programming Language');
		this.#installer = new Installer(this.#output);
		this.#settings = new Settings;

		// This is technically cheating, but also basically necessary
		this.#context = undefined as any;
		this.#globals = undefined as any;
	}

	async onDidChangeConfiguration(ev: ConfigurationChangeEvent) {
		const needReloadSettings = [
			"d.servedPath",
			"d.servedReleaseChannel",
			"d.dcdServerPath",
			"d.dcdClientPath",
			"d.scanAllFolders",
			"d.neverUseDub",
			"d.disabledRootGlobs",
			"d.extraRoots",
		];

		// ignore config updates that come from dlang or serve-d
		if (this.#lastConfigUpdateWasInternal && new Date().getTime() - this.#lastConfigUpdateWasInternal < 1000) {
			return;
		}

		const changed = needReloadSettings.some(setting => {
			return ev.affectsConfiguration(setting);
		});

		if (changed) {
			const reloadBtn = "Reload VSCode";
			const ignoreBtn = "Ignore";

			const btn = await window.showInformationMessage("You have changed dlang's `"
				+ changed + "` setting. To apply the new value, you need to reload VSCode.",
				reloadBtn, ignoreBtn);

			if (btn == reloadBtn) {
				commands.executeCommand('workbench.action.reloadWindow');
			}
		}
	}

	async init(context: ExtensionContext) {
		this.#context = context;
		this.#version = await getPackageVersion(context);
		this.#globals = new Globals(context);

		const globals = this.#globals;
		const userConfig = "Open User Settings";

		const proxy = httpProxy();
		if (proxy != null) {
			process.env["http_proxy"] = proxy;
		}

		await restoreCreateProjectPackageBackup();

		if (globals.checkedCompiler !== 2) {
			console.log("Checking if compiler is present");
			this.#compiler = await checkCompilers();
			await globals.setCheckedCompiler(2);
			let setupDCompiler = "Change D Compiler";
			let gettingStarted = "Getting Started";
			if (this.#compiler?.name ?? false) {
				let compilerSpec = this.#compiler.name;

				if (this.#compiler.version) {
					compilerSpec += " " + this.#compiler.version;
				}

				let [_, checked] = makeCompilerInstallButtons(this.#compiler);

				for (let i = 0; i < checked.length; i++) {
					let action = checked[i].action;
					if (action !== undefined)
						action();
				}

				window.showInformationMessage("dlang has auto-detected " + compilerSpec + " and preconfigured it. "
					+ "If you would like to use another compiler, please click the button below.",
					setupDCompiler, gettingStarted)
					.then(btn => {
						if (btn == setupDCompiler) {
							commands.executeCommand("code-d.setupCompiler");
						} else if (btn == gettingStarted) {
							commands.executeCommand("workbench.action.openWalkthrough", "webfreak.dlang#welcome");
						}
					});
			} else {
				gettingStarted = "First time setup";
				window.showWarningMessage(
					"dlang has not detected any compatible D compiler. Please click the button below to install and configure "
					+ "a D compiler on your system or just for dlang. Auto completion will not contain any standard "
					+ "library symbols and building projects will not work until then.",
					gettingStarted)
					.then(btn => {
						if (btn == gettingStarted) {
							commands.executeCommand("workbench.action.openWalkthrough", "webfreak.dlang#welcome");
						}
					});
			}
		}

		// disable dub checks for now because precompiled dub binaries on windows are broken
		if (!await this.checkDub(undefined)) {
			console.error("Failed to automatically find dub or execute it! Please set d.dubPath properly.");

			if (this.settings.dubPath !== 'dub') {
				window.showErrorMessage("The dub path specified in your user settings via d.dubPath is not a"
					+ " valid dub executable. Please unset it to automatically find it through your compiler or manually"
					+ " point it to a valid executable file.\n\nIssues building projects might occur.",
					userConfig).then((item) => {
						if (item == userConfig) {
							commands.executeCommand("workbench.action.openGlobalSettings");
						}
					});
			}
		}

		const isLegacyBeta = this.settings.legacyBetaStream;
		const releaseChannelInfo = this.settings.releaseChannelInfo;

		let channelString = this.settings.releaseChannel;

		if (isLegacyBeta && releaseChannelInfo != null && releaseChannelInfo.globalValue == null) {
			this.hideNextPotentialConfigUpdateWarning();
			await this.settings.setReleaseChannel('nightly');
			channelString = 'nightly';

			let stable = "Switch to Stable";
			let beta = "Switch to Beta";

			window.showInformationMessage("Hey! The setting 'd.betaStream' no longer exists and has been replaced with "
				+ "'d.servedReleaseChannel'. Your settings have been automatically updated to fetch nightly builds, but you "
				+ "probably want to remove the old setting.\n\n"
				+ "Stable and beta releases are planned more frequently now, so they might be a better option for you.",
				stable, beta, userConfig).then(item => {
					if (item == userConfig) {
						commands.executeCommand("workbench.action.openGlobalSettings");
					} else if (item == stable) {
						this.hideNextPotentialConfigUpdateWarning();
						this.didChangeReleaseChannel(this.settings.setReleaseChannel('stable'));
					} else if (item == beta) {
						this.hideNextPotentialConfigUpdateWarning();
						this.didChangeReleaseChannel(this.settings.setReleaseChannel('beta'));
					}
				});
		}

		const currentCodedServedIteration = 1; // bump on new dlang releases that want new serve-d

		const subs = this.subs;
		subs.push(addSDLProviders());
		subs.push(addJSONProviders());
		subs.push(registerCompilerInstaller());
		subs.push(DubEditor.register());
		subs.push(DTerminalLinkProvider.register());
		subs.push(workspace.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this)));

		await registerCommands();

		subs.push(commands.registerCommand('code-d.showGCCalls', GCProfiler.listProfileCache));

		if (workspace.workspaceFolders != null) {
			const coverageAnalyzer = new CoverageAnalyzer();
			subs.push(coverageAnalyzer);
			subs.push(workspace.registerTextDocumentContentProvider('dcoveragereport', coverageAnalyzer));

			const watcher = workspace.createFileSystemWatcher('**/*.lst', false, false, false);
			watcher.onDidCreate(coverageAnalyzer.updateCache, coverageAnalyzer, subs);
			watcher.onDidChange(coverageAnalyzer.updateCache, coverageAnalyzer, subs);
			watcher.onDidDelete(coverageAnalyzer.removeCache, coverageAnalyzer, subs);
			subs.push(watcher);

			workspace.onDidOpenTextDocument(coverageAnalyzer.populateCurrent, coverageAnalyzer, subs);

			commands.registerCommand('code-d.generateCoverageReport', () => {
				workspace.openTextDocument(Uri.parse('dcoveragereport://null'));
			});

			for (const file of await workspace.findFiles('**/*.lst', '')) {
				coverageAnalyzer.updateCache(file);
			}
		}

		if (await this.update()) {
			await Promise.all([
				globals.setServeDDownloadedReleaseChannel(channelString),
				globals.setServeDWantedDownloadIteration(currentCodedServedIteration),
			]);

			if (this.#outdated) {
				if (!this.#reloading) {
					this.#reloading = true;
					// just to be absolutely sure all settings have been written
					setTimeout(() => {
						commands.executeCommand('workbench.action.reloadWindow');
					}, 500);
				}
			} else {
				this.#started = true;
				return true;
			}
		}

		return false;
	}

	async start() {
		this.#served = new ServeD(this.#output);

		const served = this.#served;
		const client = served.client;

		registerDebuggers();
		linkDebuggersWithServed(served);

		var updateSetting = new NotificationType<{ section: string, value: any, global: boolean; }>("coded/updateSetting");
		client.onNotification(updateSetting, (arg: { section: string, value: any, global: boolean; }) => {
			this.hideNextPotentialConfigUpdateWarning();
			this.settings.set(arg.section, arg.value, arg.global ? ConfigurationTarget.Global : undefined);
		});

		var logInstall = new NotificationType<string>("coded/logInstall");
		client.onNotification(logInstall, (message: string) => {
			this.#output.appendLine(message);
		});

		const statusBar = new StatusBar(served);
		client.onNotification("coded/initDubTree", () => {
			this.subs.push(statusBar);
			commands.executeCommand("setContext", "d.hasDubProject", true);
			this.subs.push(window.registerTreeDataProvider<DubDependency>("dubDependencies", served));
		});

		client.onNotification("coded/updateDubTree", () => {
			served.refreshDependencies();
		});

		client.onNotification("coded/changedSelectedWorkspace", () => {
			served.emit("workspace-change");
			served.refreshDependencies();
		});

		client.onNotification("coded/skippedLoads", async (roots: string[]) => {
			if (typeof roots === 'object' && !Array.isArray(roots)) {
				roots = (roots as any).roots;
			}

			if (typeof roots === 'string') {
				roots = [roots] as string[];
			} else if (!Array.isArray(roots)) {
				throw new Error(`Unexpected roots with coded/skippedLoads: ${JSON.stringify(roots)}`);
			}

			const allowList = this.settings.manyProjectsAllowList;
			const denyList = this.settings.manyProjectsDenyList;
			const decisions = new Array(roots.length);

			let decidedNum = 0;
			for (let i = 0; i < roots.length; ++i) {
				if (allowList.includes(roots[i])) {
					decisions[i] = true;
					++decidedNum;
				} else if (denyList.includes(roots[i])) {
					decisions[i] = false;
					++decidedNum;
				}
			}

			console.log("Asking for late init for projects ", roots, " (allowlist: ", allowList, ", denylist: ", denyList, ")");

			let btnLoadAll = decidedNum > 0
				? "Load Remaining (" + (roots.length - decidedNum) + ")"
				: roots.length == 1
					? "Load"
					: "Load All (" + roots.length + ")";
			let btnSkipAll = decidedNum > 0
				? "Skip Remaining"
				: roots.length == 1
					? "Skip"
					: "Skip All";
			let btnInteractive = "More Options...";
			let msg = "There are too many subprojects in this project according to d.manyProjectsThreshold. Load "
				+ (roots.length == 1 ? "1 extra project?" : roots.length + " extra projects?")
				+ (decidedNum > 0 ? ("\n" + (decidedNum == 1 ? "1 project has" : decidedNum + " projects have")
					+ " been decided on based on d.manyProjects{Allow/Deny}List already.") : "");
			let result = await window.showInformationMessage(msg,
				btnLoadAll, btnSkipAll, btnInteractive);

			function setRemaining(b: boolean) {
				for (let i = 0; i < decisions.length; i++)
					if (decisions[i] === undefined)
						decisions[i] = b;
			}

			switch (result) {
				case btnLoadAll:
					setRemaining(true);
					break;

				case btnInteractive:
					let result = await window.showQuickPick<QuickPickItem>(roots.map<QuickPickItem>((r, i) => ({
						_root: r,
						_id: i,
						label: r,
						picked: decisions[i],
					})).concat([
						{
							kind: QuickPickItemKind.Separator,
							label: "Options",
							alwaysShow: true,
						},
						<any>{
							_id: "remember",
							label: "Remember Selection (workspace settings)",
							alwaysShow: true
						}
					]), {
						canPickMany: true,
						ignoreFocusOut: true,
						title: "Select projects to load"
					});

					result?.forEach(r => {
						let root = <string>(<any>r)._root;
						let id = <number>(<any>r)._id;
						if (!root)
							return;

						if (!allowList.includes(root))
							allowList.push(root);
						let denyIndex = denyList.indexOf(root);
						if (denyIndex != -1)
							denyList.splice(denyIndex, 1);

						decisions[id] = true;
					});

					for (let i = 0; i < decisions.length; i++) {
						if (decisions[i] === undefined) {
							let root = roots[i];
							if (!denyList.includes(root)) {
								denyList.push(root);
							}
							let allowIndex = allowList.indexOf(root);
							if (allowIndex != -1) {
								allowList.splice(allowIndex, 1);
							}
							decisions[i] = false;
						}
					}

					const save = (result?.findIndex(r => (<any>r)._id == "remember") ?? -1) >= 0;

					if (save) {
						await this.settings.setManyProjectsAllowList(allowList);
						await this.settings.setManyProjectsDenyList(denyList);
					}

					return;

				case btnSkipAll:
				default:
					setRemaining(false);
					break;
			}

			let toLoad = roots.filter((_, i) => decisions[i] === true);
			served.forceLoadProjects(toLoad);
		});

		client.onNotification("window/logMessage", function (info: { type: MessageType, message: string; }) {
			if (info.type == MessageType.Log && info.message.startsWith("[progress]")) {
				let m = /^\[progress\] \[(\d+\.\d+)\] \[(\w+)\](?:\s*(\d+)?\s*(?:\/\s*(\d+))?:\s)?(.*)/.exec(info.message);
				if (!m) return;
				const time = parseFloat(m[1]);
				const type = m[2];
				const step = m[3] ? parseInt(m[3]) : undefined;
				const total = m[4] ? parseInt(m[4]) : undefined;
				const args = m[5] || undefined;

				let title: string = 'setup';
				let workspace: string | undefined = undefined;

				if (type === 'configLoad') {
					statusBar.beginStartupProgress();
					workspace = shortenPath(Uri.parse(args ?? '').fsPath);
					title = `workspace ${workspace}`;
				} else if (type === 'configFinish') {
					statusBar.endStartupProgress();
				} else if (type === 'workspaceStartup' && step != null && total != null) {
					statusBar.updateStartupProgress(step * 0.5, total, title, 'updating');
				} else if (type == 'completionStartup' && step != null && total != null) {
					statusBar.updateStartupProgress(step * 0.5 + total * 0.5, total, title, 'indexing');
				} else if ((type === 'dubReload' || type === 'importReload' || type === 'importUpgrades') && step != null && total != null) {
					if (step == total) {
						statusBar.endStartupProgress();
					} else {
						statusBar.beginStartupProgress();
						workspace = shortenPath(Uri.parse(args ?? '').fsPath);
						title = `workspace ${workspace}`;
						let label: string;

						switch (type) {
							case 'dubReload':
								label = 'updating';
								break;

							case 'importReload':
								label = 'indexing';
								break;

							case 'importUpgrades':
								label = 'downloading dependencies';
								break;

							default:
								label = 'loading';
								break;
						}

						statusBar.updateStartupProgress(step, total, title, label);
					}
				}
			}
		});

		client.onRequest<boolean, { url: string, title?: string, output: string; }>('coded/interactiveDownload', (e, token): Promise<boolean> => {
			return new Promise<boolean>(async (resolve) => {
				let aborted = false;

				const stream = await this.#installer.downloadFileInteractive(e.url, e.title || "Dependency Download", () => {
					aborted = true;
					resolve(false);
				});

				stream.pipe(createWriteStream(e.output)).on('finish', () => {
					if (!aborted) {
						resolve(true);
					}
				});
			});
		});

		this.#api = new ServeDCodeDAPI(served);
		builtinPlugins(this.#api);
	}

	async update(): Promise<boolean> {
		const globals = this.#globals;

		const currentCodedServedIteration = 1; // bump on new dlang releases that want new serve-d
		const firstTimeUser: boolean = globals.serveDDownloadedReleaseChannel != null;
		const force: boolean = globals.serveDWantedDownloadIteration != currentCodedServedIteration;

		const releaseChannel = this.settings.releaseChannel;
		const version = await this.#installer.findLatestServeD(firstTimeUser || force, releaseChannel);

		let origUpdateFun = version ? (version.asset
			? this.#installer.installServeD([{ url: version.asset.browser_download_url, title: "Serve-D" }], version.name)
			: this.#installer.compileServeD((version && version.name != "nightly") ? version.name : undefined))
			: this.#installer.updateAndInstallServeD;

		let updateFun = origUpdateFun;

		updateFun = async (env: NodeJS.ProcessEnv): Promise<boolean | undefined | "retry"> => {
			let [isBlocked, lock] = await this.acquireInstallLock("serve-d");
			try {
				this.subs.push(lock);

				if (isBlocked) {
					return await this.waitForOtherInstanceInstall("serve-d", force)
						.then((doUpdate) => doUpdate ? origUpdateFun(env) : "retry");
				}

				return await origUpdateFun(env);
			} finally {
				let i = this.subs.indexOf(lock);
				this.subs.splice(i, 1);
				lock.dispose();
			}
		};

		let upToDate = await this.checkProgram(force, "servedPath", "serve-d", "serve-d",
			(env: any) => updateFun(env),
			version ? (version.asset ? "Download" : "Compile") : "Install", this.isServedOutdated(version));

		if (upToDate == null) {
			return false; /* user dismissed install dialogs, don't continue startup */
		} else if (upToDate === 'retry') {
			return this.update();
		}

		return true;
	}

	async greetNewUsers() {
		const globals = this.#globals;

		if (!globals.greetedNewCodeDUser) {
			await globals.setGreetedNewCodeDUser(true);
			await globals.setLastCheckedCodedVersion(this.version);
			await commands.executeCommand("workbench.action.openWalkthrough", "webfreak.dlang#welcome");
		} else if (this.version) {
			if (globals.lastCheckedCodedVersion !== this.version) {
				await globals.setLastCheckedCodedVersion(this.version);

				if (this.settings.showUpdateChangelogs) {
					commands.executeCommand("markdown.showPreview", Uri.file(this.context.asAbsolutePath("CHANGELOG.md")), { locked: true });
					let disableChangelog = "Never show changelog";
					let close = "Close";
					window.showInformationMessage("Welcome to dlang " + this.version + "! See what has changed since " + (globals.lastCheckedCodedVersion || "last version") + "...", disableChangelog, close).then(action => {
						if (action == disableChangelog) {
							this.settings.setShowUpdateChangelogs(false);
						}
					});
				}
			}
		}
	}

	async checkDub(dubPath: string | undefined, updateSetting: boolean = false): Promise<boolean> {
		dubPath ??= expandTilde(this.settings.dubPath);

		try {
			await this.spawnOneShotCheck(dubPath, ['--version'], false, {
				cwd: workspace.rootPath,
			});
		} catch (e) {
			this.#output.appendLine(`${e}`);

			if (this.#compiler == null) {
				this.#compiler = await checkCompilers();
			}

			if (!this.#compiler.name || !this.#compiler.path) {
				return false;
			} else {
				let ext = process.platform == "win32" ? ".exe" : "";
				return await this.checkDub(join(dirname(this.#compiler.path), "dub" + ext), true);
			}
		}

		if (updateSetting) {
			this.hideNextPotentialConfigUpdateWarning();
			await this.settings.setDubPath(dubPath);
		}

		return true;
	}

	async checkProgram(
		forced: boolean,
		configName: string,
		defaultPath: string,
		name: string,
		installFunc: (env: NodeJS.ProcessEnv) => Thenable<boolean | undefined | "retry">,
		btn: string,
		outdatedCheck?: (log: string) => (boolean | [boolean, string])
	): Promise<boolean | undefined | "retry"> {
		var version = "";

		try {
			version = await this.spawnOneShotCheck(expandTilde(this.settings.get(configName, defaultPath)), ["--version"], true, { cwd: workspace.rootPath });
		} catch (err: any) {
			// for example invalid executable error
			if (err && err.code != "ENOENT")
				console.error(err);

			const fullConfigName = "d." + configName;
			if (btn == "Install" || btn == "Download") btn = "Reinstall";
			const reinstallBtn = btn + " " + name;
			const userSettingsBtn = "Open User Settings";

			let defaultHandler = (s: string | undefined) => {
				if (s == userSettingsBtn) {
					commands.executeCommand("workbench.action.openGlobalSettings");
				} else if (s == reinstallBtn) {
					return installFunc(process.env);
				}
			};

			if (err && err.code == "ENOENT") {
				if (this.settings.aggressiveUpdate && !forced) {
					return installFunc(process.env);
				} else {
					var isDirectory = false;

					try {
						const testPath = this.settings.get(configName, '');
						isDirectory = isAbsolute(testPath) && (await stat(testPath)).isDirectory();
					} catch (e) { }

					if (isDirectory) {
						return window.showErrorMessage(name + " from setting " + fullConfigName + " points to a directory", reinstallBtn, userSettingsBtn).then(defaultHandler);
					} else {
						return window.showErrorMessage(name + " from setting " + fullConfigName + " is not installed or couldn't be found", reinstallBtn, userSettingsBtn).then(defaultHandler);
					}
				}
			} else if (err && err.code == "EACCES") {
				return window.showErrorMessage(name + " from setting " + fullConfigName + " is not marked as executable or is in a non-executable directory.", reinstallBtn, userSettingsBtn).then(defaultHandler);
			} else if (err && err.code) {
				return window.showErrorMessage(name + " from setting " + fullConfigName + " failed executing: " + err.code, reinstallBtn, userSettingsBtn).then(defaultHandler);
			} else if (err) {
				return window.showErrorMessage(name + " from setting " + fullConfigName + " failed executing: " + err, reinstallBtn, userSettingsBtn).then(defaultHandler);
			}

			return false;
		}

		let outdatedResult = outdatedCheck && outdatedCheck(version);
		let isOutdated: boolean = false;
		let msg: string | undefined;

		if (typeof outdatedResult == "boolean") {
			isOutdated = outdatedResult;
		} else if (Array.isArray(outdatedResult)) {
			[isOutdated, msg] = outdatedResult;
		}

		if (isOutdated) {
			if (this.settings.aggressiveUpdate) {
				return await installFunc(process.env);
			} else {
				let s = await window.showErrorMessage(name + " is outdated. " + (msg || ""), btn + " " + name, "Continue Anyway");

				if (s == "Continue Anyway") {
					return false;
				} else if (s == btn + " " + name) {
					return await installFunc(process.env);
				}

				return undefined;
			}
		}

		return false;
	}

	async didChangeReleaseChannel(updated: Thenable<void>) {
		if (this.#started && !this.#reloading) {
			this.#reloading = true;
			await updated;
			commands.executeCommand('workbench.action.reloadWindow');
		} else {
			this.#outdated = true;
		}
	}

	isServedOutdated(current: Release | undefined): (log: string) => (false | [boolean, string]) {
		const globals = this.#globals;

		return (log: string) => {
			if (this.settings.forceUpdateServeD) {
				return [true, "(forced by d.forceUpdateServeD)"];
			}

			if (!current || !current.asset) {
				return false; // network failure or frozen release channel, let's not bother the user
			} else if (current.name == "nightly") {
				let date = new Date(current.asset.created_at);
				let installed = this.#installer.extractServedBuiltDate(log);

				if (!installed) {
					return [true, "(target=nightly, installed=none)"];
				}

				date.setUTCHours(0);
				date.setUTCMinutes(0);
				date.setUTCSeconds(0);

				installed.setUTCHours(12);
				installed.setUTCMinutes(0);
				installed.setUTCSeconds(0);

				return [installed < date, `(target from ${date.toDateString()}, installed ${installed.toDateString()})`];
			}

			const releaseChannel = this.settings.releaseChannel;

			if (globals.serveDDownloadedReleaseChannel && releaseChannel != globals.serveDDownloadedReleaseChannel) {
				return [true, "(target channel=" + releaseChannel + ", installed channel=" + globals.serveDDownloadedReleaseChannel + ")"];
			}

			var m = /serve-d v(\d+\.\d+\.\d+(?:-[-.a-zA-Z0-9]+)?)/.exec(log);
			var target = current.name;

			if (target.startsWith("v")) {
				target = target.substr(1);
			}

			if (m) {
				try {
					return [cmpSemver(m[1], target) < 0, "(target=" + target + ", installed=" + m[1] + ")"];
				} catch (e: any) {
					this.#output.show(true);
					this.#output.appendLine("ERROR: could not compare current serve-d version with release");
					this.#output.appendLine(e.toString());
				}
			}

			return false;
		};
	}

	lockIsStillAcquired(lock: any): boolean {
		return lock && isFinite(parseInt(lock)) && new Date().getTime() - parseInt(lock) < 10000;
	}

	async acquireInstallLock(depName: string): Promise<[boolean, Disposable]> {
		const globals = this.#globals;

		if (this.lockIsStillAcquired(globals.isInstallInProgress(depName))) {
			return [false, new Disposable(() => { })];
		} else {
			globals.setInstallInProgress(depName, new Date().getTime());

			const timer = setInterval(() => {
				globals.setInstallInProgress(depName, new Date().getTime());
			}, 2000);

			return [true, new Disposable(() => {
				globals.setInstallInProgress(depName, false);
				clearInterval(timer);
			})];
		}
	}

	async waitForOtherInstanceInstall(depName: string, forced: boolean, showProgress: boolean = true): Promise<boolean> {
		const context = this.#context;

		// XXX: horrible polling code here because there is no other IPC API for vscode extensions
		const installInProgress = "installInProgress-" + depName;
		var lock = context.globalState.get(installInProgress, undefined);
		if (this.lockIsStillAcquired(lock)) {
			if (forced) {
				let ret = new Promise<boolean>((resolve) => {
					setTimeout(() => {
						resolve(this.waitForOtherInstanceInstall(depName, true, false));
					}, 1000);
				});

				if (showProgress)
					return window.withProgress<boolean>({
						location: ProgressLocation.Window,
						title: "Waiting for other VSCode window installing " + depName + "..."
					}, (progress, token) => ret);
				else
					return ret;
			} else {
				let continueAnyway = "Continue Anyway";
				let wait = "Wait";
				let btn = await window.showWarningMessage("It looks like there is another vscode instance already installing "
					+ depName + ". Click '" + continueAnyway + "' if you are sure there is no other vscode instance installing "
					+ depName + " right now.",
					continueAnyway,
					wait);
				if (!btn || btn == wait) {
					return this.waitForOtherInstanceInstall(depName, true);
				} else if (btn == continueAnyway) {
					return true;
				} else {
					throw new Error("unexpected button");
				}
			}
		}
		return false;
	}

	spawnOneShotCheck(program: string, args: string[], captureOutput: boolean = false, options?: SpawnOptionsWithoutStdio): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = spawn(program, args, options);

			let result = '';
			if (captureOutput) {
				proc.stderr.on('data', chunk => result += chunk);
				proc.stdout.on('data', chunk => result += chunk);
			}

			proc.on('error', err => reject(err));
			proc.on('exit', () => resolve(result));
		});
	}

	hideNextPotentialConfigUpdateWarning() {
		this.#lastConfigUpdateWasInternal = new Date().getTime();
	}

	get context(): ExtensionContext {
		return this.#context;
	}

	get output(): OutputChannel {
		return this.#output;
	}

	get installer(): Installer {
		return this.#installer;
	}

	get settings(): Settings {
		return this.#settings;
	}

	get globals(): Globals {
		return this.#globals;
	}

	get version(): string {
		return this.#version!;
	}

	get served(): ServeD | undefined {
		return this.#served;
	}

	get api(): ServeDCodeDAPI | undefined {
		return this.#api;
	}

	get path(): string {
		return this.#context.extensionPath;
	}

	get subs(): Disposable[] {
		return this.#context.subscriptions;
	}
}

const extension = new Extension();
export default extension;

export type DScannerIniFeature = { description: string, name: string, enabled: "disabled" | "enabled" | "skip-unittest"; };
export type DScannerIniSection = { description: string, name: string, features: DScannerIniFeature[]; };
export interface ActiveDubConfig {
	packagePath: string;
	packageName: string;
	recipePath: string;
	targetPath: string;
	targetName: string;
	workingDirectory: string;
	mainSourceFile: string;

	dflags: string[];
	lflags: string[];
	libs: string[];
	linkerFiles: string[];
	sourceFiles: string[];
	copyFiles: string[];
	versions: string[];
	debugVersions: string[];
	importPaths: string[];
	stringImportPaths: string[];
	importFiles: string[];
	stringImportFiles: string[];
	preGenerateCommands: string[];
	postGenerateCommands: string[];
	preBuildCommands: string[];
	postBuildCommands: string[];
	preRunCommands: string[];
	postRunCommands: string[];
	buildOptions: string[];
	buildRequirements: string[];
	[unstableExtras: string]: any;
};
