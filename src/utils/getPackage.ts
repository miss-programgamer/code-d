import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ExtensionContext } from 'vscode';


const filename = resolve(import.meta.dirname, '..', '..', 'package.json');

let pkg: PackageObject | undefined = undefined;


/**
 * Get the contents of our `package.json` file.
 * 
 * @returns The contents of our `package.json` as an object.
 */
export default async function getPackage(context?: ExtensionContext): Promise<PackageObject> {
	return pkg ??= JSON.parse((await readFile(resolve(context?.extensionPath ?? filename, 'package.json'))).toString());
}

/**
 * Get the version of this Node package, sourced from our `package.json` file.
 * 
 * @returns The version string specified in our `package.json` file.
 */
export async function getPackageVersion(context?: ExtensionContext): Promise<string> {
	return (await getPackage(context)).version;
}

/** The shape of our `package.json` file. */
export interface PackageObject {
	version: string;
}
