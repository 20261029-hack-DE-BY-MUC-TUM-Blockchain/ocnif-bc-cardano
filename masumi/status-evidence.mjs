import { createHash } from "node:crypto";
import { assertTaskTarget } from "./task-target.mjs";

export function executionEvidence(
	task,
	events,
	proof,
	journal,
	now = new Date(),
) {
	if (!proof || !journal?.completionEventId)
		throw Error("Completion receipt missing");
	assertTaskTarget(task, proof);
	if (task.id !== proof.taskId || task.status !== "COMPLETED")
		throw Error("Fresh Task read does not confirm completion");
	const event = events.find((item) => item.id === journal.completionEventId);
	if (
		!event ||
		event.taskId !== task.id ||
		event.status !== "COMPLETED" ||
		event.actor?.type !== "coworker" ||
		event.actor.id !== proof.coworkerId ||
		event.coworkerId !== proof.coworkerId ||
		typeof event.comment !== "string" ||
		Buffer.byteLength(event.comment) > 1048576 ||
		createHash("sha256").update(event.comment).digest("hex") !==
			proof.resultSHA256
	)
		throw Error("Fresh completion event does not match the saved result");
	const completedAt = new Date(event.createdAt);
	if (!Number.isFinite(completedAt.valueOf()) || completedAt > now)
		throw Error("Completion event time is invalid");
	return {
		taskId: task.id,
		status: "COMPLETED",
		organizationId: proof.organizationId,
		completionEventId: event.id,
		resultSHA256: proof.resultSHA256,
		completedAt: completedAt.toISOString(),
		verifiedAt: now.toISOString(),
		source: "sokosumi-task-readback",
	};
}

export function brokerUrl(value) {
	const url = new URL(value);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/api/internal/masumi/status" ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["127.0.0.1", "localhost", "ocnif-backend"].includes(url.hostname)
			))
	)
		throw Error(
			"Status broker must use the configured HTTPS endpoint or internal backend",
		);
	return url.href;
}
