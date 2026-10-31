import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyCheckout } from "./prepare.mjs";
import { paymentEnvironment } from "./settings.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = path.resolve(process.argv[2] ?? "");
const operation = process.argv[3];
const commands = {
	generate: [
		"node_modules/prisma/build/index.js",
		"generate",
		"--config",
		"prisma/prisma.config.ts",
	],
	migrate: [
		"node_modules/prisma/build/index.js",
		"migrate",
		"deploy",
		"--config",
		"prisma/prisma.config.ts",
	],
	seed: ["--import", "tsx", "prisma/seed.ts"],
	serve: ["--import", "tsx", "src/index.ts"],
};
if (!commands[operation])
	throw Error(
		"Usage: node mps/run-local.mjs <checkout> generate|migrate|seed|serve",
	);
if (process.versions.node.split(".")[0] !== "24")
	throw Error("Node 24 is required");
verifyCheckout(checkout);

function privateEnv(name) {
	const file = path.join(base, name);
	if ((fs.statSync(file).mode & 0o077) !== 0)
		throw Error(`${name} must have permissions 600`);
	return parseEnv(fs.readFileSync(file, "utf8"));
}

const settings = privateEnv(".local/mps.env");
const user = privateEnv(".env");
const env = paymentEnvironment(
	settings,
	user,
	process.env,
	operation === "seed" || operation === "serve",
);
const journal = path.join(base, ".local/mps-seed.json");
if (operation === "seed") {
	if (fs.existsSync(journal))
		throw Error("Seed journal exists; inspect the database before any retry");
	fs.writeFileSync(
		journal,
		JSON.stringify({ status: "pending", startedAt: new Date().toISOString() }),
		{ mode: 0o600, flag: "wx" },
	);
}
const log = path.join(base, `.local/mps-${operation}.log`);
const output = fs.openSync(log, "a", 0o600);
fs.fchmodSync(output, 0o600);
const child = spawn(process.execPath, commands[operation], {
	cwd: checkout,
	env,
	stdio: ["ignore", output, output],
});
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => child.kill(signal));
child.on("error", () => {
	console.error(
		"Payment service process could not start; inspect its private log",
	);
	process.exitCode = 1;
});
child.on("exit", (code) => {
	fs.closeSync(output);
	if (operation === "seed" && code === 0) {
		fs.writeFileSync(
			journal,
			JSON.stringify({
				status: "completed",
				completedAt: new Date().toISOString(),
			}),
			{ mode: 0o600 },
		);
	}
	console.log(
		`Payment service ${operation}: ${code === 0 ? "completed" : "stopped; inspect private log"}`,
	);
	process.exitCode = code ?? 1;
});
if (operation === "serve")
	console.log(
		"Payment service starting on loopback port 38127; logs remain private",
	);
