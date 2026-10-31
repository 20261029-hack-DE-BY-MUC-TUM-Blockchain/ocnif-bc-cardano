import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { brokerUrl, executionEvidence } from "./status-evidence.mjs";
import { applyBrokerEvidence, readBrokerEvidence } from "./status-reader.mjs";

const taskId = "11111111-1111-4111-8111-111111111111";
const coworkerId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const result = "Observed synthetic evidence; no external scan performed.";
const proof = {
	taskId,
	coworkerId,
	organizationId: null,
	resultSHA256: createHash("sha256").update(result).digest("hex"),
};
const task = {
	id: taskId,
	coworkerId,
	organizationId: null,
	status: "COMPLETED",
};
const event = {
	id: eventId,
	taskId,
	coworkerId,
	actor: { type: "coworker", id: coworkerId },
	status: "COMPLETED",
	comment: result,
	createdAt: "2026-10-31T12:00:00.000Z",
};
const journal = { completionEventId: eventId };

test("status proof requires fresh matching Task and exact completion event result", () => {
	const evidence = executionEvidence(
		task,
		[event],
		proof,
		journal,
		new Date("2026-10-31T12:01:00Z"),
	);
	assert.equal(evidence.source, "sokosumi-task-readback");
	assert.equal(evidence.completedAt, event.createdAt);
	assert.equal(evidence.completionEventId, eventId);
	assert.equal(evidence.comment, undefined);
});

test("tampered completion, ownership, workspace, and event identity cannot become evidence", () => {
	for (const altered of [
		{ ...event, comment: "different result" },
		{ ...event, taskId: "another-task" },
		{ ...event, status: "RUNNING" },
		{ ...event, actor: { type: "user", id: coworkerId } },
	])
		assert.throws(
			() => executionEvidence(task, [altered], proof, journal),
			/completion event/,
		);
	assert.throws(
		() =>
			executionEvidence(
				{ ...task, organizationId: "another-workspace" },
				[event],
				proof,
				journal,
			),
		/Workspace/,
	);
	assert.throws(
		() =>
			executionEvidence(
				{ ...task, status: "RUNNING" },
				[event],
				proof,
				journal,
			),
		/completion/,
	);
});

const baseline = {
	agentReady: true,
	coworkerConfigured: false,
	executionOnly: { verified: false, taskId: null },
	paid: {
		enabled: false,
		registrationConfirmed: false,
		settlementVerified: false,
	},
	setupRequired: [
		"coworker_setup",
		"execution_task",
		"worker_not_attached",
		"masumi_registration",
		"paid_task",
	],
};
function broker() {
	return {
		schemaVersion: 1,
		network: "cardano:preprod",
		status: "available",
		provenance: "authenticated-local-worker-attestation",
		coworkerId,
		observedAt: new Date().toISOString(),
		receivedAt: new Date().toISOString(),
		payloadSHA256: "a".repeat(64),
		executionSHA256: "b".repeat(64),
		workerFresh: true,
		execution: executionEvidence(task, [event], proof, journal),
	};
}

test("public status exposes receipt and workspace while omitting private identifiers", () => {
	const status = applyBrokerEvidence(baseline, broker());
	assert.equal(status.executionOnly.verified, true);
	assert.equal(status.executionOnly.taskId, null);
	assert.equal(status.executionOnly.workspaceKind, "personal");
	assert.equal(status.workerFresh, true);
	assert.deepEqual(status.paid, baseline.paid);
	for (const privateId of [taskId, coworkerId, eventId])
		assert.ok(!JSON.stringify(status).includes(privateId));
});

test("expired worker heartbeat retains historical completion without claiming liveness", () => {
	const data = broker();
	data.observedAt = new Date(Date.now() - 60000).toISOString();
	data.workerFresh = false;
	const status = applyBrokerEvidence(baseline, data);
	assert.equal(status.executionOnly.verified, true);
	assert.equal(status.workerFresh, false);
	assert.ok(status.setupRequired.includes("worker_not_attached"));
});

test("reader authenticates internally and leaves readiness unverified on errors", async () => {
	const token = "fixture".repeat(8);
	const settings = {
		statusBrokerUrl: "http://ocnif-backend/api/internal/masumi/status",
		token,
	};
	const status = await readBrokerEvidence(
		settings,
		baseline,
		async (url, init) => {
			assert.equal(url, settings.statusBrokerUrl);
			assert.equal(init.headers.authorization, `Bearer ${token}`);
			assert.equal(init.redirect, "error");
			return new Response(JSON.stringify(broker()));
		},
	);
	assert.equal(status.executionOnly.verified, true);
	assert.ok(!JSON.stringify(status).includes(token));
	assert.equal(
		await readBrokerEvidence(
			settings,
			baseline,
			async () => new Response("denied", { status: 401 }),
		),
		baseline,
	);
});

test("broker token cannot be sent to an unencrypted public or altered endpoint", () => {
	for (const url of [
		"http://remote.example/api/internal/masumi/status",
		"https://host.example/other",
		"https://user:password@host.example/api/internal/masumi/status",
		"https://host.example/api/internal/masumi/status?redirect=other",
	])
		assert.throws(() => brokerUrl(url));
});
