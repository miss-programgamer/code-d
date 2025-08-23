import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { commands, window, workspace } from 'vscode';
import { default as ncpSync } from 'ncp';

import extension from './extension.js';


const ncp = promisify(ncpSync);

export async function getTemplates(): Promise<Template[]> {
	const data = await readFile(join(extension.path, 'templates', 'info.json'));
	var templates: any[] = JSON.parse(data.toString());
	var result: Template[] = [];

	templates.forEach((template: any) => {
		result.push({
			label: template.name,
			description: '',
			detail: template.detail,
			id: template.path,
			json: template.dub
		});
	});

	return result;
}

export async function showProjectCreator(): Promise<void> {
	const template = await window.showQuickPick(await getTemplates(), {
		ignoreFocusOut: true,
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (!template) {
		return undefined;
	}

	if (workspace.workspaceFolders == null || workspace.workspaceFolders.length === 0) {
		const message = 'Select an empty folder to create the project in';
		const result = await window.showInformationMessage(message, 'Select Folder');

		if (result === 'Select Folder') {
			await extension.globals.setCreateTemplate(template.id);
			await openFolderWithExtension();
		}

		return;
	}

	const path = workspace.workspaceFolders[0].uri.fsPath;
	const files = await readdir(path);

	if (files.length === 0) {
		return performTemplateCopy(template.id, template.json, path, () => {
			commands.executeCommand('workbench.action.reloadWindow');
		});
	} else {
		const selectOtherFolder = 'Select other Folder';
		const mergeIntoFolder = 'Merge into Folder';

		const message = 'The current workspace is not empty!';
		const selected = await window.showWarningMessage(message, selectOtherFolder, mergeIntoFolder);

		if (selected === selectOtherFolder) {
			await extension.globals.setCreateTemplate(template.id);
			await openFolderWithExtension();
		} else if (selected === mergeIntoFolder) {
			return performTemplateCopy(template.id, template.json, path, () => {
				commands.executeCommand('workbench.action.reloadWindow');
			});
		}
	}
}

export async function openFolderWithExtension() {
	try {
		const pkgPath = join(extension.path, 'package.json');
		const content = (await readFile(pkgPath)).toString();

		await writeFile(`${pkgPath}.bak`, content);
		await extension.globals.setRestorePackageBackup(true);

		const json = JSON.parse(content);
		json.activationEvents = ['*'];
		await writeFile(pkgPath, JSON.stringify(json));

		commands.executeCommand('vscode.openFolder');
	} catch (err) {
		const message = 'Failed to reload. Reload manually and run some code-d command!';
		return window.showErrorMessage(message);
	}
}

export async function restoreCreateProjectPackageBackup(): Promise<boolean | undefined> {
	if (extension.globals.restorePackageBackup) {
		await extension.globals.setRestorePackageBackup(false);

		try {
			const pkgPath = join(extension.path, 'package.json');
			const content = (await readFile(`${pkgPath}.bak`)).toString();
			await writeFile(pkgPath, content);
			await unlink(`${pkgPath}.bak`);
			return true;
		} catch (err) {
			const message = 'Failed to restore after reload! Please reinstall code-d if problems occur before reporting!';
			await window.showErrorMessage(message);
			return false;
		}
	}
}

export async function performTemplateCopy<R>(templateName: string, dubJson: any, resultPath: string, callback: () => R | Thenable<R>): Promise<R | void> {
	dubJson['name'] = createDubName(basename(resultPath));

	try {
		const templatePath = join(extension.path, 'templates', templateName);
		await ncp(templatePath, resultPath, { clobber: false });
	} catch (err) {
		console.error(err);
		await window.showErrorMessage('Failed to copy template');
		return;
	}

	try {
		const filename = join(resultPath, 'dub.json');
		await writeFile(filename, JSON.stringify(dubJson, null, '\t'));
	} catch (err) {
		console.log(err);
		await window.showErrorMessage('Failed to generate dub.json');
		return;
	}

	return callback();
}

export interface Template {
	label: string;
	description: string;
	detail: string;
	id: string;
	json: JSON;
}

function createDubName(folderName: string) {
	let res = folderName[0].toLowerCase();

	for (const c of folderName.substring(1)) {
		if (c === c.toUpperCase() && c !== c.toLowerCase()) {
			res += '-';
			res += c.toLowerCase();
		} else {
			res += c;
		}
	}

	return res
		.replace(/[^a-z0-9_]+/g, '-')
		.replace(/^-|-$/g, '');
}
