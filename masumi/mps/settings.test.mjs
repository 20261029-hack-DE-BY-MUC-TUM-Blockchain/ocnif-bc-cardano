import assert from "node:assert/strict";
import test from "node:test";
import { paymentEnvironment } from "./settings.mjs";

const settings = {
	DATABASE_URL: "postgresql://ocnif_mps:fixture@127.0.0.1:58327/ocnif_mps",
	ENCRYPTION_KEY: "fixture-encryption",
	ADMIN_KEY: "fixture-administrator",
};

test("payment child receives no provider, mainnet, or shell-injection environment", () => {
	const user = {
		BLOCKFROST_API_KEY_PREPROD: "preprod-fixture",
		BLOCKFROST_API_KEY_MAINNET: "mainnet-fixture",
	};
	const env = paymentEnvironment(
		settings,
		user,
		{
			PATH: "/usr/bin",
			OPENAI_API_KEY: "fixture-provider",
			NODE_OPTIONS: "--inspect=0.0.0.0",
		},
		true,
	);
	assert.equal(env.OPENAI_API_KEY, undefined);
	assert.equal(env.NODE_OPTIONS, undefined);
	assert.equal(env.BLOCKFROST_API_KEY_MAINNET, undefined);
	assert.equal(env.BLOCKFROST_API_KEY_PREPROD, "preprod-fixture");
	assert.equal(env.HOST, "127.0.0.1");
});

test("database operations do not require or forward a Blockfrost key", () => {
	const env = paymentEnvironment(
		settings,
		{ BLOCKFROST_API_KEY_PREPROD: "preprod-fixture" },
		{},
		false,
	);
	assert.equal(env.BLOCKFROST_API_KEY_PREPROD, undefined);
});

test("seed and service reject missing, Preview, and Mainnet project keys", () => {
	for (const key of [undefined, "", "preview-fixture", "mainnet-fixture"]) {
		assert.throws(
			() =>
				paymentEnvironment(
					settings,
					{ BLOCKFROST_API_KEY_PREPROD: key },
					{},
					true,
				),
			/Preprod/,
		);
	}
});

test("remote or unrelated database configurations are rejected", () => {
	for (const url of [
		"postgresql://u:p@remote.example:58327/ocnif_mps",
		"postgresql://u:p@127.0.0.1:5432/ocnif_mps",
		"postgresql://u:p@127.0.0.1:58327/another-app",
		"postgresql://u@127.0.0.1:58327/ocnif_mps",
	])
		assert.throws(
			() =>
				paymentEnvironment({ ...settings, DATABASE_URL: url }, {}, {}, false),
			/dedicated/,
		);
});
