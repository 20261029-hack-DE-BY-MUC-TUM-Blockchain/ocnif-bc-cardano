export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getUsedAddresses(): Promise<readonly string[]>;
  getUnusedAddresses(): Promise<readonly string[]>;
  getRewardAddresses(): Promise<readonly string[]>;
  getUtxos(): Promise<readonly string[] | null>;
  signTx(transactionHex: string, partialSign: boolean): Promise<string>;
}

export interface CardanoApproval {
  network: "cardano:preprod";
  payTo: string;
  amount: string;
  maxFeeLovelace: string;
  resourceUrl: string;
}

export interface CardanoSigningRecord {
  status: "signing" | "signed" | "review_required";
  transaction?: string;
  nonce?: string;
}

export interface CardanoSigningJournal {
  reserve(key: string, record: CardanoSigningRecord): Promise<void>;
  update(key: string, record: CardanoSigningRecord): Promise<void>;
}
