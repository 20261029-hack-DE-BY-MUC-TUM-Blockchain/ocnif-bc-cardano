import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readBrokerEvidence } from "./status-reader.mjs";

function privateRecord(directory, name) {
	try {
		return JSON.parse(readFileSync(join(directory, name), "utf8"));
	} catch {
		return null;
	}
}

export async function readiness(settings, fetcher = fetch) {
	let agentReady = false;
	try {
		const response = await fetcher(`${settings.core}/health`, {
			redirect: "error",
			signal: AbortSignal.timeout(3000),
		});
		agentReady = response.ok;
	} catch {
		/* A health failure is public readiness data, never model evidence. */
	}
	const directory = settings.statusDirectory;
	const worker = privateRecord(directory, "worker-status.json");
	const proof = privateRecord(directory, "execution-proof.json");
	const workerMatches = Boolean(
		settings.coworkerId && worker?.coworkerId === settings.coworkerId,
	);
	const workerAttached =
		workerMatches && Date.now() - Date.parse(worker.observedAt) < 30000;
	const executionVerified = Boolean(
		workerMatches &&
			proof?.coworkerId === settings.coworkerId &&
			proof?.organizationId === null &&
			proof?.status === "COMPLETED" &&
			/^[a-zA-Z0-9_-]{1,120}$/.test(proof?.taskId ?? "") &&
			/^[a-f0-9]{64}$/.test(proof?.resultSHA256 ?? "") &&
			Number.isFinite(Date.parse(proof?.completedAt)),
	);
	const registrationConfirmed = Boolean(
		workerMatches && worker.registrationConfirmed === true,
	);
	const settlementVerified = Boolean(
		workerMatches && worker.settlementVerified === true,
	);
	const setupRequired = [];
	if (!settings.coworkerId) setupRequired.push("coworker_setup");
	if (!workerAttached) setupRequired.push("worker_not_attached");
	if (!executionVerified) setupRequired.push("execution_task");
	if (!registrationConfirmed)
		setupRequired.push("masumi_payment_service", "masumi_registration");
	if (!settlementVerified) setupRequired.push("paid_task");
	const status = {
		integration: "masumi-sokosumi",
		network: "cardano:preprod",
		agentReady,
		coworkerConfigured: Boolean(settings.coworkerId),
		executionOnly: {
			verified: executionVerified,
			taskId: null,
			...(executionVerified
				? { source: "local-worker-receipt", observedAt: proof.completedAt }
				: {}),
		},
		paid: {
			enabled: settings.paidEnabled,
			registrationConfirmed,
			settlementVerified,
		},
		setupRequired,
		...(workerMatches
			? {
					evidence: {
						source: "local-worker-receipt",
						observedAt: worker.observedAt,
					},
				}
			: {}),
	};
	return readBrokerEvidence(settings, status, fetcher);
}
