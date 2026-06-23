export type StellarNetwork = "testnet" | "mainnet";

export type WalletProvider = "xverse" | "leather" | "unisat" | "generic";

export type ChallengePurpose = "deploy" | "transfer";

export type SignatureScheme = "ecdsa-message" | "bip322" | "schnorr";

export type ProofStatus = "queued" | "generating" | "ready" | "rejected";

export type TransactionStatus = "submitted" | "confirmed" | "rejected";

export type StelaKeyErrorCode =
  | "BTC_WALLET_MISMATCH"
  | "PROOF_REPLAYED"
  | "PROOF_EXPIRED"
  | "INVALID_SIGNATURE"
  | "OPERATION_HASH_MISMATCH"
  | "AUTH_PAYLOAD_REQUIRED"
  | "INVALID_CHALLENGE_REQUEST"
  | "INVALID_PROOF_REQUEST"
  | "PROVER_NOT_CONFIGURED"
  | "PROOF_GENERATION_FAILED"
  | "SMART_ACCOUNT_OWNER_MISMATCH"
  | "STELLAR_TX_FAILED"
  | "RELAYER_NOT_CONFIGURED"
  | "STELLAR_PREPARE_FAILED"
  | "ACCOUNT_AUTH_NOT_RETURNED"
  | "SIGNATURE_PAYLOAD_MISMATCH"
  | "TRANSFER_SUBMIT_FAILED";

export type ChallengeRequest = {
  btcAddress: string;
  btcPubKey?: string;
  walletProvider: WalletProvider;
  purpose: ChallengePurpose;
  stellarNetwork: StellarNetwork;
  operationHash?: string;
  stellarIntentHash?: string;
  signaturePayloadHash?: string;
  networkHash?: string;
  expiryLedger?: number;
};

export type ChallengeResponse = {
  challengeId: string;
  message: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  domain: "StelaKey";
  replayKey: string;
  messageHash: string;
  stellarIntentHash: string;
  signaturePayloadHash: string;
  networkHash: string;
  expiryLedger: number;
};

export type CreateProofRequest = {
  challengeId: string;
  btcAddress: string;
  btcPubKey: string;
  signature: string;
  signatureScheme: SignatureScheme;
};

export type CreateProofResponse = {
  proofId?: string;
  status: ProofStatus;
  ownerCommitment?: string;
  nullifier?: string;
  proofBytes?: string;
  publicInputs?: string;
  expiresAt?: string;
  errorCode?: StelaKeyErrorCode;
};

export type AccountPreviewRequest = {
  ownerCommitment: string;
  stellarNetwork: StellarNetwork;
};

export type AccountPreviewResponse = {
  predictedContractId: string;
  alreadyDeployed: boolean;
};

export type DeployRequest = {
  proofId: string;
  ownerCommitment: string;
};

export type DeployResponse = {
  accountContractId: string;
  transactionHash: string;
  status: TransactionStatus;
  explorerUrl?: string;
};

export type TransferRequest = {
  accountContractId: string;
  proofId: string;
  destination: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
};

export type TransferResponse = {
  transactionHash?: string;
  status: TransactionStatus;
  explorerUrl?: string;
  errorCode?: StelaKeyErrorCode;
};
