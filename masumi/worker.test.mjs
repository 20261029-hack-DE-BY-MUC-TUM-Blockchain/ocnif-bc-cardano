import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyCli } from "./cli.mjs";
import { advanceExecution } from "./worker.mjs";

const target = {
	coworkerId: "fixture-coworker",
	organizationId: null,
	runtimeArgs: ["--personal"],
};
const task = {
	id: "fixture-task",
	coworkerId: target.coworkerId,
	organizationId: null,
	status: "READY",
};
const runtime = {
	get: async () => ({ data: { ...task, status: "COMPLETED" } }),
};
function directory(t) {
	const prior = process.cwd();
	const path = mkdtempSync(join(tmpdir(), "ocnif-worker-"));
	process.chdir(path);
	mkdirSync(".local");
	t.after(() => {
		process.chdir(prior);
		rmSync(path, { recursive: true });
	});
}
test("pinned CLI validation rejects incompatible runtime adapter versions", () => {
	assert.equal(
		verifyCli(() => "1.0.4\n"),
		"1.0.4",
	);
	assert.throws(() => verifyCli(() => "1.0.5"), /1.0.4/);
});
test("task start, model, completion persist pending states before external calls", async (t) => {
	directory(t);
	const phases = [];
	const receiptPaths = [];
	const calls = [];
	const state = await advanceExecution(
		task,
		{},
		{
			target,
			runtime,
			persist: (path, value) => {
				phases.push(value.phase ?? value.status);
				if (value.status === "COMPLETED") receiptPaths.push(path);
			},
			command: (args) => {
				calls.push(args[1]);
				if (args[1] === "start") {
					assert.equal(phases.at(-1), "starting");
					return { description: "authoritative input" };
				}
				assert.equal(phases.at(-1), "complete-pending");
				return {
					taskId: task.id,
					status: "COMPLETED",
					eventId: "event-fixture",
					result: "useful result",
				};
			},
			model: async (input) => {
				assert.equal(input, "authoritative input");
				assert.equal(phases.at(-1), "model-pending");
				return "useful result";
			},
		},
	);
	assert.equal(state.phase, "completed");
	assert.deepEqual(calls, ["start", "complete"]);
	assert.deepEqual(phases, [
		"starting",
		"started",
		"model-pending",
		"result-saved",
		"complete-pending",
		"completed",
		"COMPLETED",
		"COMPLETED",
	]);
	assert.deepEqual(receiptPaths, [
		".local/last-completion-proof.json",
		".local/execution-proof.json",
	]);
});
test("ambiguous journals never automatically repeat effects", async () => {
	for (const phase of ["starting", "model-pending", "complete-pending"]) {
		const state = await advanceExecution(
			task,
			{ phase },
			{
				target,
				runtime,
				command: () => assert.fail("external write repeated"),
				model: () => assert.fail("model repeated"),
				persist: () => assert.fail("journal rewritten"),
			},
		);
		assert.equal(state.phase, phase);
	}
});
test("another coworker or unsafe task ID is rejected before writes", async () => {
	const dependencies = {
		target,
		runtime,
		command: () => assert.fail(),
		persist: () => assert.fail(),
	};
	await assert.rejects(
		advanceExecution({ ...task, coworkerId: "other" }, {}, dependencies),
		/target mismatch/,
	);
	await assert.rejects(
		advanceExecution({ ...task, id: "../escape" }, {}, dependencies),
		/identifier/,
	);
});
test("completion of another result cannot become execution proof", async (t) => {
	directory(t);
	await assert.rejects(
		advanceExecution(
			task,
			{ phase: "result-saved", resultSHA256: "a".repeat(64) },
			{
				target,
				runtime,
				persist: () => {},
				command: () => ({
					taskId: task.id,
					status: "COMPLETED",
					eventId: "event",
					result: "different",
				}),
			},
		),
		/saved result/,
	);
});
