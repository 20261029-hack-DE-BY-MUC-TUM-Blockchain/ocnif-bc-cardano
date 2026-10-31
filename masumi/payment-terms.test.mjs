import test from "node:test";
import assert from "node:assert/strict";
import { verifyRequestedTerms } from "./payment-terms.mjs";
test("signed quote must preserve the saved input and all four deadlines", () => {
	const request = {
		inputHash: "fixture-hash",
		agentIdentifier: "fixture-agent",
		payByTime: "2026-10-31T13:00:00Z",
		submitResultTime: "2026-10-31T13:20:00Z",
		unlockTime: "2026-10-31T13:36:00Z",
		externalDisputeUnlockTime: "2026-10-31T13:52:00Z",
	};
	const payment = { ...request };
	for (const key of [
		"payByTime",
		"submitResultTime",
		"unlockTime",
		"externalDisputeUnlockTime",
	])
		payment[key] = String(Date.parse(request[key]));
	verifyRequestedTerms(payment, request);
	assert.throws(
		() => verifyRequestedTerms({ ...payment, inputHash: "another" }, request),
		/saved task request/,
	);
	for (const key of [
		"payByTime",
		"submitResultTime",
		"unlockTime",
		"externalDisputeUnlockTime",
	])
		assert.throws(
			() => verifyRequestedTerms({ ...payment, [key]: "1" }, request),
			/deadline/,
		);
});
