import {
  Address,
  Assets,
  Client,
  KeyHash,
  preprod,
  Time,
  Transaction,
  TransactionHash,
} from "@evolution-sdk/evolution";
import type { ClientCardanoSigner, ClientCardanoSignInput } from "@x402/cardano";
import type { CardanoApproval, CardanoSigningJournal, Cip30Api } from "./types.ts";
import { transactionBase64, validatePaymentTransaction } from "./transaction.ts";
export type {
  CardanoApproval,
  CardanoSigningJournal,
  CardanoSigningRecord,
  Cip30Api,
} from "./types.ts";
export { signedTransactionId } from "./transaction.ts";

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("cardano_provider_timeout")), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function validateApproval(input: ClientCardanoSignInput, approval: CardanoApproval) {
  if (
    input.network !== approval.network ||
    input.network !== "cardano:preprod" ||
    input.payTo !== approval.payTo ||
    input.amount !== approval.amount ||
    input.asset !== "lovelace"
  )
    throw new Error("cardano_approval_mismatch");
  if (input.extra?.assetTransferMethod !== "default" || input.extra?.areFeesSponsored !== false)
    throw new Error("cardano_unsupported_payment_method");
  if (
    !Number.isSafeInteger(input.maxTimeoutSeconds) ||
    input.maxTimeoutSeconds < 1 ||
    input.maxTimeoutSeconds > 600
  )
    throw new Error("cardano_invalid_timeout");
  if (!/^[1-9]\d*$/.test(approval.amount) || !/^[1-9]\d*$/.test(approval.maxFeeLovelace))
    throw new Error("cardano_invalid_budget");
  const recipient = Address.fromBech32(approval.payTo);
  if (Address.getNetworkId(recipient) !== 0 || recipient.paymentCredential._tag !== "KeyHash")
    throw new Error("cardano_invalid_recipient");
}

/** User approval and a durable journal are mandatory; this signer never broadcasts. */
export async function createCip30Signer(
  api: Cip30Api,
  options: { koiosUrl: string; approval: CardanoApproval; journal: CardanoSigningJournal },
): Promise<ClientCardanoSigner> {
  options = { ...options, approval: Object.freeze({ ...options.approval }) };
  const endpoint = new URL(options.koiosUrl);
  const path = endpoint.pathname.replace(/\/$/, "");
  const direct =
    endpoint.protocol === "https:" &&
    endpoint.hostname === "preprod.koios.rest" &&
    path === "/api/v1";
  const proxy =
    typeof window !== "undefined" &&
    endpoint.origin === window.location.origin &&
    path === "/cardano-provider";
  if (
    !(direct || proxy) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("cardano_preprod_provider_required");
  if ((await api.getNetworkId()) !== 0) throw new Error("cardano_wallet_network_mismatch");
  const wallet = {
    getUsedAddresses: () => api.getUsedAddresses(),
    getUnusedAddresses: () => api.getUnusedAddresses(),
    getRewardAddresses: () => api.getRewardAddresses(),
    getUtxos: async () => (await api.getUtxos()) ?? [],
    signTx: (tx: string, partial: boolean) => api.signTx(tx, partial),
    signData: async () => {
      throw new Error("cardano_data_signing_not_used");
    },
    submitTx: async () => {
      throw new Error("cardano_client_broadcast_forbidden");
    },
  };
  const client = Client.make(preprod)
    .withKoios({ baseUrl: endpoint.href.replace(/\/$/, "") })
    .withCip30(wallet);
  const address = Address.toBech32(await client.address());
  if (address === options.approval.payTo) throw new Error("cardano_self_payment_not_supported");
  const journalKey = JSON.stringify([
    address,
    options.approval.network,
    options.approval.resourceUrl,
    options.approval.payTo,
    options.approval.amount,
  ]);
  return {
    getAddress: () => address,
    async buildAndSignPaymentTransaction(input) {
      validateApproval(input, options.approval);
      if ((await api.getNetworkId()) !== 0 || Address.toBech32(await client.address()) !== address)
        throw new Error("cardano_wallet_changed");
      await options.journal.reserve(journalKey, { status: "signing" });
      try {
        const utxos = await bounded(client.getWalletUtxos());
        if (!utxos.length) throw new Error("cardano_wallet_needs_preprod_funds");
        const nonceUtxo = utxos[0]!;
        const nonce = `${TransactionHash.toHex(nonceUtxo.transactionId)}#${nonceUtxo.index}`;
        const ttlMs = BigInt(Date.now()) + BigInt(input.maxTimeoutSeconds) * 1000n;
        const maxTtl = Time.unixTimeToSlot(ttlMs, preprod.slotConfig);
        const builder = await bounded(
          client
            .newTx()
            .collectFrom({ inputs: [nonceUtxo] })
            .payToAddress({
              address: Address.fromBech32(input.payTo),
              assets: Assets.fromLovelace(BigInt(input.amount)),
            })
            .setValidity({ to: ttlMs })
            .build({ changeAddress: Address.fromBech32(address), autoMinUtxo: false }),
        );
        const unsigned = await builder.toTransaction();
        validatePaymentTransaction(unsigned, options.approval, address, nonce, maxTtl);
        // Network id 0 alone also describes Preview. Require every funding input on live Preprod.
        const live = await bounded(client.getUtxosByOutRef(unsigned.body.inputs));
        const walletByRef = new Map(
          utxos.map((utxo) => [
            `${TransactionHash.toHex(utxo.transactionId)}#${utxo.index}`,
            JSON.stringify(utxo.toJSON()),
          ]),
        );
        if (
          live.length !== unsigned.body.inputs.length ||
          live.some(
            (utxo) =>
              walletByRef.get(`${TransactionHash.toHex(utxo.transactionId)}#${utxo.index}`) !==
              JSON.stringify(utxo.toJSON()),
          )
        )
          throw new Error("cardano_funding_not_on_preprod");
        const hashes = live.map((utxo) => {
          if (utxo.address.paymentCredential._tag !== "KeyHash")
            throw new Error("cardano_script_funding_not_supported");
          return KeyHash.toHex(utxo.address.paymentCredential);
        });
        if ((await api.getNetworkId()) !== 0) throw new Error("cardano_wallet_network_mismatch");
        const result = await builder.sign();
        const signed = new Transaction.Transaction({
          body: unsigned.body,
          witnessSet: result.witnessSet,
          isValid: true,
          auxiliaryData: null,
        });
        validatePaymentTransaction(signed, options.approval, address, nonce, maxTtl, hashes);
        const transaction = transactionBase64(signed);
        await options.journal.update(journalKey, { status: "signed", transaction, nonce });
        return { transaction, nonce };
      } catch (error) {
        await options.journal.update(journalKey, { status: "review_required" });
        throw error;
      }
    },
  };
}
