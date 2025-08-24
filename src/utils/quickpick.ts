import { window, QuickPickItem, QuickPickOptions } from 'vscode';


export type QuickPickInputItem = QuickPickItem & { custom: true; };

export default function showQuickPickWithInput<T>(items: T[] | Thenable<T[]>, options: QuickPickOptions & { canPickMany: true; }): Promise<(T | QuickPickInputItem)[] | undefined>;
export default function showQuickPickWithInput<T>(items: T[] | Thenable<T[]>, options?: QuickPickOptions & { canPickMany: false | undefined; } | undefined): Promise<T | QuickPickInputItem | undefined>;
export default function showQuickPickWithInput<T>(items: T[] | Thenable<T[]>, options?: QuickPickOptions): Promise<(T | QuickPickInputItem) | (T | QuickPickInputItem)[] | undefined> {
	return new Promise(resolve => {
		let quickPick = window.createQuickPick();
		quickPick.canSelectMany = options?.canPickMany ?? false;
		quickPick.ignoreFocusOut = options?.ignoreFocusOut ?? false;
		quickPick.matchOnDescription = options?.matchOnDescription ?? false;
		quickPick.matchOnDetail = options?.matchOnDetail ?? false;
		quickPick.placeholder = options?.placeHolder;
		quickPick.title = options?.title;
		let input: QuickPickInputItem = {
			label: '',
			description: 'Custom Input',
			alwaysShow: true,
			custom: true
		};
		quickPick.items = [];
		quickPick.busy = true;
		(async function () {
			quickPick.items = quickPick.items.concat(<any>(await items));
			quickPick.busy = false;
		})();

		quickPick.onDidChangeValue((e) => {
			input.label = quickPick.value;
			let i = quickPick.items.indexOf(input);
			if (quickPick.value) {
				if (i === -1) {
					quickPick.items = [input as QuickPickItem].concat(quickPick.items);
				} else {
					quickPick.items = quickPick.items;
				}
			} else {
				if (i !== -1) {
					quickPick.items = quickPick.items.slice(0, i).concat(quickPick.items.slice(i + 1));
				}
			}
		});

		let resolved = false;
		quickPick.onDidChangeSelection((e) => {
			options?.onDidSelectItem ? options.onDidSelectItem(e[0]) : null;
			resolve(<any>(options?.canPickMany ? e : e[0]));
			resolved = true;
			quickPick.hide();
		});

		quickPick.onDidHide(() => {
			if (!resolved) {
				resolve(undefined);
			}
			quickPick.dispose();
		});

		quickPick.show();
	});
}