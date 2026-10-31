// Endpoint semantics from official Sokosumi6748baf, personal-workspace-service.ts.
export async function fetchPersonalWorkspaceAccess(client, signal) {
	const response = await client.get("/v1/users/me/workspaces", signal);
	const data = response?.data;
	if (!data || !Array.isArray(data.workspaces))
		throw new Error("Invalid Workspaces response");
	return data.workspaces.some((workspace) => workspace?.kind === "personal");
}
export async function ensurePersonalWorkspace(client, signal) {
	if (await fetchPersonalWorkspaceAccess(client, signal)) return;
	try {
		const response = await client.post(
			"/v1/users/me/workspaces",
			{ kind: "personal" },
			signal,
		);
		if (typeof response?.data?.id !== "string" || !response.data.id.trim())
			throw new Error(
				"Personal Workspace creation returned no ID; inspect before retry",
			);
	} catch (error) {
		if (
			error?.status === 409 &&
			(await fetchPersonalWorkspaceAccess(client, signal))
		)
			return;
		throw error;
	}
}
export async function verifyPersonalWorkspace(client, workspaceId, signal) {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			workspaceId,
		)
	)
		throw new Error("Invalid personal Workspace ID");
	const { data } = await client.get(`/v1/workspaces/${workspaceId}`, signal);
	if (!data || data.organizationId !== null)
		throw new Error("Core did not confirm an authorized personal Workspace");
}
