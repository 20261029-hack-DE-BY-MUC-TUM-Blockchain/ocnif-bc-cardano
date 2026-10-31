import { spawnSync } from "node:child_process";
import { cliArguments, verifyCli } from "./cli.mjs";
verifyCli();
const result = spawnSync(
	process.execPath,
	cliArguments(process.argv.slice(2)),
	{ stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
