import { ExtensionContext, Memento } from 'vscode';


export default class Globals {
	#memento: Memento;

	constructor(context: ExtensionContext) {
		this.#memento = context.globalState;
	}


	get greetedNewCodeDUser(): boolean {
		return this.#memento.get<boolean>('greetedNewCodeDUser', false);
	}

	setGreetedNewCodeDUser(value: boolean | undefined) {
		return this.#memento.update('greetedNewCodeDUser', value);
	}


	get checkedCompiler(): number {
		return this.#memento.get<number>('checkedCompiler', 0);
	}

	setCheckedCompiler(value: number | undefined) {
		return this.#memento.update('checkedCompiler', value);
	}


	get lastCheckedCodedVersion(): string {
		return this.#memento.get<string>('lastCheckedCodedVersion', '');
	}

	setLastCheckedCodedVersion(value: string | undefined) {
		return this.#memento.update('lastCheckedCodedVersion', value);
	}


	get serveDDownloadedReleaseChannel(): string | undefined {
		return this.#memento.get('serve-d-downloaded-release-channel');
	}

	setServeDDownloadedReleaseChannel(value: string | undefined) {
		return this.#memento.update('serve-d-downloaded-release-channel', value);
	}


	get serveDWantedDownloadIteration(): number {
		return this.#memento.get('serve-d-wanted-download-iteration', 0);
	}

	setServeDWantedDownloadIteration(value: number | undefined) {
		return this.#memento.update('serve-d-wanted-download-iteration', value);
	}


	get restorePackageBackup(): boolean {
		return this.#memento.get('restorePackageBackup', false);
	}

	setRestorePackageBackup(value: boolean) {
		return this.#memento.update('restorePackageBackup', value ? true : undefined);
	}


	get createTemplate(): string {
		return this.#memento.get('create-template', '');
	}

	setCreateTemplate(value: string | undefined) {
		return this.#memento.update('create-template', value);
	}


	isInstallInProgress(depName: string): boolean {
		return this.#memento.get(`installInProgress-${depName}`, false);
	}

	setInstallInProgress(depName: string, value: boolean | number): void {
		this.#memento.update(`installInProgress-${depName}`, value !== false ? true : undefined);
	}
}
