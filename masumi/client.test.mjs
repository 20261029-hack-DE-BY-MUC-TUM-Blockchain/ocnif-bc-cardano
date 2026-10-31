import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { answer } from "./client.mjs";
test("uncertain model send remains private and cannot automatically repeat", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ocnif-client-"));
	t.after(() => rmSync(dir, { recursive: true }));
	const keys = ["INTERNAL_TOKEN", "CORE_HTTP_URL", "AGENT_URL"];
	const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
	Object.assign(process.env, {
		INTERNAL_TOKEN: "test-only-internal-token-with-32-characters",
		CORE_HTTP_URL: "https://core.example",
		AGENT_URL: "https://agent.example",
	});
	t.after(() => {
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
	});
	const journal = join(dir, "session.json");
	await assert.rejects(
		answer("supplied evidence", journal, undefined, async () => {
			assert.equal(JSON.parse(readFileSync(journal)).phase, "sending");
			throw Error("fixture timeout");
		}),
		/fixture timeout/,
	);
	assert.equal(statSync(journal).mode & 0o777, 0o600);
	await assert.rejects(
		answer("supplied evidence", journal, undefined, async () =>
			assert.fail("repeated request"),
		),
		/uncertain/,
	);
});
