import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { answer } from "./client.mjs";
const input =
	"Review this synthetic deployment evidence: an application container runs as root; its network policy permits all outbound traffic; its API token is correctly stored in a secret manager. Provide a bounded defensive review with observed facts, uncertainty, and three practical verification steps. No target is provided or authorized for network scanning.";
mkdirSync(".local", { recursive: true, mode: 0o700 });
const result = await answer(input, ".local/model-probe-session.json");
writeFileSync(".local/model-probe-result.txt", result, { mode: 0o600 });
const proof = {
	checkedAt: new Date().toISOString(),
	provider: "ocnif-ai-core",
	input: "synthetic supplied deployment facts",
	inputSHA256: createHash("sha256").update(input).digest("hex"),
	resultSHA256: createHash("sha256").update(result).digest("hex"),
	bytes: Buffer.byteLength(result),
	executionTaskVerified: false,
	settlementVerified: false,
};
writeFileSync(".local/model-probe.json", JSON.stringify(proof, null, 2), {
	mode: 0o600,
});
console.log(JSON.stringify(proof));
