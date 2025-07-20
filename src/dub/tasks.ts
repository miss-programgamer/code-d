import { CancellationToken, ProcessExecution, ProcessExecutionOptions, ShellExecution, ShellQuotedString, ShellQuoting, Task, TaskGroup, TaskProvider, TaskScope, Uri, window, workspace, WorkspaceFolder } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node.js';

import extension from '../extension.js';


export class DubTaskProvider implements TaskProvider {
	constructor(public served: LanguageClient) { }

	async provideTasks(_token?: CancellationToken | undefined): Promise<Task[]> {
		const dubLint = extension.settings.enableDubLinting;
		const taskConfigs = await this.served.sendRequest<DubTask[]>("served/buildTasks");

		const ret: Task[] = [];

		for (const taskConfig of taskConfigs) {
			var target: WorkspaceFolder | TaskScope | undefined;
			let cwd: string = "";

			if (taskConfig.scope == "global") {
				target = TaskScope.Global;
			} else if (taskConfig.scope == "workspace") {
				target = TaskScope.Workspace;
			} else {
				let uri = Uri.parse(taskConfig.scope);
				target = workspace.getWorkspaceFolder(uri);
				cwd = target?.uri.fsPath ?? uri.fsPath;
			}

			if (!target) {
				continue;
			}

			var proc: string = taskConfig.exec.shift() || "exit";
			var args: string[] = taskConfig.exec;

			if (taskConfig.definition.cwd) {
				cwd = taskConfig.definition.cwd;
			}

			if (typeof target == "object" && target.uri) {
				cwd = cwd.replace("${workspaceFolder}", target.uri.fsPath);
			}

			// set more flexible run args for UI import
			taskConfig.definition.compiler = "$current";
			taskConfig.definition.archType = "$current";
			taskConfig.definition.buildType = "$current";
			taskConfig.definition.configuration = "$current";

			if (!dubLint && !Array.isArray(taskConfig.problemMatchers) || taskConfig.problemMatchers.length == 0) {
				taskConfig.problemMatchers = ["$dmd"];
			}

			var task = new Task(taskConfig.definition, target, taskConfig.name, taskConfig.source, makeExecutor(proc, args, cwd), taskConfig.problemMatchers);
			task.isBackground = taskConfig.isBackground;
			task.presentationOptions = {
				focus: Boolean(taskConfig.definition.run)
			};

			task.detail = `dub ${args.join(" ")}`;

			switch (taskConfig.group) {
				case "clean":
					task.group = TaskGroup.Clean;
					break;

				case "build":
					task.group = TaskGroup.Build;
					break;

				case "rebuild":
					task.group = TaskGroup.Rebuild;
					break;

				case "test":
					task.group = TaskGroup.Test;
					break;
			}

			ret.push(task);
		}

		return ret;
	}

	async resolveTask(task: Task & { definition: DubTaskDefinition; }, _token?: CancellationToken | undefined): Promise<Task> {
		async function insertDollarCurrent(args: string[], prefix: string, str: string | undefined, servedFetchCommand: string): Promise<void> {
			if (str == "$current") {
				str = await extension.served?.client.sendRequest<string | undefined>(servedFetchCommand);
			}

			if (str != null) {
				args.push(prefix + str);
			}
		}

		const dubLint = extension.settings.enableDubLinting;
		const args: string[] = [extension.settings.dubPath];

		args.push(task.definition.test ? "test" : task.definition.run ? "run" : "build");

		if (task.definition.root) {
			args.push("--root=" + task.definition.root);
		}

		if (task.definition.overrides) {
			task.definition.overrides.forEach(override => {
				args.push("--override-config=" + override);
			});
		}

		if (task.definition.force) {
			args.push("--force");
		}

		await insertDollarCurrent(args, "--compiler=", task.definition.compiler, "served/getCompiler");
		await insertDollarCurrent(args, "--arch=", task.definition.archType, "served/getArchType");
		await insertDollarCurrent(args, "--build=", task.definition.buildType, "served/getBuildType");
		await insertDollarCurrent(args, "--config=", task.definition.configuration, "served/getConfig");

		if (Array.isArray(task.definition.dub_args)) {
			args.push.apply(args, task.definition.dub_args);
		}

		if (Array.isArray(task.definition.args)) {
			args.push.apply(args, task.definition.args);
			window.showWarningMessage("Your task definition is using the deprecated \"args\" field and will be ignored in an upcoming release.\nPlease change \"args\": to \"dub_args\": to keep old behavior.");
		}

		if (Array.isArray(task.definition.target_args) && (task.definition.test || task.definition.run)) {
			// want to validate test/run in JSON schema but tasks schema doesn't allow advanced JSON schema things to be put on the object validator, only on properties
			args.push("--");
			args.push.apply(args, task.definition.target_args);
		}

		const options: any = task.scope && (task.scope as WorkspaceFolder).uri;
		const exec = makeExecutor(args.shift() || "exit", args, (options && options.fsPath) || task.definition.cwd || undefined);

		const result = new Task(
			task.definition,
			task.scope || TaskScope.Global,
			task.name || `dub ${task.definition.test ? "Test" : task.definition.run ? "Run" : "Build"}`,
			"dub", exec, dubLint ? task.problemMatchers : ["$dmd"]
		);

		result.isBackground = task.isBackground;
		result.detail = `dub ${args.join(" ")}`;

		if (task.presentationOptions) {
			result.presentationOptions = task.presentationOptions;
		} else {
			result.presentationOptions = {
				focus: !!task.definition.run
			};
		}

		return result;
	}
}

function makeExecutor(proc: string, args: string[], cwd: string): ProcessExecution | ShellExecution {
	const options: ProcessExecutionOptions | undefined = cwd ? { cwd } : undefined;

	const command: ShellQuotedString = {
		quoting: ShellQuoting.Strong,
		value: proc,
	};

	return new ShellExecution(command, args.map(arg => ({
		quoting: ShellQuoting.Strong,
		value: arg,
	})), options);
}

type DubTask = {
	definition: any,
	scope: string,
	exec: string[],
	name: string,
	isBackground: boolean,
	source: string,
	group: "clean" | "build" | "rebuild" | "test",
	problemMatchers: string[];
};

type DubTaskDefinition = {
	run?: boolean,
	test?: boolean,
	root?: string,
	cwd?: string,
	overrides?: string[],
	force?: boolean,
	compiler?: string,
	archType?: string,
	buildType?: string,
	configuration?: string,
	args?: string[], // deprecated
	dub_args?: string[],
	target_args?: string[];
};