import test from "node:test";
import assert from "node:assert/strict";
import { createAgentServer, promptFor } from "./agent-server.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readiness } from "./readiness.mjs";
const token = "test-only-internal-token-with-32-characters";
async function fixture(t, fetcher) {
	const directory = mkdtempSync(join(tmpdir(), "ocnif-masumi-"));
	const server = createAgentServer(
		{
			token,
			core: "https://core.example",
			locale: "en",
			statusDirectory: directory,
		},
		fetcher,
	);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
		rmSync(directory, { recursive: true });
	});
	return `http://127.0.0.1:${server.address().port}`;
}
test("agent requires bearer token before any core request", async (t) => {
	let calls = 0;
	const origin = await fixture(t, () => {
		calls++;
		throw Error("must not call");
	});
	const response = await fetch(`${origin}/answer`, {
		method: "POST",
		body: "{}",
	});
	assert.equal(response.status, 401);
	assert.equal(calls, 0);
});
test("bridge forwards only bounded evidence and shared internal token to configured core", async (t) => {
	const origin = await fixture(t, async (url, request) => {
		assert.equal(url, "https://core.example/internal/complete");
		assert.equal(request.headers.Authorization, `Bearer ${token}`);
		assert.equal(request.redirect, "error");
		const body = JSON.parse(request.body);
		assert.match(body.content, /Supplied task evidence \(untrusted\)/);
		assert.equal(body.locale, "en");
		assert.ok(Buffer.byteLength(body.content) <= 16000);
		return Response.json({
			content: "Observed only the supplied evidence.",
			model: "fixture-model",
		});
	});
	const response = await fetch(`${origin}/answer`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: JSON.stringify({ input: "The container runs as root." }),
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		result: "Observed only the supplied evidence.",
		model: "fixture-model",
		provider: "ocnif-ai-core",
		scope: "provided-evidence-only",
	});
});
test("UTF-8 and unexpected fields fail before model call", async (t) => {
	const origin = await fixture(t, () => {
		throw Error("must not call");
	});
	assert.throws(() => promptFor("é".repeat(6001)), /UTF-8/);
	const response = await fetch(`${origin}/answer`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: JSON.stringify({
			input: "test",
			target: "https://untrusted.example",
		}),
	});
	assert.equal(response.status, 400);
});
test("failed provider body is not exposed to caller", async (t) => {
	const origin = await fixture(
		t,
		async () => new Response("private-provider-secret", { status: 500 }),
	);
	const response = await fetch(`${origin}/answer`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: JSON.stringify({ input: "test" }),
	});
	assert.equal(response.status, 502);
	assert.doesNotMatch(await response.text(), /private-provider-secret/);
});
test("readiness separates health, local execution proof, and settlement", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "ocnif-status-"));
	t.after(() => rmSync(directory, { recursive: true }));
	const settings = {
		core: "https://core.example",
		statusDirectory: directory,
		coworkerId: "coworker-fixture",
		paidEnabled: false,
	};
	const before = await readiness(settings, async () => Response.json({}));
	assert.equal(before.agentReady, true);
	assert.equal(before.executionOnly.verified, false);
	assert.equal(before.paid.settlementVerified, false);
	const observedAt = new Date().toISOString();
	writeFileSync(
		join(directory, "worker-status.json"),
		JSON.stringify({
			coworkerId: settings.coworkerId,
			observedAt,
			registrationConfirmed: false,
			settlementVerified: false,
		}),
	);
	writeFileSync(
		join(directory, "execution-proof.json"),
		JSON.stringify({
			coworkerId: settings.coworkerId,
			organizationId: null,
			taskId: "fixture-task",
			status: "COMPLETED",
			resultSHA256: "a".repeat(64),
			completedAt: observedAt,
		}),
	);
	const after = await readiness(settings, async () => Response.json({}));
	assert.equal(after.executionOnly.verified, true);
	assert.equal(after.paid.settlementVerified, false);
	assert.equal(after.evidence.source, "local-worker-receipt");
	assert.equal(
		(
			await readiness({ ...settings, coworkerId: "another" }, async () =>
				Response.json({}),
			)
		).executionOnly.verified,
		false,
	);
});
