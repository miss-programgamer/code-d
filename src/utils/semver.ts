export function cmpSemver(as: string, bs: string): number {
	const a = parseSimpleSemver(as);
	const b = parseSimpleSemver(bs);

	for (let i = 0; i < 3; i++) {
		if (a[i] < b[i]) return -1;
		else if (a[i] > b[i]) return 1;
	}

	// pre-release on a but not on b
	if (a[3].length > 0 && b[3].length == 0) return -1;
	// pre-release on b but not on a
	else if (a[3].length == 0 && b[3].length > 0) return 1;

	const min = Math.min(a[3].length, b[3].length);
	for (let i = 0; i < min; i++) {
		if (a[3][i] < b[3][i])
			return -1;
		else if (a[3][i] > b[3][i])
			return 1;
	}

	if (a[3].length == b[3].length) return 0;
	else if (a[3].length < b[3].length) return -1;
	else return 1;
}

export function parseSimpleSemver(a: string): [number, number, number, (string | number)[]] {
	if (a.startsWith("~")) return [0, 0, 0, [a]];
	if (a.startsWith("v")) a = a.substr(1);

	const plus = a.indexOf('+');
	if (plus != -1) a = a.substr(0, plus);

	const hyphen = a.indexOf('-');
	let preRelease: (string | number)[] = [];
	if (hyphen != -1) {
		let part = a.substr(hyphen + 1);
		a = a.substr(0, hyphen);

		preRelease = part.split('.');
		for (let i = 0; i < preRelease.length; i++) {
			const n = parseInt(<string>preRelease[i]);
			if (isFinite(n))
				preRelease[i] = n;
		}
	}

	const parts = a.split('.');
	if (parts.length != 3)
		throw new Error("Version specification '" + a + "' not parsable by simple semver rules");
	return [parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), preRelease];
}