import test from "node:test";
import assert from "node:assert/strict";
import {
  Address,
  Assets,
  KeyHash,
  PrivateKey,
  Transaction,
  TransactionBody,
  TransactionHash,
  TransactionInput,
  TransactionWitnessSet,
  TxOut,
} from "@evolution-sdk/evolution";
import { createCip30Signer, type CardanoApproval, type Cip30Api } from "../client/index.ts";
import {
  signedTransactionId,
  transactionBase64,
  validatePaymentTransaction,
} from "../client/transaction.ts";

const key = PrivateKey.fromBytes(new Uint8Array(32).fill(3));
const publicKey = PrivateKey.toPublicKey(key);
const owner = new Address.Address({ networkId: 0, paymentCredential: KeyHash.fromVKey(publicKey) });
const recipient = Address.fromBech32(
  "addr_test1vqg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygxrcya6",
);
const approval: CardanoApproval = {
  network: "cardano:preprod",
  payTo: Address.toBech32(recipient),
  amount: "2000000",
  maxFeeLovelace: "500000",
  resourceUrl: "https://ocnif.example/paid/reports/test",
};
const input = new TransactionInput.TransactionInput({
  transactionId: TransactionHash.fromHex("aa".repeat(32)),
  index: 0n,
});
const nonce = "aa".repeat(32) + "#0";
function transaction() {
  const body = new TransactionBody.TransactionBody({
    inputs: [input],
    outputs: [
      new TxOut.TransactionOutput({ address: recipient, assets: Assets.fromLovelace(2000000n) }),
      new TxOut.TransactionOutput({ address: owner, assets: Assets.fromLovelace(2800000n) }),
    ],
    fee: 200000n,
    ttl: 1000n,
  });
  const witness = new TransactionWitnessSet.VKeyWitness({
    vkey: publicKey,
    signature: PrivateKey.sign(key, TransactionHash.toBytes(TransactionBody.toHash(body))),
  });
  return new Transaction.Transaction({
    body,
    witnessSet: new TransactionWitnessSet.TransactionWitnessSet({ vkeyWitnesses: [witness] }),
    isValid: true,
    auxiliaryData: null,
  });
}
test("browser signer transaction checks validate Ed25519, exact outputs, nonce and fee before release", () => {
  const tx = transaction();
  const hash = KeyHash.toHex(KeyHash.fromVKey(publicKey));
  validatePaymentTransaction(tx, approval, Address.toBech32(owner), nonce, 1000n, [hash]);
  assert.equal(
    signedTransactionId(transactionBase64(tx)),
    TransactionHash.toHex(TransactionBody.toHash(tx.body)),
  );
  assert.throws(
    () =>
      validatePaymentTransaction(
        tx,
        { ...approval, amount: "3000000" },
        Address.toBech32(owner),
        nonce,
        1000n,
        [hash],
      ),
    /payment_mismatch/,
  );
  assert.throws(
    () =>
      validatePaymentTransaction(
        tx,
        { ...approval, maxFeeLovelace: "1" },
        Address.toBech32(owner),
        nonce,
        1000n,
        [hash],
      ),
    /fee_budget/,
  );
  assert.throws(
    () => validatePaymentTransaction(tx, approval, Address.toBech32(owner), nonce, 999n, [hash]),
    /expiry/,
  );
  assert.throws(
    () =>
      validatePaymentTransaction(
        tx,
        approval,
        Address.toBech32(owner),
        "bb".repeat(32) + "#0",
        1000n,
        [hash],
      ),
    /nonce/,
  );
  const tampered = new Transaction.Transaction({
    ...tx,
    body: new TransactionBody.TransactionBody({ ...tx.body, fee: 200001n }),
  });
  assert.throws(
    () =>
      validatePaymentTransaction(tampered, approval, Address.toBech32(owner), nonce, 1000n, [hash]),
    /wallet_signature/,
  );
});
test("mainnet or unapproved provider is rejected before a wallet signature is requested", async () => {
  let signed = false;
  const api: Cip30Api = {
    getNetworkId: async () => 1,
    getUsedAddresses: async () => [],
    getUnusedAddresses: async () => [],
    getRewardAddresses: async () => [],
    getUtxos: async () => [],
    signTx: async () => {
      signed = true;
      throw new Error("must not sign");
    },
  };
  const options = {
    koiosUrl: "https://preprod.koios.rest/api/v1",
    approval,
    journal: { reserve: async () => {}, update: async () => {} },
  };
  await assert.rejects(createCip30Signer(api, options), /network_mismatch/);
  await assert.rejects(
    createCip30Signer(api, { ...options, koiosUrl: "https://preview.koios.rest/api/v1" }),
    /preprod_provider/,
  );
  assert.equal(signed, false);
});
