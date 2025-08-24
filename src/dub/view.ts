import { TreeItem, Command, Uri, TreeItemCollapsibleState } from 'vscode';

import extension from '../extension.js';


export class DubDependency extends TreeItem {
	info?: DubDependencyInfo;
	command?: Command = undefined;

	constructor(info: DubDependencyInfo, command?: Command, icon?: string);
	constructor(info: string, command?: Command, icon?: string);
	constructor(info: DubDependencyInfo | string, command?: Command, icon?: string) {
		super(dependencyLabel(info), dependencyCollapse(info));

		if (typeof info === 'object') {
			this.info = info;

			this.iconPath = {
				light: Uri.joinPath(extension.context.extensionUri, 'images', 'dependency-light.svg'),
				dark: Uri.joinPath(extension.context.extensionUri, 'images', 'dependency-dark.svg'),
			};

			this.command = {
				command: 'code-d.viewDubPackage',
				title: 'Open README',
				tooltip: 'Open README',
				arguments: [info.path, info.name]
			};

			this.contextValue = info.root ? 'root' : 'dependency';
		}

		if (command != null) {
			this.command = command;
		}

		if (icon != null) {
			this.iconPath = {
				light: Uri.joinPath(extension.context.extensionUri, 'images', `${icon}-light.svg`),
				dark: Uri.joinPath(extension.context.extensionUri, 'images', `${icon}-dark.svg`),
			};
		}
	}
}

function dependencyLabel(info: DubDependencyInfo | string) {
	if (typeof info === 'string') {
		return info;
	} else {
		const failMessage = info.failed ? ' (failed loading)' : '';
		return `${info.name}:  ${info.version}${failMessage}`;
	}
}

function dependencyCollapse(info: DubDependencyInfo | string) {
	return typeof info === 'string'
		? TreeItemCollapsibleState.None
		: TreeItemCollapsibleState.Collapsed;
}

export interface DubDependencyInfo {
	name: string;
	failed?: boolean;
	version: string;
	path: string;
	description: string;
	homepage: string;
	authors: string[];
	copyright: string;
	license: string;
	subPackages: string[];
	hasDependencies: boolean;
	root: boolean;
}