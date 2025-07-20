// the shell quoting functions should only be used if really necessary! vscode
// tasks should be used if something is actually executed.

export function getEscapeShellParamFn(platform: 'win32' | string) {
	if (platform == 'win32') {
		return win32EscapeShellParam;
	} else {
		return unixEscapeShellParam;
	}
}

export function escapeShellParam(platform: 'win32' | string, param: string): string {
	switch (platform) {
		case 'win32':
			return win32EscapeShellParam(param);
		default:
			return unixEscapeShellParam(param);
	}
}

/**
 * Escapes a parameter for appending to win32 process info object. The returned
 * string reverses back to the input param using the Win32 CommandLineToArgvW
 * method on the application side.
 */
export function win32EscapeShellParam(param: string): string {
	if (param.length == 0) {
		return '""';
	}

	if (param.indexOf(' ') == -1 && param.indexOf('"') == -1) {
		return param;
	}

	let ret: string = '"';
	let backslash: number = 0;
	for (const c of param) {
		if (c == '"') {
			ret += '\\'.repeat(backslash + 1) + '"';
			backslash = 0;
		} else {
			if (c == '\\') {
				++backslash;
			} else {
				backslash = 0;
			}
			ret += c;
		}
	}
	return ret + '"';
}

/**
 * https://stackoverflow.com/a/22827128
 * thx Alex Yaroshevich
 */
export function unixEscapeShellParam(param: string): string {
	return `'${param.replace(/'/g, `'\\''`)}'`;
}