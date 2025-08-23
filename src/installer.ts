import { join, basename, extname } from 'node:path';
import { unlink, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import ChildProcess from 'node:child_process';
import type { Readable } from 'node:stream';
import { window, OutputChannel, Progress, CancellationToken, ProgressLocation, commands } from 'vscode';
import type { AxiosResponse } from 'axios';
import { rimraf } from 'rimraf';
import AdmZip from 'adm-zip';
import async from 'async';
import { mkdirp } from 'mkdirp';

import extension from './extension.js';
import { reqJson, reqType, gitPath } from './utils/index.js';


// const installationTitle = 'dlang/serve-d installation progress';
const nightlyReleaseId = 20717582;

const servedVersionCache: { release?: Release, channel: string; } = {
	release: undefined,
	channel: '',
};

export default class Installer {
	installOutput: OutputChannel;

	constructor(installOutput: OutputChannel) {
		this.installOutput = installOutput;
	}

	determineOutputFolder(): string {
		if (process.platform === 'linux' && process.env.HOME) {
			if (existsSync(join(process.env.HOME, '.local', 'share'))) {
				return join(process.env.HOME, '.local', 'share', 'dlang', 'bin');
			} else {
				return join(process.env.HOME, '.dlang', 'bin');
			}
		} else if (process.platform == 'win32' && process.env.APPDATA) {
			return join(process.env.APPDATA, 'dlang', 'bin');
		} else {
			return join(extension.path, 'bin');
		}
	}

	downloadFileInteractive(url: string, title: string, aborted: Function): Thenable<Readable> {
		let progress: Progress<any> | undefined;
		let cancel: CancellationToken | undefined;
		let done: Function | false | undefined;

		let stream = reqType('stream').get<Readable>(url).then((body): Readable => {
			// manually aborting request object because we are consuming a stream, otherwise it would try to "reject" an already resolved promise
			if (cancel) {
				cancel.onCancellationRequested(() => {
					if (!body.request.aborted) {
						body.request.abort();
						aborted();
					}
				});
			} else {
				console.error('failed registering cancel token');
			}

			const len = parseInt(body.headers['Content-Length'] || body.headers['content-length'] || '0');

			if (len == 0) {
				return body.data;
			}

			let totalPercent: number = 0;
			console.log(typeof body.data);
			console.log(body.data.constructor.name);
			console.log(body.data);
			return body.data.on('data', (chunk) => {
				let increment = chunk.length / len;
				totalPercent += increment;
				if (progress) {
					progress.report({
						message: `Downloaded ${(totalPercent * 100).toFixed(2)}%`,
						increment: increment * 100,
					});
				}
			}).on('end', () => {
				if (done) {
					done();
				} else {
					done = false;
				}

				if (this.installOutput) {
					this.installOutput.appendLine('Finished downloading');
				}
			});
		});

		window.withProgress({
			cancellable: true,
			location: ProgressLocation.Notification,
			title: title,
		}, (_progress, _cancel) => {
			progress = _progress;
			cancel = _cancel;
			return new Promise((resolve) => {
				if (done === false) {
					return resolve(undefined);
				} else {
					done = resolve;
				}
			});
		});

		return stream;
	}

	async findLatestServeD(force: boolean = false, channel?: string): Promise<Release | undefined> {
		channel ??= extension.settings.releaseChannel;

		if (channel === 'frozen' && force) {
			channel = 'stable';
		}

		if (channel === 'frozen' || extension.settings.forceCompileServeD) {
			return Promise.resolve(undefined);
		}

		if (servedVersionCache.channel == channel) {
			return Promise.resolve(servedVersionCache.release);
		}

		let randomUpdateReduction = extension.settings.smartServedUpdates;
		if (randomUpdateReduction && channel === 'stable' && !force) {
			if (Math.floor(Math.random() * 4) === 0) {
				// only update approximately every 4th user/time running on stable.
				// Lowers bandwidth and startup delay to check not-so-frequent stable releases
				return Promise.resolve(undefined);
			} else if ((new Date()).getDay() === 5 && Math.floor(Math.random() * 3) === 0) {
				// furthermore reduce updates on fridays
				// avoids breaking peoples workflow right at the end of their work week
				return Promise.resolve(undefined);
			}
		}

		const timeout = force ? 8000 : 3000;

		if (channel === 'nightly') {
			return await this.fetchNightlyRelease(timeout);
		} else if (channel === 'stable' || channel === 'beta') {
			return this.fetchLatestTaggedRelease(channel, timeout);
		} else {
			return Promise.resolve(undefined);
		}
	}

	async fetchNightlyRelease(timeout: number): Promise<Release | undefined> {
		let res: AxiosResponse<{ assets: ReleaseAsset[]; }>;

		try {
			res = await reqJson().get<{ assets: ReleaseAsset[]; }>(`https://api.github.com/repos/Pure-D/serve-d/releases/${nightlyReleaseId}`, {
				headers: { 'User-Agent': 'https://github.com/Pure-D/code-d' },
				timeout: timeout,
			});
		} catch (e) {
			console.error('Error fetching nightly code-d release: ', e);
			return undefined;
		}

		const body = res.data;

		if (typeof body !== 'object') {
			return undefined;
		}

		const assets = body.assets;

		// reverse sort (largest date first)
		assets.sort((a, b) => b.name.localeCompare(a.name));

		const targetAsset = this.findFirstMatchingAsset('nightly', assets);
		const ret: Release = {
			name: 'nightly',
			asset: targetAsset
		};

		servedVersionCache.release = ret;
		servedVersionCache.channel = 'nightly';
		return ret;
	}

	async fetchLatestTaggedRelease(channel: 'stable' | 'beta', timeout: number): Promise<Release | undefined> {
		let res: AxiosResponse<any>;

		try {
			res = await reqJson().get('https://api.github.com/repos/Pure-D/serve-d/releases', {
				headers: { 'User-Agent': 'https://github.com/Pure-D/code-d' },
				timeout: timeout,
			});
		} catch (e) {
			console.error('Error fetching nightly code-d release: ', e);
			return undefined;
		}

		const body = res.data;

		if (!Array.isArray(body)) {
			return undefined;
		}

		let numMatching = 0;

		const ret: Release = {
			name: 'master'
		};

		for (let i = 0; i < body.length; i++) {
			const release = body[i];

			if (release.id === nightlyReleaseId) {
				continue;
			}

			if (channel === 'stable' && release.prerelease) {
				continue;
			}

			const targetAsset = this.findFirstMatchingAsset(release.tag_name, release.assets);

			if (!targetAsset) {
				if (ret.name === 'master') {
					ret.name = release.tag_name;
				}
			} else {
				ret.name = release.tag_name;
				ret.asset = targetAsset;
				break;
			}

			// search last 3 releases for binaries
			if (numMatching++ >= 3) {
				break;
			}
		}

		servedVersionCache.release = ret;
		servedVersionCache.channel = channel!;
		return ret;
	}

	getSystemArch(): string {
		if (process.arch === 'x64') {
			return 'x86_64';
		} else if (process.arch === 'ia32') {
			if (process.platform === 'win32') {
				// we might be on WOW:
				// https://ss64.com/nt/syntax-64bit.html
				// https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-system_info
				if (process.env.PROCESSOR_ARCHITEW6432 === 'AMD64' || process.env.PROCESSOR_ARCHITEW6432 === 'IA64') {
					return 'x86_64';
				} else if (process.env.PROCESSOR_ARCHITECTURE === 'ARM64') {
					return 'arm64';
				} else if (process.env.PROCESSOR_ARCHITECTURE === 'ARM') {
					return 'arm';
				} else {
					return 'x86';
				}
			} else {
				return 'x86';
			}
		} else {
			return process.arch;
		}
	}

	findFirstMatchingAsset(name: string | 'nightly', assets: ReleaseAsset[]): ReleaseAsset | undefined {
		let os = <string>process.platform;
		let arch = this.getSystemArch();

		if (os === 'win32') {
			os = 'windows';
		} else if (os === 'darwin') {
			os = 'osx';
		}

		if (name === 'nightly') {
			for (let i = 0; i < assets.length; i++) {
				const asset = assets[i];
				let test = asset.name;

				if (test.startsWith('serve-d')) {
					test = test.substring('serve-d'.length);
				}

				if (test.startsWith('-') || test.startsWith('_')) {
					test = test.substring(1);
				}

				if (!test.startsWith(os)) {
					continue;
				}

				test = test.substring(os.length);

				if (test.startsWith('-') || test.startsWith('_')) {
					test = test.substring(1);
				}

				if (test.startsWith('nightly')) {
					test = test.substring('nightly'.length);
				}

				if (test.startsWith('-') || test.startsWith('_')) {
					test = test.substring(1);
				}

				// remaining:
				// either x86_64-20191017-4b5427.tar.xz
				// or (platformless) 20191017-4b5427.tar.xz
				if (test.startsWith(arch) || test.startsWith('2')) { // 2 for 2019 and the next 980 years of support, indicating no architecture (windows)
					return asset;
				}
			}
			return undefined;
		} else {
			if (name.startsWith('v')) {
				name = name.substring(1);
			}

			for (let i = 0; i < assets.length; i++) {
				const asset = assets[i];
				let test = asset.name;

				if (test.startsWith('serve-d')) {
					test = test.substring('serve-d'.length);
				}

				if (test.startsWith('-') || test.startsWith('_')) {
					test = test.substring(1);
				}

				if (test.startsWith(name)) {
					test = test.substring(name.length);
				}

				if (test.startsWith('-') || test.startsWith('_')) {
					test = test.substring(1);
				}

				const dot = test.indexOf('.');

				if (dot !== -1) {
					test = test.substring(0, dot);
				}

				if (test === `${os}-${arch}` || test === os) {
					return asset;
				}
			}

			return undefined;
		}
	}

	updateAndInstallServeD(env: any): Thenable<boolean | undefined | 'retry'> {
		return window.withProgress({
			location: ProgressLocation.Notification,
			title: 'Searching for updates...',
		}, async (progress, token) => {
			const version = await this.findLatestServeD(true);
			if (version === undefined) {
				const compile = 'Compile';
				const userSettings = 'Open User Settings';
				const message = 'Updates can currently not be determined. Would you like to try and compile serve-d from source or specify a path to the serve-d executable in your user settings?';
				const option = await window.showInformationMessage(message, compile, userSettings);

				if (option === compile) {
					return this.compileServeD('master')(env);
				} else if (userSettings) {
					return commands.executeCommand('workbench.action.openGlobalSettings');
				}
			} else if (!version.asset || extension.settings.forceCompileServeD) {
				return this.compileServeD('master')(env);
			} else {
				return this.installServeD([{ url: version.asset.browser_download_url, title: 'Serve-D' }], version.name)(env);
			}
		});
	}

	installServeD(urls: { url: string, title: string; }[], ref: string): (env: NodeJS.ProcessEnv) => Promise<boolean | undefined | 'retry'> {
		if (urls.length == 0) {
			return async (env: any) => {
				const compileItem = 'Compile from source';

				const message = 'No precompiled serve-d binary for this platform/architecture';
				const option = await window.showErrorMessage(message, compileItem);

				if (option === compileItem) {
					return this.compileServeD(ref)(env);
				}
			};
		}

		// add DCD binaries here as well
		if (process.platform == 'linux' && process.arch == 'x64') {
			urls.push({ url: 'https://github.com/dlang-community/DCD/releases/download/v0.15.2/dcd-v0.15.2-linux-x86_64.tar.gz', title: 'DCD' });
		} else if (process.platform == 'darwin' && process.arch == 'x64') {
			urls.push({ url: 'https://github.com/dlang-community/DCD/releases/download/v0.15.2/dcd-v0.15.2-osx-x86_64.tar.gz', title: 'DCD' });
		} else if (process.platform == 'darwin' && process.arch == 'arm64') {
			urls.push({ url: 'https://github.com/dlang-community/DCD/releases/download/v0.15.2/dcd-v0.15.2-osx-arm64.tar.gz', title: 'DCD' });
		} else if (process.platform == 'win32') {
			if (process.arch == 'x64') {
				urls.push({ url: 'https://github.com/dlang-community/DCD/releases/download/v0.15.2/dcd-v0.15.2-windows-x86_64.zip', title: 'DCD' });
			} else {
				urls.push({ url: 'https://github.com/dlang-community/DCD/releases/download/v0.15.2/dcd-v0.15.2-windows-x86.zip', title: 'DCD' });
			}
		}

		return async (env: any): Promise<boolean | undefined | 'retry'> => {
			this.installOutput.show(true);

			var outputFolder = this.determineOutputFolder();
			mkdirp.sync(outputFolder);
			var finalDestination = join(outputFolder, `serve-d${process.platform == 'win32' ? '.exe' : ''}`);
			this.installOutput.appendLine(`Installing into ${outputFolder}`);

			if (!existsSync(outputFolder)) {
				mkdirSync(outputFolder);
			}

			if (existsSync(finalDestination)) {
				rimraf.sync(finalDestination);
			}

			try {
				await Promise.all(urls.map(({ url, title }) => {
					return this.installServeDEntry(outputFolder, url, title);
				}));
			} catch (err) {
				let r: string | undefined = await window.showErrorMessage('Failed to download release', 'Compile from source');

				if (r === 'Compile from source') {
					return this.compileServeD(ref)(env);
				} else {
					return undefined;
				}
			}

			extension.hideNextPotentialConfigUpdateWarning();
			await extension.settings.setServedPath(finalDestination, true);
			this.installOutput.appendLine(`Finished installing into ${finalDestination}`);
		};
	}

	async installServeDEntry(outputFolder: string, url: string, title: string) {
		this.installOutput.appendLine(`Downloading from ${url} into ${outputFolder}`);

		let ext: string;
		if (url.endsWith('.tar.xz')) {
			ext = '.tar.xz';
		} else if (url.endsWith('.tar.gz')) {
			ext = '.tar.gz';
		} else {
			ext = extname(url);
		}

		var fileName = basename(url);
		var outputPath = join(outputFolder, fileName);
		let aborted = false;

		let stream = await this.downloadFileInteractive(url, `${title} Download`, () => {
			aborted = true;
			this.installOutput.appendLine('Aborted download');
			unlink(outputPath, () => { });
		});

		stream.pipe(createWriteStream(outputPath)).on('finish', () => {
			if (aborted) {
				return;
			}

			this.installOutput.appendLine(`Extracting ${fileName}`);

			if (ext === '.zip') {
				try {
					new AdmZip(outputPath).extractAllTo(outputFolder);

					try {
						this.installOutput.appendLine(`Deleting ${outputPath}`);
						unlink(outputPath, (err) => {
							if (err) {
								this.installOutput.appendLine(`Failed to delete ${outputPath}`);
							}
						});
					} catch (e) {
						window.showErrorMessage(`Failed to delete temporary file: ${outputPath}`);
					}

					return;
				} catch (e) {
					throw e;
				}
			} else if (ext == '.tar.xz' || ext == '.tar.gz') {
				var mod = ext == '.tar.xz' ? 'J' : 'z';
				this.installOutput.appendLine(`> tar xvf${mod} ${fileName}`);
				ChildProcess.spawn('tar', [`xvf${mod}`, fileName], {
					cwd: outputFolder
				}).on('exit', (code) => {
					if (code != 0) {
						throw code;
					}

					try {
						this.installOutput.appendLine(`Deleting ${outputPath}`);
						unlink(outputPath, (err) => {
							if (err) {
								this.installOutput.appendLine(`Failed to delete ${outputPath}`);
							}
						});
					} catch (e) {
						window.showErrorMessage(`Failed to delete temporary file: ${outputPath}`);
					}

					return;
				});
			}
		});
	}

	extractServedBuiltDate(log: string): Date | false {
		var parsed = /Built: \w+\s+(\w+)\s+(\d+)\s+(\d+:\d+:\d+)\s+(\d+)/.exec(log);

		if (!parsed) {
			return false;
		}

		var month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(parsed[1].toLowerCase());

		if (month < 0) {
			return false;
		}

		var date = parseInt(parsed[2]);
		var parts = parsed[3].split(':');
		var year = parseInt(parsed[4]);
		var hour = parseInt(parts[0]);
		var minute = parseInt(parts[1]);
		var second = parseInt(parts[2]);

		if (isNaN(year) || isNaN(date) || isNaN(hour) || isNaN(minute) || isNaN(second)) {
			return false;
		}

		return new Date(Date.UTC(year, month, date, hour, minute, second));
	}

	compileServeD(ref?: string): (env: NodeJS.ProcessEnv) => Promise<boolean | undefined | 'retry'> {
		return async (env: any): Promise<boolean | undefined | 'retry'> => {
			var outputFolder = this.determineOutputFolder();
			mkdirp.sync(outputFolder);

			const dubPath = extension.settings.dubPath;
			const dmdPath = extension.settings.dmdPath;
			const dubCompiler = extension.settings.dubCompiler;

			env['DFLAGS'] = '-O -release';
			let buildArgs = ['build'];

			if (process.platform == 'win32') {
				env['DFLAGS'] = '-release';
				buildArgs.push('--arch=x86_mscoff');
			}

			if (dubCompiler) {
				buildArgs.push(`--compiler=${dubCompiler}`);
			} else if (dubPath !== 'dub' && dmdPath) {
				// explicit dub path specified, it won't automatically find dmd if it's not in the same folder so we just pass the path if we have it
				buildArgs.push(`--compiler=${dmdPath}`);
			}

			await this.compileDependency(outputFolder, 'serve-d', 'https://github.com/Pure-D/serve-d.git', [
				[dubPath, buildArgs]
			], env, ref);

			var finalDestination = join(outputFolder, 'serve-d', `serve-d${process.platform == 'win32' ? '.exe' : ''}`);

			extension.hideNextPotentialConfigUpdateWarning();
			await extension.settings.setServedPath(finalDestination, true);
			return true;
		};
	}

	spawnCommand(cmd: string, args: string[], options: ChildProcess.SpawnOptions, cb: Function, onLog?: Function) {
		const log = (chunk: any) => {
			var dat = chunk.toString() ?? 'null';
			this.installOutput.append(dat);
			if (typeof onLog === 'function') {
				onLog(dat);
			}
		};

		this.installOutput.appendLine(`> ${cmd} ${args.join(' ')}`);

		try {
			var proc = ChildProcess.spawn(cmd, args, options);

			if (proc.stdout) {
				proc.stdout.on('data', log);
			}

			if (proc.stderr) {
				proc.stderr.on('data', log);
			}

			proc.on('error', (error: any) => {
				if (((error ? error.message : '').toString()).endsWith('ENOENT')) {
					this.installOutput.appendLine(`The program '${cmd}' could not be found! Did you perhaps not install it or misconfigure some path?`);
				} else {
					this.installOutput.appendLine(`An internal error occured while running the command: ${error}`);
				}
				cb(-1);
			});

			proc.on('exit', function (d: any) {
				return cb(typeof d === 'number' ? d : (d.code || -1));
			});
		} catch (e) {
			this.installOutput.appendLine(`An internal error occured while running the command: ${e}`);
			cb(-2);
		}
	}

	compileDependency(cwd: string, name: string, gitURI: string, commands: [string, string[]][], env: any, ref?: string): Promise<any> {
		return new Promise<void>((resolve, reject) => {
			this.installOutput.show(true);
			this.installOutput.appendLine(`Installing into ${cwd}`);

			const error = (err: any) => {
				this.installOutput.appendLine(`Failed to install ${name} (Error code ${err})`);
			};

			var newCwd = join(cwd, name);
			var startCompile = async () => {
				const git = gitPath();
				this.spawnCommand(git, ['clone', '--recursive', gitURI, name], { cwd: cwd, env: env }, (err: any) => {
					if (err !== 0) {
						return error(err);
					}

					if (ref) {
						commands.unshift([git, ['checkout', ref]]);
					}

					async.eachSeries(commands, (command: [string, string[]], cb: Function) => {
						var failedArch = false;
						var prevLog = '';
						this.spawnCommand(command[0], command[1], {
							cwd: newCwd
						}, (err: any) => {
							var index = command[1].indexOf('--arch=x86_mscoff'); // must be this format for it to work
							if (err && failedArch && command[0] === 'dub' && index !== -1) {
								// failed because we tried to build with x86_mscoff but it wasn't available (LDC was probably used)
								// try again with x86
								command[1][index] = '--arch=x86';
								this.installOutput.appendLine('Retrying with --arch=x86...');
								this.spawnCommand(command[0], command[1], {
									cwd: newCwd
								}, function (err: any) {
									cb(err);
								});
							} else {
								cb(err);
							}
						}, (log: string) => {
							// concat with previous log just to make it very unlikely to split in middle because of buffering
							if ((prevLog + log).toLowerCase().indexOf('unsupported architecture: x86_mscoff') != -1) {
								failedArch = true;
							}
							prevLog = log;
						});
					}, (err: any) => {
						if (err) {
							return error(err);
						}
						this.installOutput.appendLine('Done compiling');
						resolve();
					});
				});
			};

			if (existsSync(newCwd)) {
				this.installOutput.appendLine('Removing old version');
				rimraf(newCwd).then(e => {
					if (e) {
						this.installOutput.appendLine(e.toString());
					}

					this.installOutput.appendLine('Removed old version');
					startCompile();
				});
			} else {
				startCompile();
			}
		});
	}
}

export interface ReleaseAsset {
	id: number;
	name: string;
	size: number;
	download_count: number;
	browser_download_url: string;
	created_at: string;
}

export interface Release {
	name: string;
	asset?: ReleaseAsset;
}
