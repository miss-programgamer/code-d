import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { window, workspace, tasks, commands, env, Uri, Task, ShellExecution, ViewColumn, ShellQuoting, TaskScope, QuickPickItem, type ShellQuotedString, TextEditor, TextEditorEdit } from 'vscode';

import { DubDependency } from './dub/view.js';
import { showProjectCreator, performTemplateCopy, openFolderWithExtension } from './project-creator.js';
import { showDpldocsSearch } from './dpldocs.js';
import { bytesToString, hasAnyExtension } from './utils/index.js';

import extension, { ActiveDubConfig } from './extension.js';


export async function registerCommands() {
	const globals = extension.globals;

	commands.executeCommand('setContext', 'd.isActive', true);

	extension.subs.push(commands.registerCommand('code-d.createProject', showProjectCreator));

	extension.subs.push(commands.registerCommand('code-d.getActiveDubPackageName', withProject(project => project.packageName)));
	extension.subs.push(commands.registerCommand('code-d.getActiveDubPackagePath', withProject(project => project.packagePath)));
	extension.subs.push(commands.registerCommand('code-d.getActiveDubWorkingDirectory', withProject(project => join(project.packagePath, project.workingDirectory))));
	extension.subs.push(commands.registerCommand('code-d.getActiveDubTarget', withProject(project => join(project.targetPath, project.targetName))));
	extension.subs.push(commands.registerCommand('code-d.getActiveDubTargetPath', withProject(project => project.targetPath)));
	extension.subs.push(commands.registerCommand('code-d.getActiveDubTargetName', withProject(project => project.targetName)));

	extension.subs.push(commands.registerCommand('code-d.rdmdCurrent', rdmdCurrentCommand));
	extension.subs.push(commands.registerCommand('code-d.viewDubPackage', viewDubPackageCommand));
	extension.subs.push(commands.registerCommand('code-d.openDependencyFile', openDependencyFileCommand));
	extension.subs.push(commands.registerCommand('code-d.openDubRecipe', openDubRecipeCommand));
	extension.subs.push(commands.registerCommand('code-d.openDubOnDpldocs', openDubOnDpldocsCommand));
	extension.subs.push(commands.registerCommand('code-d.listDubPackageDocuments', createProjectCommand));
	extension.subs.push(commands.registerCommand('code-d.searchDocs', searchDocsCommand));
	extension.subs.push(commands.registerCommand('code-d.viewUserGuide', viewUserGuideCommand));

	extension.subs.push(commands.registerTextEditorCommand('code-d.openDocsAtCursor', openDocsAtCursorCommand));

	if (globals.createTemplate) {
		const id = globals.createTemplate;
		await globals.setCreateTemplate(undefined);

		const filename = join(extension.path, 'templates', 'info.json');
		const templates = JSON.parse((await readFile(filename)).toString());

		for (const template of templates) {
			if (template.path === id) {
				if (workspace.workspaceFolders == null) {
					return window.showErrorMessage('No workspace folder open');
				}

				const path = workspace.workspaceFolders[0].uri.path;
				const files = await readdir(path);

				if (files.length == 0) {
					performTemplateCopy(id, template.dub, path, () => {
						commands.executeCommand('workbench.action.reloadWindow');
					});
				} else {
					const result = await window.showWarningMessage(
						'The current workspace is not empty!',
						{ title: 'Select other Folder', id: 'other' },
						{ title: 'Merge into Folder', id: 'merge' }
					);

					switch (result?.id) {
						case 'other':
							await globals.setCreateTemplate(id);
							openFolderWithExtension();
							break;

						case 'merge':
							performTemplateCopy(id, template.dub, path, () => {
								commands.executeCommand('workbench.action.reloadWindow');
							});
							break;
					}
				}

				return undefined;
			}
		}

		return undefined;
	}
}

async function rdmdCurrentCommand(file?: Uri) {
	if (window.activeTextEditor == null) {
		return window.showErrorMessage('No text editor active');
	}

	const doc = window.activeTextEditor.document;

	if (file == null && doc.isDirty && !doc.isUntitled) {
		const btnSave = 'Save file';
		const btnDisk = 'Run from disk';
		const btnCancel = 'Abort';

		let choice;

		if (extension.settings.get('files.autoSave') !== 'off') {
			choice = btnSave;
		} else {
			choice = await window.showWarningMessage('The file is not saved, do you want to proceed?', btnSave, btnDisk, btnCancel);
		}

		switch (choice) {
			case btnSave:
				if (!await window.activeTextEditor.document.save()) {
					window.showErrorMessage('Aborting RDMD run because save failed');
					return;
				}
				break;

			case btnDisk:
				break;

			case btnCancel:
				return;

			default:
				return;
		}
	}

	file ??= (doc.isUntitled ? undefined : doc.uri);

	const args: ShellQuotedString[] = [{
		value: file?.fsPath ?? `--eval=${doc.getText()}`,
		quoting: ShellQuoting.Strong,
	}];

	const cwd = file != null ? dirname(file.fsPath) : workspace.workspaceFolders != null ? workspace.workspaceFolders[0].uri.fsPath : undefined;
	const shell = new ShellExecution({ value: 'rdmd', quoting: ShellQuoting.Strong }, args, { cwd: cwd });

	var evalCounter = 0;
	const task = new Task({ type: 'rdmd', }, TaskScope.Workspace, `RDMD ${file || (`eval code ${++evalCounter}`)}`, 'dlang', shell);
	task.isBackground = false;
	task.presentationOptions = { echo: file != null };

	await tasks.executeTask(task);
}

function viewDubPackageCommand(root: string, packageName?: string) {
	const dependencyClickBehavior = extension.settings.dependencyClickBehavior;

	switch (dependencyClickBehavior) {
		case 'listDocumentsPreview':
		case 'listDocumentsSource':
		case 'listDocumentsBoth':
			commands.executeCommand('code-d.listDubPackageDocuments', dependencyClickBehavior, root, packageName);
			break;

		case 'openRecipe':
			commands.executeCommand('code-d.openDubRecipe', root);
			break;

		case 'openDpldocs':
			commands.executeCommand('code-d.openDubOnDpldocs', root);
			break;

		case 'doNothing':
			break;

		case 'openFileDialog':
			commands.executeCommand('code-d.openDependencyFile', root);
			break;

		default:
			window.showErrorMessage(`Unknown d.dependencyClickBehavior setting: ${JSON.stringify(dependencyClickBehavior)}`);
			break;
	}
}

async function openDependencyFileCommand(root: string | DubDependency | undefined) {
	if (root instanceof DubDependency) {
		root = root.info?.path;
	}

	if (root != null) {
		const uris = await window.showOpenDialog({
			defaultUri: Uri.file(root),
			canSelectMany: true
		});

		for (const uri of uris ?? []) {
			window.showTextDocument(uri);
		}
	}
}

const recipeFilenames = ['dub.sdl', 'dub.json', 'package.json'];

async function openDubRecipeCommand(root: string | DubDependency | undefined) {
	function showError() {
		if (root instanceof DubDependency) {
			window.showErrorMessage('No recipe found');
		}
	};

	if (root instanceof DubDependency) {
		root = root.info?.path;
	}

	if (root == null) {
		return showError();
	}

	for (const recipe of recipeFilenames.map(r => join(root, r))) {
		if ((await stat(recipe)).isFile()) {
			commands.executeCommand('vscode.open', Uri.file(recipe));
			return;
		}
	}

	showError();
}

async function openDubOnDpldocsCommand(root: DubDependency) {
	function showError() {
		if (root instanceof DubDependency) {
			window.showErrorMessage('Could not determine package name');
		}
	}

	let name = root?.info?.name;
	let version = root?.info?.version;

	if (name == null) {
		return showError();
	}

	const colonIdx = name.indexOf(':');
	if (colonIdx !== -1) {
		name = name.substr(0, colonIdx); // strip subpackage
		version = undefined; // versions are invalid for subpackages
	}

	if (version != null) {
		env.openExternal(Uri.parse(`https://${name}.dpldocs.info/v${version}/`));
	} else {
		env.openExternal(Uri.parse(`https://${name}.dpldocs.info/`));
	}
}

type CreateProjectBehavior = DubDependency | 'listDocumentsPreview' | 'listDocumentsSource' | 'listDocumentsBoth';

async function createProjectCommand(behavior: CreateProjectBehavior, root?: string, packageName?: string) {
	const explicit = behavior instanceof DubDependency;

	async function showError(force: boolean = false) {
		if (explicit || force) {
			if (root) {
				const browseBtn = 'Browse Files';
				const openRecipe = 'Open Recipe';

				const btn = await window.showErrorMessage('No viewable files found.', browseBtn, openRecipe);

				if (btn == browseBtn) {
					commands.executeCommand('code-d.openDependencyFile', root);
				} else if (btn == openRecipe) {
					commands.executeCommand('code-d.openDubRecipe', root);
				}
			} else {
				window.showErrorMessage('No viewable files found.');
			}
		}
	}

	if (behavior instanceof DubDependency) {
		root = behavior.info?.path!;
		packageName = behavior.info?.name;
		behavior = 'listDocumentsBoth';

		if (root == null) {
			return await showError();
		}
	}

	// preview + view source if behavior is invalid value
	const doPreview = behavior !== 'listDocumentsSource';
	const doViewSource = behavior !== 'listDocumentsPreview';

	if (root) {
		const entries = await readdir(root, { withFileTypes: true });
		const filenames = entries.filter(e => e.isFile()).map(e => e.name);

		const readmes = filenames.filter(filename => {
			filename = filename.toLowerCase();
			const filter = extension.settings.dependencyTextDocumentFilter;

			for (let i = 0; i < filter.length; i++) {
				if (new RegExp(filter[i], 'i').exec(filename)) {
					return true;
				}
			}

			return false;
		});

		if (!readmes.length) {
			return await showError(true);
		}

		readmes.sort();
		readmes.reverse(); // README > LICENSE > CHANGELOG

		const items: (QuickPickItem & { args: [string, boolean]; })[] = [];

		for (let i = 0; i < readmes.length; i++) {
			let previewable = isReadmePreviewable(readmes[i]);

			if (doPreview || !previewable) {
				items.push({
					label: readmes[i],
					description: getPreviewDescription(readmes[i]),
					args: [readmes[i], true]
				});
			}

			if (!(doPreview || !previewable) || doViewSource && previewable) {
				items.push({
					label: readmes[i],
					description: '$(file-code) source',
					args: [readmes[i], false]
				});
			}
		}

		let args: [string, boolean] | undefined;

		if (items.length == 1) {
			args = items[0].args;
		} else {
			args = (await window.showQuickPick(items, {
				placeHolder: 'Select file to show',
			}))?.args;
		}

		if (args != null) {
			let readme = join(root!, args[0]);
			let uri = Uri.file(readme);
			await previewReadme(Uri.file(root!), uri, args[1], packageName);
		}
	} else {
		await showError();
	}
}

/**
 * Open a search prompt to the DPL docs, using the current editor selection by default.
 */
function searchDocsCommand() {
	const editor = window.activeTextEditor;
	showDpldocsSearch(editor?.document.getText(editor.selection) ?? '');
}

/**
 * Open a markdown preview of the user guide.
 */
function viewUserGuideCommand() {
	const file = Uri.file(extension.context.asAbsolutePath('docs/index.md'));
	return commands.executeCommand('markdown.showPreview', file, { locked: true });
}

const multiTokenWordPattern = /[^\`\~\!\@\#\%\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+(?:\.[^\`\~\!\@\#\%\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)*/;

function openDocsAtCursorCommand(editor: TextEditor, _edit: TextEditorEdit) {
	// TODO: we can probably add local ddoc rendering if we can jump to the symbol anyway
	var query = '';
	if (editor.selection.isEmpty) {
		const range = editor.document.getWordRangeAtPosition(editor.selection.active, multiTokenWordPattern);
		if (range) {
			showDpldocsSearch(editor.document.getText(range), true);
		} else {
			showDpldocsSearch('');
		}
	} else {
		showDpldocsSearch(editor.document.getText(editor.selection), true);
	}
}

/**
 * Create a closure that invokes a given callback, providing it with the
 * current active config in the process.
 * 
 * intended to be used in conjunction with `vscode.commands.registerCommand`.
 * 
 * @param fn Callback invoked by the returned closure.
 * @returns A closure that wraps the given callback.
 */
function withProject<R, T, A extends any[]>(fn: (this: T, project: ActiveDubConfig, ...args: A) => R | Promise<R>): (this: T, ...args: A) => Promise<R> {
	return async function (this: T, ...args: A): Promise<R> {
		if (extension.served != null) {
			const project = await extension.served.getActiveDubConfig();
			return fn.apply(this, [project, ...args]);
		} else {
			throw new Error('Can\'t read DUB configs because serve-d is not yet started.');
		}
	};
}

/**
 * Preview a given package's README file, supporting some common extensions.
 * 
 * @param dir Containing directory of the README file to preview.
 * @param uri Path to the README file to preview.
 * @param richPreview If `false`, opens a simple text editor for file types.
 * @param packageName The package name, for displaying in the tab title.
 */
async function previewReadme(dir: Uri, uri: Uri, richPreview: boolean, packageName?: string) {
	/*
		README breakdown from 2022-01-08 out of all available dub packages:

		[filename]             [packages on dub]
		README.md              1958
		README                 31
		README.rst             16
		README.markdown        13
		readme.org             11
		readme.txt             7
		README.html            7
		readme.adoc            3
		README.EN              3
		README.ja.md           3
		README.RU              3
		README-ja.md           2
		readme-resources       2
		Readme_APILookup       1
		readme_screenshot.png  1
		README_zh_CN.md        1
		README-SDL.txt         1
		README-SDL2_Image.txt  1
		README-SDL2_ttf.txt    1
		README.cn.md           1
		readme.drawio.svg      1
		README.md.dj           1
		README.testing.md      1

		Based on that I'm currently supporting:
		- Markdown preview (builtin vscode extension)
		- HTML (vscode web view)
		- rst (needs lextudio.restructuredtext or tht13.rst-vscode installed)
		- fallback (default vscode editor)
	*/

	if (!richPreview) {
		await window.showTextDocument(uri);
		return;
	}

	switch (extname(uri.path).toLowerCase()) {
		case '.md':
		case '.markdown':
			commands.executeCommand('markdown.showPreview', uri, { locked: true });
			break;

		case '.htm':
		case '.html':
			const title = (packageName != null ? `${packageName} ` : '') + basename(uri.path);
			const panel = window.createWebviewPanel('dubReadme', title, ViewColumn.Active, {
				enableCommandUris: false,
				enableFindWidget: true,
				enableScripts: false,
				localResourceRoots: [dir],
				retainContextWhenHidden: false
			});
			const bytes = await workspace.fs.readFile(uri);
			panel.webview.html = bytesToString(bytes);
			break;

		case '.rst':
			if (hasAnyExtension('lextudio.restructuredtext')) {
				commands.executeCommand('restructuredtext.showPreview', uri);
			} else if (hasAnyExtension('tht13.rst-vscode')) {
				commands.executeCommand('rst.showPreview', uri);
			} else {
				window.showTextDocument(uri);
			}
			break;

		default:
			window.showTextDocument(uri);
			break;
	}
}

function getPreviewDescription(filename: string): string | undefined {
	switch (extname(filename).toLowerCase()) {
		case '.md':
		case '.markdown':
			return '$(markdown) preview';

		case '.html':
		case '.htm':
			return '$(preview) preview';

		case '.rst':
			if (hasAnyExtension('lextudio.restructuredtext', 'tht13.rst-vscode')) {
				return '$(preview) preview';
			} else {
				return '(plain text, missing RST extension)';
			}

		default:
			return undefined;
	}
}

function isReadmePreviewable(filename: string): boolean {
	switch (extname(filename).toLowerCase()) {
		case '.md':
		case '.markdown':
		case '.html':
		case '.htm':
			return true;

		case '.rst':
			return hasAnyExtension('lextudio.restructuredtext', 'tht13.rst-vscode');

		default:
			return false;
	}
}
