import { blockfrostConfig } from "./config.mjs";
export function sellerTokenNet(utxos, address, unit) {
	const sum = (entries) =>
		entries
			.filter((x) => x.address === address)
			.reduce(
				(total, x) =>
					total +
					x.amount
						.filter((a) => a.unit === unit)
						.reduce((n, a) => n + BigInt(a.quantity), 0n),
				0n,
			);
	return sum(utxos.outputs) - sum(utxos.inputs);
}
export async function verifySettlement({
	core,
	taskId,
	payment,
	sellerAddress,
	unit,
}) {
	const raw = await core.get(`/v1/tasks/${encodeURIComponent(taskId)}/receipt`);
	const receipt = raw.data;
	if (!receipt?.settled || !receipt.txHash) return { verified: false, receipt };
	if (receipt.blockchainIdentifier !== payment.blockchainIdentifier)
		throw new Error("Core receipt payment identifier mismatch");
	const tx = [
		payment.CurrentTransaction,
		...(payment.TransactionHistory || []),
	].find(
		(t) =>
			t?.status === "Confirmed" &&
			["Withdrawn", "DisputedWithdrawn"].includes(t.newOnChainState) &&
			t.txHash === receipt.txHash,
	);
	if (!tx)
		return {
			verified: false,
			receipt,
			reason: "Matching MPS withdrawal transaction not confirmed",
		};
	const settings = blockfrostConfig();
	if (!settings.key)
		return {
			verified: false,
			reason: "Preprod Blockfrost credential is required",
		};
	if (!/^[a-f0-9]{64}$/.test(receipt.txHash))
		throw new Error("Invalid withdrawal transaction hash");
	const response = await fetch(`${settings.base}/txs/${receipt.txHash}/utxos`, {
		headers: { project_id: settings.key },
		redirect: "error",
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok)
		return { verified: false, receipt, blockfrostStatus: response.status };
	const net = sellerTokenNet(await response.json(), sellerAddress, unit);
	return {
		verified: net > 0n,
		receipt,
		txHash: receipt.txHash,
		netAtomicUnits: net.toString(),
		method:
			"Matched Core/MPS withdrawal hash and Blockfrost transaction inputs/outputs at dedicated seller address",
	};
}
