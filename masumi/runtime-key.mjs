export function verifiedRuntimeKeyScope(key, walletId) {
	if (
		key?.canRead !== true ||
		key.canPay !== true ||
		key.canAdmin !== false ||
		key.NetworkLimit?.length !== 1 ||
		key.NetworkLimit[0] !== "Preprod" ||
		key.walletScopeEnabled !== true ||
		key.WalletScopes?.length !== 1 ||
		key.WalletScopes[0]?.hotWalletId !== walletId ||
		key.x402WalletScopeEnabled !== true ||
		key.X402WalletScopes?.length !== 0
	)
		throw Error(
			"Runtime key must be ReadAndPay for exactly the dedicated Preprod seller wallet",
		);
	return {
		verifiedAt: new Date().toISOString(),
		canRead: key.canRead,
		canPay: key.canPay,
		canAdmin: key.canAdmin,
		NetworkLimit: key.NetworkLimit,
		walletScopeEnabled: key.walletScopeEnabled,
		WalletScopes: key.WalletScopes,
		x402WalletScopeEnabled: key.x402WalletScopeEnabled,
		X402WalletScopes: key.X402WalletScopes,
	};
}
