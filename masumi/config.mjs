export function endpoint(value, name) {
	const url = new URL(value ?? "");
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	) {
		throw new Error(`${name} must be an HTTP(S) origin without credentials`);
	}
	return url.origin;
}
export function config(env = process.env) {
	const token = env.INTERNAL_TOKEN;
	if (typeof token !== "string" || token.length < 32)
		throw new Error("INTERNAL_TOKEN must contain at least 32 characters");
	const port = Number(env.AGENT_PORT ?? 8098);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Invalid AGENT_PORT");
	const locale = env.AGENT_LOCALE ?? "en";
	if (!["en", "es", "de", "fr"].includes(locale))
		throw new Error("Unsupported AGENT_LOCALE");
	return {
		token,
		port,
		locale,
		host: env.AGENT_HOST ?? "127.0.0.1",
		core: endpoint(env.CORE_HTTP_URL, "CORE_HTTP_URL"),
		agent: endpoint(env.AGENT_URL ?? `http://127.0.0.1:${port}`, "AGENT_URL"),
		coworkerId: env.COWORKER_ID?.trim() || null,
		paidEnabled: env.PAID_TASKS_ENABLED === "true",
		statusDirectory: env.STATUS_DIRECTORY ?? ".local",
	};
}
export function safeTaskId(id) {
	if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))
		throw new Error("Invalid task identifier");
	return id;
}

export function paymentConfig(env = process.env) {
	const port = Number(env.AGENT_API_PORT ?? 21950);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Invalid AGENT_API_PORT");
	return {
		url: endpoint(env.MPS_URL, "MPS_URL"),
		port,
		runtimeToken: env.MPS_RUNTIME_TOKEN,
		adminKey: env.ADMIN_KEY,
		author: env.AGENT_AUTHOR,
		blockfrostKey: env.BLOCKFROST_API_KEY_PREPROD,
	};
}
export function blockfrostConfig(env = process.env) {
	const base =
		env.BLOCKFROST_PREPROD_URL ??
		"https://cardano-preprod.blockfrost.io/api/v0";
	const url = new URL(base);
	if (
		url.origin !== "https://cardano-preprod.blockfrost.io" ||
		url.pathname !== "/api/v0" ||
		url.search ||
		url.hash
	)
		throw new Error("Blockfrost must use official Preprod API");
	return { base, key: env.BLOCKFROST_API_KEY_PREPROD };
}
