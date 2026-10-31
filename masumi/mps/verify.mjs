import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyCheckout } from "./prepare.mjs";

const checkout = path.resolve(process.argv[2] ?? "");
verifyCheckout(checkout);
const helpers = await import(
	pathToFileURL(path.join(checkout, "prisma/seed.validation.ts"))
);
const sentinel = "synthetic-wallet-secret-must-never-be-logged";
const warnings = [];
const previous = console.warn;
try {
	console.warn = (...values) => warnings.push(values.join(" "));
	helpers.printGeneratedMnemonics([
		{
			mnemonic: sentinel,
			wasGenerated: true,
			envName: "SELLING_WALLET_PREPROD_MNEMONIC",
		},
	]);
	assert.equal(warnings.length, 1);
	assert.ok(!warnings.join("\n").includes(sentinel));
	warnings.length = 0;
	helpers.printGeneratedMnemonics([
		{
			mnemonic: sentinel,
			wasGenerated: false,
			envName: "SELLING_WALLET_PREPROD_MNEMONIC",
		},
	]);
	assert.equal(warnings.length, 0);
} finally {
	console.warn = previous;
}
assert.deepEqual(helpers.validatePreprodSeedPrerequisites({}), {
	ok: false,
	missing: ["DATABASE_URL", "ENCRYPTION_KEY", "BLOCKFROST_API_KEY_PREPROD"],
});
console.log(
	"Pinned source, mnemonic-log suppression, and seed prerequisites verified",
);
