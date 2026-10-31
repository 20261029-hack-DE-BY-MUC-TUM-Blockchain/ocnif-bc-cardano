import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
	fs.readFileSync(path.join(directory, "provenance.json")),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function verifyCheckout(checkout, expected = "patched") {
	const revision = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: checkout,
		encoding: "utf8",
	}).trim();
	if (revision !== manifest.commit)
		throw Error("Payment service revision mismatch");
	for (const [name, digests] of Object.entries(manifest.files)) {
		if (hash(fs.readFileSync(path.join(checkout, name))) !== digests[expected])
			throw Error(`Payment service file mismatch: ${name}`);
	}
}

export function prepareCheckout(checkout) {
	const patch = fs.readFileSync(path.join(directory, "hardening.patch"));
	if (hash(patch) !== manifest.patchSha256)
		throw Error("Hardening patch mismatch");
	try {
		verifyCheckout(checkout);
		return "already prepared";
	} catch {
		verifyCheckout(checkout, "original");
	}
	const options = {
		cwd: checkout,
		input: patch,
		stdio: ["pipe", "pipe", "pipe"],
	};
	execFileSync("git", ["apply", "--unidiff-zero", "--check", "-"], options);
	execFileSync("git", ["apply", "--unidiff-zero", "-"], options);
	verifyCheckout(checkout);
	return "prepared";
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	if (!process.argv[2])
		throw Error("Usage: node mps/prepare.mjs <official-checkout>");
	console.log(
		`Pinned payment service ${prepareCheckout(path.resolve(process.argv[2]))}`,
	);
}
