import { workspace, ConfigurationScope, ConfigurationTarget } from 'vscode';


export default class Settings {
	section: string = 'd';

	get<T = unknown>(name: string, defaultValue: T, scope?: ConfigurationScope): T;
	get<T = unknown>(name: string, defaultValue?: undefined, scope?: ConfigurationScope): T | undefined;
	get<T = unknown>(name: string, defaultValue?: T, scope?: ConfigurationScope): T | undefined {
		return workspace.getConfiguration(this.section, scope)
			.get<T>(name, defaultValue as any);
	}

	set<T>(name: string, value: T, target?: ConfigurationTarget | boolean | null, scope?: ConfigurationScope) {
		return workspace.getConfiguration(this.section, scope)
			.update(name, value, target);
	}

	inspect(name: string, scope?: ConfigurationScope) {
		return workspace.getConfiguration(this.section, scope).inspect(name);
	}


	get dubPath(): string {
		return this.get<string>('dubPath', 'dub');
	}

	setDubPath(value: string) {
		return this.set<string>('dubPath', value);
	}


	get dmdPath(): string | undefined {
		return this.get<string>('dmdPath');
	}

	setDmdPath(value: string | undefined) {
		return this.set('dmdPath', value);
	}


	get servedPath(): string {
		return this.get<string>('servedPath', 'serve-d');
	}

	setServedPath(value: string, target?: ConfigurationTarget | boolean | null) {
		return this.set<string>('servedPath', value, target);
	}


	get dubCompiler(): string | undefined {
		return this.get<string>('dubCompiler');
	}


	get showUpdateChangelogs(): boolean {
		return this.get<boolean>('showUpdateChangelogs', true);
	}

	setShowUpdateChangelogs(value: boolean) {
		return this.set<boolean>('showUpdateChangelogs', value, ConfigurationTarget.Global);
	}


	get enableCoverageDecoration(): boolean {
		return this.get<boolean>('enableCoverageDecoration', true);
	}


	get aggressiveUpdate(): boolean {
		return this.get<boolean>('aggressiveUpdate', true);
	}


	get forceUpdateServeD(): boolean {
		return this.get<boolean>('forceUpdateServeD', false);
	}


	get forceCompileServeD(): boolean {
		return this.get<boolean>('forceCompileServeD', false);
	}


	get smartServedUpdates(): boolean {
		return this.get<boolean>('smartServedUpdates', true);
	}


	get legacyBetaStream(): boolean {
		return this.get<boolean>('betaStream', false);
	}


	get enableDubLinting(): boolean {
		return this.get<boolean>('enableDubLinting', true);
	}


	get releaseChannel(): string {
		return this.get<string>('servedReleaseChannel', 'stable');
	}

	get releaseChannelInfo() {
		return this.inspect('servedReleaseChannel');
	}

	setReleaseChannel(value?: string) {
		return this.set<string | undefined>('servedReleaseChannel', value, ConfigurationTarget.Global);
	}


	get manyProjectsAllowList(): string[] {
		return this.get<string[]>('manyProjectsAllowList', []);
	}

	setManyProjectsAllowList(value: string[]) {
		return this.set<string[]>('manyProjectsAllowList', value, ConfigurationTarget.Workspace);
	}


	get manyProjectsDenyList(): string[] {
		return this.get<string[]>('manyProjectsDenyList', []);
	}

	setManyProjectsDenyList(value: string[]) {
		return this.set<string[]>('manyProjectsDenyList', value, ConfigurationTarget.Workspace);
	}


	get dependencyClickBehavior(): string | undefined {
		return this.get<string>('dependencyClickBehavior');
	}


	get dependencyTextDocumentFilter(): string[] {
		return this.get<string[]>('dependencyTextDocumentFilter', []);
	}
}