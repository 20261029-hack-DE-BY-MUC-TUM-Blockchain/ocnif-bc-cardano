import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { paymentConfig } from "./config.mjs";
import {
	confirmedState,
	purchasePayload,
	taskHash,
	USDM,
	verifyRequestedTerms,
} from "./payment-terms.mjs";
import { verifiedRuntimeKeyScope } from "./runtime-key.mjs";
import { verifySettlement } from "./settlement.mjs";
import { loadSokosumiRuntime } from "./sokosumi-runtime.mjs";
import {
	assertTaskTarget,
	taskTarget,
	verifyRuntimeTask,
} from "./task-target.mjs";

export {
	confirmedState,
	purchasePayload,
	taskHash,
	USDM,
} from "./payment-terms.mjs";

const MINUTE = 60 * 1000;
export function isPaidReady() {
	if (
		!existsSync(".local/registration-state.json") ||
		!existsSync(".local/mps-runtime.env")
	)
		return false;
	const r = JSON.parse(readFileSync(".local/registration-state.json", "utf8"));
	try {
		verifiedRuntimeKeyScope(r.keyEvidence, r.walletId);
	} catch {
		return false;
	}
	return Boolean(
		r.agentIdentifier &&
			Number.isInteger(r.supportedPaymentSourceIndex) &&
			r.supportedPaymentSourceIndex >= 0 &&
			r.sellerVkey &&
			r.walletId &&
			(r.status === "RegistrationConfirmed" ||
				r.registrationState === "RegistrationConfirmed" ||
				r.registration?.state === "RegistrationConfirmed"),
	);
}
export async function createPaidAdapter({
	save,
	answer,
	core: providedCore,
	mps: providedMps,
	registration: providedRegistration,
	target = taskTarget(),
}) {
	const registration = () =>
		providedRegistration ??
		JSON.parse(readFileSync(".local/registration-state.json", "utf8"));
	let core = providedCore;
	async function getCore() {
		if (!core) {
			const { readRuntimeCredential, createCoworkerHttpClient } =
				await loadSokosumiRuntime();
			core = createCoworkerHttpClient({
				apiKey: readRuntimeCredential(target.coworkerId),
			});
		}
		return core;
	}
	async function mps(path, body) {
		if (providedMps) return providedMps(path, body);
		const env = parseEnv(readFileSync(".local/mps-runtime.env", "utf8"));
		const response = await fetch(`${paymentConfig().url}${path}`, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(30000),
			headers: {
				"Content-Type": "application/json",
				token: env.MPS_RUNTIME_TOKEN,
			},
			body: JSON.stringify(body),
		});
		const data = await response.json();
		if (!response.ok || data.status !== "success")
			throw new Error(
				`MPS ${path} failed HTTP ${response.status}. Inspect saved state before retry.`,
			);
		return data.data;
	}
	async function persist(task, state, paid) {
		const next = { ...state, paid };
		await save(task.id, next);
		return next;
	}
	return {
		async advance(task, state) {
			assertTaskTarget(task, target);
			await verifyRuntimeTask(await getCore(), task.id, target);
			let p = state.paid ?? {};
			const r = registration();
			if (!p.stage) {
				if (
					typeof state.input !== "string" ||
					!state.input.trim() ||
					Buffer.byteLength(state.input, "utf8") > 12000
				)
					throw new Error("Paid Task requires authoritative started input");
				const nonce = randomBytes(10).toString("hex");
				const now = Date.now();
				const body = {
					network: "Preprod",
					agentIdentifier: r.agentIdentifier,
					paymentSourceType: "Web3CardanoV2",
					supportedPaymentSourceIndex: r.supportedPaymentSourceIndex,
					inputHash: taskHash(state.input),
					identifierFromPurchaser: nonce,
					RequestedFunds: [{ amount: "1000000", unit: USDM }],
					payByTime: new Date(now + 5 * MINUTE).toISOString(),
					submitResultTime: new Date(now + 20 * MINUTE).toISOString(),
					unlockTime: new Date(now + 36 * MINUTE).toISOString(),
					externalDisputeUnlockTime: new Date(now + 52 * MINUTE).toISOString(),
					metadata: JSON.stringify({ taskId: task.id }),
				};
				if (
					!body.agentIdentifier ||
					!Number.isInteger(body.supportedPaymentSourceIndex)
				)
					throw new Error(
						"Registration identifier and source index are required",
					);
				state = await persist(task, state, {
					stage: "terms-pending",
					nonce,
					request: body,
				});
				const payment = await mps("/api/v1/payment", body);
				return persist(task, state, {
					...state.paid,
					stage: "terms-saved",
					payment,
				});
			}
			if (p.stage === "terms-saved") {
				const payload = purchasePayload(p.payment, p.nonce, r);
				verifyRequestedTerms(p.payment, p.request);
				if (Date.now() >= Number(p.payment.payByTime))
					throw new Error("Signed payment deadline expired");
				state = await persist(task, state, {
					...p,
					payload,
					stage: "purchase-pending",
				});
				const response = await (
					await verifyRuntimeTask(await getCore(), task.id, target)
				).post(`/v1/tasks/${encodeURIComponent(task.id)}/events`, {
					comment: "Payment requested: 1 test USDM.",
					masumiPayment: payload,
				});
				return persist(task, state, {
					...p,
					stage: "awaiting-escrow",
					eventId: response.data.id,
				});
			}
			if (
				["awaiting-escrow", "awaiting-result", "awaiting-withdrawal"].includes(
					p.stage,
				)
			) {
				const observed = await mps(
					"/api/v1/payment/resolve-blockchain-identifier",
					{
						network: "Preprod",
						blockchainIdentifier: p.payment.blockchainIdentifier,
						includeHistory: "true",
					},
				);
				p = { ...p, observed };
				state = await persist(task, state, p);
				if (p.stage === "awaiting-escrow") {
					if (
						observed.onChainState !== "FundsLocked" ||
						!confirmedState(observed, "FundsLocked")
					)
						return state;
					if (Date.now() >= Number(p.payment.submitResultTime))
						throw new Error("Result deadline expired before model");
					state = await persist(task, state, { ...p, stage: "model-pending" });
					if (Date.now() >= Number(p.payment.submitResultTime))
						throw new Error("Result deadline expired before model send");
					const result = await answer(
						state.input,
						`.local/${task.id}-session.json`,
						Number(p.payment.submitResultTime),
					);
					if (typeof result !== "string" || !result.trim())
						throw new Error("Model did not return a result");
					writeFileSync(`.local/${task.id}.txt`, result, { mode: 0o600 });
					return persist(task, state, {
						...p,
						stage: "result-saved",
						result,
						resultHash: taskHash(result),
					});
				}
				if (
					p.stage === "awaiting-result" &&
					observed.resultHash === p.resultHash &&
					confirmedState(observed, "ResultSubmitted") &&
					observed.onChainState === "ResultSubmitted"
				)
					return persist(task, state, { ...p, stage: "complete-ready" });
				if (
					p.stage === "awaiting-withdrawal" &&
					["Withdrawn", "DisputedWithdrawn"].includes(observed.onChainState)
				) {
					const evidence = await verifySettlement({
						core: await verifyRuntimeTask(await getCore(), task.id, target),
						taskId: task.id,
						payment: observed,
						sellerAddress:
							registration().registration?.SmartContractWallet?.walletAddress,
						unit: USDM,
					});
					return persist(task, state, {
						...p,
						stage: evidence.verified ? "settled" : "awaiting-withdrawal",
						settlement: evidence,
					});
				}
				return state;
			}
			if (p.stage === "result-saved") {
				if (Date.now() >= Number(p.payment.submitResultTime))
					throw new Error("Result deadline expired before submit");
				state = await persist(task, state, { ...p, stage: "submit-pending" });
				await mps("/api/v1/payment/submit-result", {
					network: "Preprod",
					blockchainIdentifier: p.payment.blockchainIdentifier,
					submitResultHash: p.resultHash,
				});
				return persist(task, state, { ...p, stage: "awaiting-result" });
			}
			if (p.stage === "complete-ready") {
				state = await persist(task, state, { ...p, stage: "complete-pending" });
				const response = await (
					await verifyRuntimeTask(await getCore(), task.id, target)
				).post(`/v1/tasks/${encodeURIComponent(task.id)}/events`, {
					status: "COMPLETED",
					comment: p.result,
				});
				return persist(
					task,
					{ ...state, phase: "completed" },
					{
						...p,
						stage: "awaiting-withdrawal",
						completionEventId: response.data.id,
					},
				);
			}
			if (p.stage.endsWith("-pending"))
				throw new Error(
					`Uncertain ${p.stage}. Inspect prior operation before recovery; automatic retry disabled.`,
				);
			return state;
		},
	};
}
