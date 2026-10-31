import { brokerUrl } from "./status-evidence.mjs";

const digest = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value) =>
	typeof value === "string" && Number.isFinite(Date.parse(value));

export function applyBrokerEvidence(status, data) {
	if (
		data?.schemaVersion !== 1 ||
		data.network !== "cardano:preprod" ||
		data.status !== "available" ||
		data.provenance !== "authenticated-local-worker-attestation" ||
		!timestamp(data.receivedAt) ||
		!digest(data.payloadSHA256)
	)
		return status;
	const execution = data.execution;
	const verified = Boolean(
		execution?.status === "COMPLETED" &&
			execution.source === "sokosumi-task-readback" &&
			digest(execution.resultSHA256) &&
			digest(data.executionSHA256) &&
			timestamp(execution.completedAt) &&
			timestamp(execution.verifiedAt),
	);
	const workerFresh =
		data.workerFresh === true &&
		timestamp(data.observedAt) &&
		Date.now() - Date.parse(data.observedAt) < 30000 &&
		Date.parse(data.observedAt) <= Date.now() + 10000;
	const removed = new Set(["coworker_setup"]);
	if (workerFresh) removed.add("worker_not_attached");
	if (verified) removed.add("execution_task");
	return {
		...status,
		coworkerConfigured: true,
		workerFresh,
		executionOnly: {
			verified,
			taskId: null,
			...(verified
				? {
						receiptSHA256: data.executionSHA256,
						workspaceKind:
							execution.organizationId === null ? "personal" : "organization",
						completedAt: execution.completedAt,
						verifiedAt: execution.verifiedAt,
					}
				: {}),
		},
		setupRequired: status.setupRequired.filter((code) => !removed.has(code)),
		evidence: {
			source: "local-worker-receipt",
			observedAt: data.receivedAt,
			verification: "authenticated-local-worker-attestation",
		},
	};
}

export async function readBrokerEvidence(settings, status, fetcher = fetch) {
	if (!settings.statusBrokerUrl) return status;
	try {
		const response = await fetcher(brokerUrl(settings.statusBrokerUrl), {
			headers: { authorization: `Bearer ${settings.token}` },
			redirect: "error",
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) return status;
		const text = await response.text();
		if (Buffer.byteLength(text) > 16384) return status;
		return applyBrokerEvidence(status, JSON.parse(text));
	} catch {
		return status;
	}
}
