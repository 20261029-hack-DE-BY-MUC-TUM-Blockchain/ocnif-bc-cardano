import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireWorkerLock } from "./worker-lock.mjs";
import { answer, client } from "./client.mjs";
import { reply, runtimeClient } from "./comments.mjs";
import { createPaidAdapter, isPaidReady } from "./paid-task.mjs";
import {
	taskTarget,
	isTaskForTarget,
	verifyRuntimeTask,
} from "./task-target.mjs";
import { config, safeTaskId } from "./config.mjs";
import { cli, verifyCli } from "./cli.mjs";
const save = (path, value) =>
	writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
export function verifyExecutionProof(target) {
	const proof = JSON.parse(readFileSync(".local/execution-proof.json", "utf8"));
	if (
		proof.status !== "COMPLETED" ||
		proof.coworkerId !== target.coworkerId ||
		proof.organizationId !== null ||
		!/^[a-f0-9]{64}$/.test(proof.resultSHA256 ?? "")
	)
		throw new Error(
			"First complete and verify an execution-only Personal Workspace task",
		);
	return proof;
}
export async function advanceExecution(
	task,
	state,
	{ target, command = cli, model = answer, runtime, persist = save },
) {
	const id = safeTaskId(task.id);
	if (!isTaskForTarget(task, target)) throw new Error("Task target mismatch");
	const journal = `.local/${id}.json`;
	const resultFile = `.local/${id}.txt`;
	if (task.status === "READY" && !state.phase) {
		persist(journal, { phase: "starting" });
		const started = command([
			"runtime",
			"start",
			id,
			...target.runtimeArgs,
			"--coworker-id",
			target.coworkerId,
		]);
		if (typeof started.description !== "string" || !started.description.trim())
			throw new Error("Runtime start did not return authoritative task input");
		state = { phase: "started", input: started.description };
		persist(journal, state);
	}
	if (state.phase === "started") {
		persist(journal, { ...state, phase: "model-pending" });
		const result = await model(state.input, `.local/${id}-session.json`);
		writeFileSync(resultFile, result, { mode: 0o600 });
		state = {
			...state,
			phase: "result-saved",
			resultSHA256: createHash("sha256").update(result).digest("hex"),
		};
		persist(journal, state);
	}
	if (state.phase === "result-saved") {
		persist(journal, { ...state, phase: "complete-pending" });
		const completion = command([
			"runtime",
			"complete",
			id,
			...target.runtimeArgs,
			"--coworker-id",
			target.coworkerId,
			"--result-file",
			resultFile,
		]);
		if (
			completion.taskId !== id ||
			completion.status !== "COMPLETED" ||
			!completion.eventId ||
			typeof completion.result !== "string" ||
			createHash("sha256").update(completion.result).digest("hex") !==
				state.resultSHA256
		)
			throw new Error("Completion did not confirm this task and saved result");
		await verifyRuntimeTask(runtime, id, target);
		const { data: completed } = await runtime.get(
			`/v1/tasks/${encodeURIComponent(id)}`,
			AbortSignal.timeout(30000),
		);
		if (completed.status !== "COMPLETED")
			throw new Error(
				"Sokosumi has not confirmed completion; inspect the existing task",
			);
		state = {
			...state,
			phase: "completed",
			completionEventId: completion.eventId,
		};
		persist(journal, state);
		if (!target.organizationId)
			persist(".local/execution-proof.json", {
				taskId: id,
				coworkerId: target.coworkerId,
				organizationId: null,
				status: "COMPLETED",
				resultSHA256: state.resultSHA256,
				completedAt: new Date().toISOString(),
				verification: "Sokosumi runtime API after CLI completion",
			});
	}
	return state;
}
export async function runWorker() {
	verifyCli();
	const target = taskTarget();
	const release = acquireWorkerLock();
	process.once("exit", release);
	for (const signal of ["SIGINT", "SIGTERM"])
		process.once(signal, () => {
			release();
			process.exit(0);
		});
	await client.health();
	const runtime = await runtimeClient(target);
	const paidEnabled = config().paidEnabled;
	if (paidEnabled) {
		verifyExecutionProof(target);
		if (!isPaidReady())
			throw new Error(
				"Confirmed Masumi registration and scoped runtime key are required",
			);
	}
	const paid = await createPaidAdapter({
		target,
		core: runtime,
		answer,
		save: async (id, state) => save(`.local/${safeTaskId(id)}.json`, state),
	});
	console.log("Continuous worker running");
	while (true) {
		try {
			const response = cli([
				"tasks",
				"list",
				"--coworker-id",
				target.coworkerId,
				...target.taskArgs,
			]);
			if (!Array.isArray(response.tasks))
				throw new Error("Invalid Sokosumi task listing");
			let settlementVerified = false;
			for (const task of response.tasks.filter((t) =>
				isTaskForTarget(t, target),
			)) {
				try {
					const id = safeTaskId(task.id);
					const path = `.local/${id}.json`;
					let state = existsSync(path)
						? JSON.parse(readFileSync(path, "utf8"))
						: {};
					if (state.paid && !paidEnabled) continue;
					if (paidEnabled) {
						if (task.status === "READY" && !state.phase) {
							save(path, { phase: "starting" });
							const started = cli([
								"runtime",
								"start",
								id,
								...target.runtimeArgs,
								"--coworker-id",
								target.coworkerId,
							]);
							state = { phase: "started", input: started.description };
							save(path, state);
						}
						if (state.phase === "started" || state.paid)
							state = await paid.advance(task, state);
					} else
						state = await advanceExecution(task, state, { target, runtime });
					if (state.phase === "completed") await reply(task, target, runtime);
					if (state.paid?.settlement?.verified === true)
						settlementVerified = true;
				} catch {
					console.error(
						"Task needs inspection; automatic retry of pending effects is disabled",
					);
				}
			}
			save(".local/worker-status.json", {
				coworkerId: target.coworkerId,
				observedAt: new Date().toISOString(),
				registrationConfirmed: isPaidReady(),
				settlementVerified,
			});
		} catch {
			console.error("Task discovery unavailable; retrying read only");
		}
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	runWorker().catch(() => {
		console.error(
			"Worker setup or credential validation failed; inspect private setup",
		);
		process.exitCode = 1;
	});
}
