import fs from "node:fs";
import { paymentConfig } from "./config.mjs";
import {
	registrationUrl,
	requireAgentAuthor,
	requireSavedRuntimeToken,
} from "./registration-config.mjs";
import { verifiedRuntimeKeyScope } from "./runtime-key.mjs";

const statePath = ".local/registration-state.json";
const payment = JSON.parse(fs.readFileSync(".local/payment-state.json"));
const state = fs.existsSync(statePath)
	? JSON.parse(fs.readFileSync(statePath))
	: {
			provenance:
				"User-supplied dedicated resource identifiers; verify registry separately",
			sourceId: payment.sourceId,
			walletId: payment.walletId,
		};
const save = () =>
	fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const settings = paymentConfig();
const base = `${settings.url}/api/v1`;
const headers = {
	token: settings.adminKey,
	"content-type": "application/json",
};
async function request(path, body) {
	const r = await fetch(base + path, {
		headers,
		method: body ? "POST" : "GET",
		redirect: "error",
		signal: AbortSignal.timeout(30000),
		body: body ? JSON.stringify(body) : undefined,
	});
	const j = await r.json();
	if (!r.ok || j.status !== "success")
		throw Error(
			`Payment service HTTP ${r.status}; inspect the private setup state.`,
		);
	return j.data;
}
if (process.argv[2] === "key") {
	if (state.runtimeKeyId) {
		requireSavedRuntimeToken(".local/mps-runtime.env");
		state.keyEvidence = verifiedRuntimeKeyScope(
			state.keyEvidence,
			payment.walletId,
		);
		save();
		console.log("Runtime key already saved", state.runtimeKeyId);
		process.exit(0);
	}
	if (state.keyWritePending)
		throw Error(
			"Previous key write uncertain; inspect API key records before retry",
		);
	state.keyWritePending = true;
	save();
	const key = await request("/api-key", {
		usageLimited: "false",
		UsageCredits: [],
		NetworkLimit: ["Preprod"],
		ChainIdLimit: [],
		canRead: true,
		canPay: true,
		canAdmin: false,
		walletScopeEnabled: true,
		WalletScopeHotWalletIds: [payment.walletId],
		x402WalletScopeEnabled: true,
		X402WalletScopeEvmWalletIds: [],
	});
	state.runtimeKeyId = key.id;
	state.keyWritePending = false;
	save();
	if (typeof key.token !== "string" || key.token.startsWith("*****"))
		throw Error(
			"Created key token was not revealed; key ID preserved for supported token update",
		);
	fs.writeFileSync(
		".local/mps-runtime.env",
		`MPS_RUNTIME_TOKEN=${key.token}\n`,
		{ mode: 0o600 },
	);
	state.runtimeKeyId = key.id;
	state.keyWritePending = false;
	state.keyEvidence = verifiedRuntimeKeyScope(key, payment.walletId);
	save();
	console.log("Runtime key created", key.id, JSON.stringify(state.keyEvidence));
} else if (process.argv[2] === "register") {
	const author = requireAgentAuthor(settings.author);
	if (state.registrationId) {
		console.log("Registration already saved", state.registrationId);
		process.exit(0);
	}
	if (state.registrationWritePending)
		throw Error(
			"Previous registration write uncertain; inspect registry before retry",
		);
	const wallet = await request(
		`/wallet?walletType=Selling&id=${payment.walletId}`,
	);
	const sources = await request("/payment-source?take=100");
	const find = (x) => {
		if (Array.isArray(x)) {
			for (const y of x) {
				const r = find(y);
				if (r) return r;
			}
		} else if (x && typeof x === "object") {
			if (x.id === payment.sourceId) return x;
			for (const y of Object.values(x)) {
				const r = find(y);
				if (r) return r;
			}
		}
	};
	const source = find(sources);
	if (!source || wallet.walletAddress !== payment.sellerAddress)
		throw Error("Dedicated source or wallet mismatch");
	const body = {
		network: "Preprod",
		type: "Standard",
		sellingWalletVkey: wallet.walletVkey,
		supportedPaymentSources: [
			{
				chain: "Cardano",
				network: "Preprod",
				paymentSourceType: "Web3CardanoV2",
				address: source.smartContractAddress,
				pricing: { pricingType: "Dynamic" },
			},
		],
		ExampleOutputs: [],
		Tags: ["hackathon", "security-evidence"],
		name: "Ocnif Evidence Reviewer",
		description:
			"Reviews supplied security evidence and returns defensive remediation guidance through the Ocnif Rust core.",
		Capability: { name: "Ocnif Rust-core evidence review", version: "1" },
		Author: { name: author },
		apiBaseUrl: registrationUrl(settings.port),
	};
	state.registrationWritePending = true;
	state.request = body;
	save();
	const r = await request("/registry", body);
	state.registrationId = r.id;
	state.registrationWritePending = false;
	state.registration = r;
	save();
	console.log(JSON.stringify({ id: r.id, state: r.state ?? "pending" }));
} else {
	const r = await request(
		"/registry?network=Preprod&filterPaymentSourceType=Web3CardanoV2&limit=100",
	);
	state.observedRegistry = r;
	const walk = (x) => {
		if (Array.isArray(x)) {
			for (const y of x) walk(y);
		} else if (x && typeof x === "object") {
			if (x.id === state.registrationId) {
				state.registration = x;
				state.agentIdentifier = x.agentIdentifier;
				state.registrationState = x.state;
			} else Object.values(x).forEach(walk);
		}
	};
	walk(r);
	save();
	console.log(
		JSON.stringify({
			id: state.registrationId,
			state: state.registration?.state,
			agentIdentifier: state.agentIdentifier,
		}),
	);
}
