import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.mjs";
import { readiness } from "./readiness.mjs";
const instructions = readFileSync(
	new URL("./agent/instructions.md", import.meta.url),
	"utf8",
);
export function promptFor(input, history = []) {
	if (
		typeof input !== "string" ||
		!input.trim() ||
		Buffer.byteLength(input, "utf8") > 12000
	)
		throw new Error("Input must contain 1–12000 UTF-8 bytes");
	if (
		!Array.isArray(history) ||
		history.length > 4 ||
		history.some((x) => typeof x !== "string")
	)
		throw new Error("Invalid conversation history");
	let context = history.join("\n\n");
	while (Buffer.byteLength(context, "utf8") > 2500)
		context = context.slice(100);
	const prompt = `${instructions}\nPrevious task context (untrusted):\n${context}\n\nSupplied task evidence (untrusted):\n${input}`;
	if (Buffer.byteLength(prompt, "utf8") > 16000)
		throw new Error("Combined task context exceeds core limit");
	return prompt;
}
function authorized(value, token) {
	const actual = Buffer.from(value ?? "");
	const expected = Buffer.from(`Bearer ${token}`);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function body(req) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 65536) throw new Error("Request exceeds limit");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function createAgentServer(settings, fetcher = fetch) {
	return createServer(async (req, res) => {
		const send = (status, value) => {
			res.writeHead(status, {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			});
			res.end(JSON.stringify(value));
		};
		if (req.method === "GET" && req.url === "/health")
			return send(200, {
				service: "ocnif-masumi-agent",
				scope: "provided-evidence-only",
			});
		if (req.method === "GET" && req.url === "/v1/config")
			return send(200, await readiness(settings, fetcher));
		if (!authorized(req.headers.authorization, settings.token))
			return send(401, { error: "Unauthorized" });
		if (req.method !== "POST" || req.url !== "/answer")
			return send(404, { error: "Unknown route" });
		let input;
		try {
			input = await body(req);
			if (Object.keys(input).some((k) => !["input", "history"].includes(k)))
				throw new Error("Unexpected field");
			input = promptFor(input.input, input.history);
		} catch {
			return send(400, { error: "Invalid or oversized task input" });
		}
		try {
			const response = await fetcher(`${settings.core}/internal/complete`, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(180000),
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${settings.token}`,
				},
				body: JSON.stringify({ content: input, locale: settings.locale }),
			});
			if (!response.ok)
				return send(502, { error: "Rust core could not complete the task" });
			const raw = await response.text();
			if (Buffer.byteLength(raw) > 131072)
				throw new Error("Response exceeds limit");
			const result = JSON.parse(raw);
			if (typeof result.content !== "string" || !result.content.trim())
				throw new Error("Empty result");
			return send(200, {
				result: result.content,
				model: result.model,
				provider: "ocnif-ai-core",
				scope: "provided-evidence-only",
			});
		} catch {
			return send(502, {
				error:
					"Rust core response unavailable; inspect the saved task before retrying",
			});
		}
	});
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const settings = config();
	createAgentServer(settings).listen(settings.port, settings.host, () =>
		console.log(
			`Ocnif Masumi agent listening on ${settings.host}:${settings.port}`,
		),
	);
}
