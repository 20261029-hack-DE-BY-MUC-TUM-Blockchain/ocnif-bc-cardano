import assert from "node:assert/strict";
import test from "node:test";
import { verifiedRuntimeKeyScope } from "./runtime-key.mjs";

const key = {
	canRead: true,
	canPay: true,
	canAdmin: false,
	NetworkLimit: ["Preprod"],
	walletScopeEnabled: true,
	WalletScopes: [{ hotWalletId: "seller-wallet" }],
	x402WalletScopeEnabled: true,
	X402WalletScopes: [],
	token: "synthetic-revealed-value",
};

test("key evidence follows the actual MPS response shape and excludes the token", () => {
	const evidence = verifiedRuntimeKeyScope(key, "seller-wallet");
	assert.deepEqual(evidence.WalletScopes, [{ hotWalletId: "seller-wallet" }]);
	assert.equal(evidence.token, undefined);
});

test("administrator, Mainnet, unscoped, unrelated, or EVM wallet access fails closed", () => {
	for (const changed of [
		{ canAdmin: true },
		{ NetworkLimit: ["Preprod", "Mainnet"] },
		{ walletScopeEnabled: false },
		{ WalletScopes: [{ hotWalletId: "another-wallet" }] },
		{ WalletScopes: [] },
		{ x402WalletScopeEnabled: false },
		{ X402WalletScopes: [{ evmWalletId: "evm-wallet" }] },
	])
		assert.throws(
			() => verifiedRuntimeKeyScope({ ...key, ...changed }, "seller-wallet"),
			/dedicated Preprod/,
		);
});
