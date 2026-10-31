import {
  Address,
  Ed25519Signature,
  KeyHash,
  Transaction,
  TransactionBody,
  TransactionHash,
  VKey,
} from "@evolution-sdk/evolution";
import type { CardanoApproval } from "./types.ts";

export function transactionBase64(transaction: Transaction.Transaction): string {
  return btoa(
    Array.from(Transaction.toCBORBytes(transaction), (byte) => String.fromCharCode(byte)).join(""),
  );
}

export function signedTransactionId(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return TransactionHash.toHex(
    TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(bytes)),
  );
}

export function validatePaymentTransaction(
  transaction: Transaction.Transaction,
  approval: CardanoApproval,
  changeAddress: string,
  nonce: string,
  maxTtl: bigint,
  requiredKeyHashes?: string[],
): void {
  const body = transaction.body;
  const inputs = body.inputs.map(
    (input) => `${TransactionHash.toHex(input.transactionId)}#${input.index}`,
  );
  if (!inputs.includes(nonce) || new Set(inputs).size !== inputs.length)
    throw new Error("cardano_nonce_mismatch");
  if (body.fee > BigInt(approval.maxFeeLovelace)) throw new Error("cardano_fee_budget_exceeded");
  if (body.ttl === undefined || body.ttl > maxTtl) throw new Error("cardano_invalid_expiry");
  if (!transaction.isValid || (body.networkId !== undefined && body.networkId !== 0))
    throw new Error("cardano_invalid_network");
  for (const field of [
    "mint",
    "withdrawals",
    "certificates",
    "proposalProcedures",
    "votingProcedures",
    "donation",
    "collateralInputs",
    "collateralReturn",
    "totalCollateral",
    "referenceInputs",
    "scriptDataHash",
    "auxiliaryDataHash",
  ] as const) {
    if (body[field] !== undefined) throw new Error("cardano_unapproved_operation");
  }
  let recipients = 0;
  for (const output of body.outputs) {
    const address = Address.toBech32(output.address);
    if (output.datumOption || output.scriptRef) throw new Error("cardano_unapproved_output");
    if (address === approval.payTo) {
      recipients++;
      if (output.assets.lovelace !== BigInt(approval.amount) || output.assets.multiAsset)
        throw new Error("cardano_payment_mismatch");
    } else if (address !== changeAddress) throw new Error("cardano_unapproved_recipient");
  }
  if (recipients !== 1) throw new Error("cardano_payment_mismatch");
  if (requiredKeyHashes) {
    const witnesses = transaction.witnessSet.vkeyWitnesses ?? [];
    const signed = new Set(
      witnesses.map((witness) => KeyHash.toHex(KeyHash.fromVKey(witness.vkey))),
    );
    const hash = TransactionHash.toBytes(TransactionBody.toHash(transaction.body));
    if (
      !witnesses.length ||
      requiredKeyHashes.some((key) => !signed.has(key)) ||
      witnesses.some(
        (witness) => !VKey.verify(witness.vkey, hash, Ed25519Signature.toBytes(witness.signature)),
      )
    )
      throw new Error("cardano_invalid_wallet_signature");
  }
}
