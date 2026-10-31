import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sokosumiRoot } from "./sokosumi-runtime.mjs";
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
export function cliArguments(args) {
	const executable = join(dirname(sokosumiRoot()), "bin", "sokosumi.js");
	return [
		"--import",
		fileURLToPath(new URL("./compat-register.mjs", import.meta.url)),
		executable,
		"--preprod",
		...args,
		"--json",
	];
}
export function cli(args, run = execFileSync) {
	return JSON.parse(
		run(process.execPath, cliArguments(args), {
			encoding: "utf8",
			timeout: 30000,
			maxBuffer: 4 * 1024 * 1024,
		}),
	);
}
