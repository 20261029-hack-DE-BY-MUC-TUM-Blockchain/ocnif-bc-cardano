import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { answer } from "./client.mjs";
import { loadSokosumiRuntime } from "./sokosumi-runtime.mjs";
import { assertTaskTarget, verifyRuntimeTask } from "./task-target.mjs";
import { safeTaskId } from "./config.mjs";
export async function runtimeClient(target) {
	const { readRuntimeCredential, createCoworkerHttpClient } =
		await loadSokosumiRuntime();
	return createCoworkerHttpClient({
		apiKey: readRuntimeCredential(target.coworkerId),
	});
}
export async function reply(task, target, runtime) {
	assertTaskTarget(task, target);
	const taskId = safeTaskId(task.id);
	await verifyRuntimeTask(runtime, taskId, target);
	const { fetchTaskEvents, createTaskEvent } = await loadSokosumiRuntime();
	const journal = `.local/${taskId}-comments.json`;
	const state = existsSync(journal)
		? JSON.parse(readFileSync(journal, "utf8"))
		: {};
	const { events } = await fetchTaskEvents(
		runtime,
		taskId,
		AbortSignal.timeout(30000),
	);
	const sessionFile = `.local/${taskId}-session.json`;
	if (!existsSync(sessionFile)) return;
	for (const event of events.filter(
		(e) =>
			e.actor?.type === "user" &&
			typeof e.comment === "string" &&
			e.comment.trim(),
	)) {
		if (Object.hasOwn(state, event.id)) continue;
		safeTaskId(event.id);
		if (Buffer.byteLength(event.comment) > 12000) continue;
		state[event.id] = "model-pending";
		writeFileSync(journal, JSON.stringify(state), { mode: 0o600 });
		const result = await answer(event.comment, sessionFile);
		state[event.id] = "post-pending";
		writeFileSync(journal, JSON.stringify(state), { mode: 0o600 });
		await verifyRuntimeTask(runtime, taskId, target);
		await createTaskEvent(
			runtime,
			taskId,
			{ comment: result },
			AbortSignal.timeout(30000),
		);
		state[event.id] = "posted";
		writeFileSync(journal, JSON.stringify(state), { mode: 0o600 });
	}
}
