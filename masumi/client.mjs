import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.mjs";
export const client = {
	async health() {
		const response = await fetch(`${config().agent}/health`, {
			signal: AbortSignal.timeout(5000),
			redirect: "error",
		});
		if (!response.ok) throw new Error("Ocnif agent is unavailable");
	},
};
export async function answer(input, journal, deadline, fetcher = fetch) {
	const settings = config();
	if (
		typeof input !== "string" ||
		!input.trim() ||
		Buffer.byteLength(input, "utf8") > 12000
	)
		throw new Error("Task exceeds 12000 UTF-8 bytes");
	if (deadline !== undefined && Date.now() >= deadline)
		throw new Error("Result deadline expired before model send");
	mkdirSync(dirname(journal), { recursive: true, mode: 0o700 });
	const previous = existsSync(journal)
		? JSON.parse(readFileSync(journal, "utf8"))
		: {};
	if (previous.phase === "sending")
		throw new Error(
			"Previous model operation is uncertain; inspect journal before retry",
		);
	const history = Array.isArray(previous.history)
		? previous.history.slice(-4)
		: [];
	const state = {
		sessionId: previous.sessionId ?? randomUUID(),
		phase: "sending",
		history,
	};
	writeFileSync(journal, JSON.stringify(state), { mode: 0o600 });
	const timeout = Math.max(
		1,
		Math.min(185000, deadline === undefined ? 185000 : deadline - Date.now()),
	);
	const response = await fetcher(`${settings.agent}/answer`, {
		method: "POST",
		redirect: "error",
		signal: AbortSignal.timeout(timeout),
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.token}`,
		},
		body: JSON.stringify({ input, history }),
	});
	if (!response.ok)
		throw new Error(
			`Ocnif agent failed HTTP ${response.status}; inspect journal before retry`,
		);
	const raw = await response.text();
	if (Buffer.byteLength(raw) > 131072)
		throw new Error("Agent response exceeds limit");
	const result = JSON.parse(raw);
	if (typeof result.result !== "string" || !result.result.trim())
		throw new Error("Task returned no final result");
	writeFileSync(
		journal,
		JSON.stringify({
			...state,
			phase: "answered",
			result: result.result,
			model: result.model,
			history: [...history, input, result.result].slice(-4),
		}),
		{ mode: 0o600 },
	);
	return result.result;
}
