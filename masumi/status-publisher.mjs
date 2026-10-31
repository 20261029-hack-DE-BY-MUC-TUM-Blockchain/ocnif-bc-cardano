import fs from "node:fs";
import { parseEnv } from "node:util";
import { loadSokosumiRuntime } from "./sokosumi-runtime.mjs";
import { brokerUrl, executionEvidence } from "./status-evidence.mjs";

function privateJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

export function createStatusPublisher({
	runtime,
	target,
	env = process.env,
	fetcher = fetch,
}) {
	if (!env.STATUS_PUBLISH_URL) return async () => {};
	const url = brokerUrl(env.STATUS_PUBLISH_URL);
	const file = env.STATUS_BROKER_TOKEN_FILE;
	if (!file || (fs.statSync(file).mode & 0o077) !== 0)
		throw Error(
			"A private status broker token file with permissions 600 is required",
		);
	const token = parseEnv(fs.readFileSync(file, "utf8")).STATUS_BROKER_TOKEN;
	if (!token || token.length < 32)
		throw Error("Status broker token is missing");
	let lastAttempt = 0;
	return async () => {
		if (Date.now() - lastAttempt < 15000) return;
		lastAttempt = Date.now();
		const latest = privateJson(".local/last-completion-proof.json");
		const personal = privateJson(".local/execution-proof.json");
		const proof = [latest, personal].find(
			(p) => p?.coworkerId === target.coworkerId,
		);
		let execution = null;
		if (proof) {
			try {
				const { data: task } = await runtime.get(
					`/v1/tasks/${encodeURIComponent(proof.taskId)}`,
					AbortSignal.timeout(10000),
				);
				const { fetchTaskEvents } = await loadSokosumiRuntime();
				const { events } = await fetchTaskEvents(
					runtime,
					proof.taskId,
					AbortSignal.timeout(10000),
				);
				execution = executionEvidence(
					task,
					events,
					proof,
					privateJson(`.local/${proof.taskId}.json`),
				);
			} catch {
				// A failed read is not fresh evidence. The broker retains its historical receipt.
			}
		}
		const response = await fetcher(url, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(10000),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				schemaVersion: 1,
				network: "cardano:preprod",
				coworkerId: target.coworkerId,
				observedAt: new Date().toISOString(),
				execution,
			}),
		});
		if (!response.ok)
			throw Error(`Status broker rejected heartbeat HTTP ${response.status}`);
	};
}
