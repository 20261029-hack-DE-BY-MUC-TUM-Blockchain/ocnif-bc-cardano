import { execFileSync } from "node:child_process";
export function verifyCli(run = execFileSync) {
	const version = run("sokosumi", ["--version"], {
		encoding: "utf8",
		timeout: 10000,
	}).trim();
	if (!/(^|\s)1\.0\.4($|\s)/.test(version))
		throw new Error(
			"Sokosumi CLI 1.0.4 is required by the pinned runtime adapter",
		);
	return version;
}
export function cli(args, run = execFileSync) {
	return JSON.parse(
		run("sokosumi", ["--preprod", ...args, "--json"], {
			encoding: "utf8",
			timeout: 30000,
			maxBuffer: 4 * 1024 * 1024,
		}),
	);
}
