import { extensions } from 'vscode';


/**
 * Check whether the current profile has at least one of the given extensions installed.
 * 
 * @param args Extension identifiers to check.
 * @returns Whether at least one of the given extensions is installed.
 */
export default function hasAnyExtension(...args: string[]): boolean {
	for (const arg of args) {
		if (extensions.getExtension(arg) != null) {
			return true;
		}
	}

	return false;
}