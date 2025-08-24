export function cmpSemver(v1: string | SimpleSemver, v2: string | SimpleSemver): number {
	if (typeof v1 === 'string') {
		v1 = parseSimpleSemver(v1);
	}

	if (typeof v2 === 'string') {
		v2 = parseSimpleSemver(v2);
	}

	for (let i = 0; i < 3; i++) {
		if (v1[i] < v2[i]) {
			return -1;
		} else if (v1[i] > v2[i]) {
			return 1;
		}
	}

	// pre-release takes priority
	if (v1[3].length > 0 && v2[3].length === 0) {
		return -1;
	} else if (v1[3].length === 0 && v2[3].length > 0) {
		return 1;
	}

	const min = Math.min(v1[3].length, v2[3].length);
	for (let i = 0; i < min; i++) {
		if (v1[3][i] < v2[3][i]) {
			return -1;
		} else if (v1[3][i] > v2[3][i]) {
			return 1;
		}
	}

	if (v1[3].length === v2[3].length) {
		return 0;
	} else if (v1[3].length < v2[3].length) {
		return -1;
	} else {
		return 1;
	}
}

export function parseSimpleSemver(version: string): SimpleSemver {
	if (version.startsWith('~')) {
		return [0, 0, 0, [version]];
	}

	// Truncate leading 'v'
	if (version.startsWith('v')) {
		version = version.substring(1);
	}

	// Truncate trailing plus and rest
	const plusIndex = version.indexOf('+');
	if (plusIndex !== -1) {
		version = version.substring(0, plusIndex);
	}

	let preRelease: (string | number)[] = [];

	// Handle pre-release tags after hyphen
	const hyphenIndex = version.indexOf('-');
	if (hyphenIndex !== -1) {
		const suffix = version.substring(hyphenIndex + 1);

		preRelease = suffix.split('.').map(part => {
			const num = parseInt(part);
			return isFinite(num) ? num : part;
		});

		version = version.substring(0, hyphenIndex);
	}

	const parts = version.split('.');

	if (parts.length !== 3) {
		throw new Error(`Version specification '${version}' not parsable by simple semver rules`);
	}

	const [major, minor, patch] = parts.map(parseInt);
	return [major, minor, patch, preRelease];
}

export type SimpleSemver = [number, number, number, (string | number)[]];