export function paymentEnvironment(settings, user, runtime, needsProvider) {
	let database;
	try {
		database = new URL(settings.DATABASE_URL);
	} catch {
		throw Error("A valid private PostgreSQL URL is required");
	}
	if (
		!["postgres:", "postgresql:"].includes(database.protocol) ||
		database.hostname !== "127.0.0.1" ||
		database.port !== "58327" ||
		database.pathname !== "/ocnif_mps" ||
		!database.password
	)
		throw Error("A dedicated password-protected loopback database is required");
	if (!settings.ENCRYPTION_KEY || !settings.ADMIN_KEY)
		throw Error("Dedicated encryption and administrator keys are required");
	const env = {
		PATH: runtime.PATH,
		LANG: runtime.LANG ?? "en_US.UTF-8",
		TMPDIR: runtime.TMPDIR ?? "/tmp",
		NODE_ENV: "production",
		DATABASE_URL: settings.DATABASE_URL,
		ENCRYPTION_KEY: settings.ENCRYPTION_KEY,
		ADMIN_KEY: settings.ADMIN_KEY,
		HOST: "127.0.0.1",
		PORT: "38127",
		SEED_ONLY_IF_EMPTY: "true",
		SEED_V1_LEGACY: "false",
	};
	if (needsProvider) {
		const key = user.BLOCKFROST_API_KEY_PREPROD?.trim();
		if (!key || !key.startsWith("preprod"))
			throw Error(
				"Enter the Preprod Blockfrost project key in the private .env field",
			);
		env.BLOCKFROST_API_KEY_PREPROD = key;
	}
	return env;
}
