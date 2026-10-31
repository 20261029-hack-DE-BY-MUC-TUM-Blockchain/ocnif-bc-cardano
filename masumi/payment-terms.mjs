import { createHash } from "node:crypto";
export const USDM =
	"16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";
export function taskHash(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
export function confirmedState(payment, expected) {
	return (
		(payment.CurrentTransaction?.status === "Confirmed" &&
			payment.CurrentTransaction?.newOnChainState === expected) ||
		payment.TransactionHistory?.some(
			(tx) => tx.status === "Confirmed" && tx.newOnChainState === expected,
		) ||
		false
	);
}
// The pinned sponsor starter supports a legacy MPS response without forceLayer.
// Non-null overrides remain unsupported because task events cannot preserve them.
export function purchasePayload(payment, nonce, registration) {
	if (
		payment.sellerReturnAddress !== null ||
		(payment.forceLayer !== undefined && payment.forceLayer !== null)
	)
		throw new Error(
			"Core Task events cannot preserve non-null signed sellerReturnAddress or forceLayer",
		);
	if (
		payment.PaymentSource?.network !== "Preprod" ||
		payment.PaymentSource?.paymentSourceType !== "Web3CardanoV2"
	)
		throw new Error("Payment source is not Preprod Web3CardanoV2");
	if (payment.agentIdentifier !== registration.agentIdentifier)
		throw new Error("Quote agent differs from confirmed registration");
	if (payment.SmartContractWallet?.id !== registration.walletId)
		throw new Error("Payment wallet differs from dedicated seller wallet");
	if (
		payment.RequestedFunds.length !== 1 ||
		payment.RequestedFunds[0].unit !== USDM ||
		payment.RequestedFunds[0].amount !== "1000000"
	)
		throw new Error("Signed quote differs from 1 test USDM");
	return {
		blockchainIdentifier: payment.blockchainIdentifier,
		agentIdentifier: payment.agentIdentifier,
		sellerVkey: payment.SmartContractWallet.walletVkey,
		submitResultTime: payment.submitResultTime,
		payByTime: payment.payByTime,
		unlockTime: payment.unlockTime,
		externalDisputeUnlockTime: payment.externalDisputeUnlockTime,
		inputHash: payment.inputHash,
		identifierFromPurchaser: nonce,
		paymentSourceType: "Web3CardanoV2",
		supportedPaymentSourceIndex: registration.supportedPaymentSourceIndex,
		Amounts: payment.RequestedFunds.map(({ amount, unit }) => ({
			amount,
			unit,
		})),
		PaymentSource: {
			network: "Preprod",
			smartContractAddress: payment.PaymentSource.smartContractAddress,
			policyId: payment.PaymentSource.policyId,
		},
	};
}

export function verifyRequestedTerms(payment, request) {
	if (
		!request ||
		payment.inputHash !== request.inputHash ||
		payment.agentIdentifier !== request.agentIdentifier
	)
		throw new Error("Quote differs from the saved task request");
	for (const field of [
		"payByTime",
		"submitResultTime",
		"unlockTime",
		"externalDisputeUnlockTime",
	]) {
		if (Number(payment[field]) !== Date.parse(request[field]))
			throw new Error("Quote deadline differs from saved request");
	}
}
