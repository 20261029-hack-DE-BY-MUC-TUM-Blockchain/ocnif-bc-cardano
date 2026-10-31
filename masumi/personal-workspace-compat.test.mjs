import test from "node:test";
import assert from "node:assert/strict";
import {
	fetchPersonalWorkspaceAccess,
	ensurePersonalWorkspace,
	verifyPersonalWorkspace,
} from "./personal-workspace-compat.mjs";
test("current official personal-workspace route retains explicit personal distinction", async () => {
	const client = {
		get: async (path) => {
			assert.equal(path, "/v1/users/me/workspaces");
			return { data: { workspaces: [{ kind: "organization" }] } };
		},
		post: async (path, body) => {
			assert.equal(path, "/v1/users/me/workspaces");
			assert.deepEqual(body, { kind: "personal" });
			return { data: { id: "created-fixture" } };
		},
	};
	assert.equal(await fetchPersonalWorkspaceAccess(client), false);
	await ensurePersonalWorkspace(client);
	await assert.rejects(
		fetchPersonalWorkspaceAccess({
			get: async () => ({ data: { hasPersonalWorkspace: true } }),
		}),
		/Invalid Workspaces/,
	);
});
test("compatibility preserves personal ownership verification and does not bypass an API denial", async () => {
	const id = "00000000-0000-0000-0000-000000000001";
	await assert.rejects(
		verifyPersonalWorkspace(
			{ get: async () => ({ data: { organizationId: "other" } }) },
			id,
		),
		/authorized personal/,
	);
	await assert.rejects(
		ensurePersonalWorkspace({
			get: async () => {
				throw Error("403 denied");
			},
		}),
		/403 denied/,
	);
});
