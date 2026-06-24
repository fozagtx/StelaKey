import { createHash } from "node:crypto";
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Operation,
  StrKey,
  type Transaction,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  hash,
  nativeToScVal,
  xdr
} from "@stellar/stellar-sdk";
import { Server as StellarRpcServer, assembleTransaction, parseRawSimulation } from "@stellar/stellar-sdk/rpc";
import { testnetConfig, testnetExplorerTxUrl } from "@/lib/deployment";

const sourceSecret =
  process.env.RELAYER_SECRET_KEY ??
  process.env.STELLAR_RELAYER_SECRET_KEY ??
  process.env.STELLAR_DEPLOYER_SECRET_KEY ??
  process.env.STELAKEY_DEPLOYER_SECRET_KEY;

const authLedgerTtl = Number.parseInt(process.env.RELAYER_AUTH_LEDGER_TTL ?? "120", 10);
const transferTransactionTimeoutSeconds = Number.parseInt(
  process.env.RELAYER_TRANSFER_TIMEOUT_SECONDS ?? "300",
  10
);

type PrepareTransferRequest = {
  accountContractId: string;
  btcAddress: string;
  destination: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  stellarNetwork?: string;
};

type SubmitTransferRequest = {
  accountContractId: string;
  preparedTransactionXdr: string;
  authEntryIndex: number;
  authEntryXdr: string;
  signaturePayloadHash: string;
  expiryLedger: number;
  proofBytes: string;
  publicInputs: string;
  ownerCommitment: string;
};

export class TransferRelayerError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

function objectBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TransferRelayerError(400, "INVALID_TRANSFER_REQUEST", "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TransferRelayerError(400, "INVALID_TRANSFER_REQUEST", `${key} is required.`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new TransferRelayerError(400, "INVALID_TRANSFER_REQUEST", `${key} must be a string.`);
  }
  return value;
}

function requiredPositiveInteger(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TransferRelayerError(400, "INVALID_TRANSFER_REQUEST", `${key} must be a positive integer.`);
  }
  return value as number;
}

function requiredNonNegativeInteger(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TransferRelayerError(400, "INVALID_TRANSFER_REQUEST", `${key} must be a non-negative integer.`);
  }
  return value as number;
}

function parsePrepareTransfer(body: unknown): PrepareTransferRequest {
  const input = objectBody(body);
  const request: PrepareTransferRequest = {
    accountContractId: requiredString(input, "accountContractId"),
    btcAddress: requiredString(input, "btcAddress"),
    destination: requiredString(input, "destination"),
    amount: requiredString(input, "amount"),
    assetCode: optionalString(input, "assetCode") ?? "XLM"
  };
  const assetIssuer = optionalString(input, "assetIssuer");
  const stellarNetwork = optionalString(input, "stellarNetwork");
  if (assetIssuer !== undefined) request.assetIssuer = assetIssuer;
  if (stellarNetwork !== undefined) request.stellarNetwork = stellarNetwork;
  return request;
}

function parseSubmitTransfer(body: unknown): SubmitTransferRequest {
  const input = objectBody(body);
  return {
    accountContractId: requiredString(input, "accountContractId"),
    preparedTransactionXdr: requiredString(input, "preparedTransactionXdr"),
    authEntryIndex: requiredNonNegativeInteger(input, "authEntryIndex"),
    authEntryXdr: requiredString(input, "authEntryXdr"),
    signaturePayloadHash: requiredString(input, "signaturePayloadHash"),
    expiryLedger: requiredPositiveInteger(input, "expiryLedger"),
    proofBytes: requiredString(input, "proofBytes"),
    publicInputs: requiredString(input, "publicInputs"),
    ownerCommitment: requiredString(input, "ownerCommitment")
  };
}

export function transferRelayerReadiness() {
  const config = testnetConfig();
  const missing: string[] = [];

  if (!config.rpcUrl) missing.push("Stellar RPC URL");
  if (!config.networkPassphrase) missing.push("Stellar network passphrase");
  if (!sourceSecret) missing.push("transfer signer");
  if (!Number.isSafeInteger(authLedgerTtl) || authLedgerTtl <= 0) {
    missing.push("positive transfer authorization ledger TTL");
  }
  if (!Number.isSafeInteger(transferTransactionTimeoutSeconds) || transferTransactionTimeoutSeconds <= 0) {
    missing.push("positive transfer transaction timeout");
  }

  return { config, missing };
}

function assertReady() {
  const { missing } = transferRelayerReadiness();
  if (missing.length > 0) {
    throw new TransferRelayerError(
      503,
      "RELAYER_NOT_CONFIGURED",
      `Transfer service is missing ${missing.join(", ")}. No transaction was prepared.`
    );
  }
}

function assertTestnet(stellarNetwork: string | undefined, configuredNetwork: string) {
  const requested = stellarNetwork ?? configuredNetwork;
  if (requested !== "testnet" || configuredNetwork !== "testnet") {
    throw new TransferRelayerError(
      400,
      "UNSUPPORTED_STELLAR_NETWORK",
      "Only Stellar testnet transfer authorization is enabled."
    );
  }
}

function assertContractAddress(value: string, label: string) {
  if (!StrKey.isValidContract(value)) {
    throw new TransferRelayerError(400, "INVALID_STELLAR_CONTRACT", `${label} must be a Stellar contract address.`);
  }
}

function assertStellarAddress(value: string, label: string) {
  const valid =
    StrKey.isValidEd25519PublicKey(value) ||
    StrKey.isValidMed25519PublicKey(value) ||
    StrKey.isValidContract(value);
  if (!valid) {
    throw new TransferRelayerError(400, "INVALID_STELLAR_ADDRESS", `${label} must be a Stellar account or contract address.`);
  }
}

function decimalToStroops(value: string) {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(trimmed);
  if (!match?.[1]) {
    throw new TransferRelayerError(400, "INVALID_AMOUNT", "Amount must be a positive decimal with at most 7 decimals.");
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(7, "0"));
  const stroops = whole * 10_000_000n + fraction;
  if (stroops <= 0n) {
    throw new TransferRelayerError(400, "INVALID_AMOUNT", "Amount must be greater than zero.");
  }
  return stroops;
}

function assetFromRequest(assetCode: string, assetIssuer: string | undefined) {
  const code = assetCode.trim().toUpperCase();
  if (code === "XLM") return Asset.native();

  if (!assetIssuer) {
    throw new TransferRelayerError(
      400,
      "ASSET_ISSUER_REQUIRED",
      "Non-XLM transfers need an issuer address before a real Stellar asset contract can be prepared."
    );
  }
  if (!StrKey.isValidEd25519PublicKey(assetIssuer)) {
    throw new TransferRelayerError(400, "INVALID_ASSET_ISSUER", "Asset issuer must be a Stellar account address.");
  }
  return new Asset(code, assetIssuer);
}

function hex32(bytes: Buffer | Uint8Array) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function cleanHex(value: string, label: string) {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new TransferRelayerError(400, "INVALID_HEX", `${label} must be hex.`);
  }
  return clean.toLowerCase();
}

function bytesFromHex(value: string, label: string, length?: number) {
  const clean = cleanHex(value, label);
  if (clean.length % 2 !== 0) {
    throw new TransferRelayerError(400, "INVALID_HEX", `${label} must have an even number of hex characters.`);
  }
  const bytes = Buffer.from(clean, "hex");
  if (length !== undefined && bytes.length !== length) {
    throw new TransferRelayerError(400, "INVALID_HEX_LENGTH", `${label} must be ${length} bytes.`);
  }
  return bytes;
}

function normalizeHash(value: string, label: string) {
  return `0x${bytesFromHex(value, label, 32).toString("hex")}`;
}

function sha256XdrHex(value: { toXDR: () => Buffer }) {
  return hex32(createHash("sha256").update(value.toXDR()).digest());
}

function xdrValueToBase64(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const maybeXdr = value as { toXDR?: (encoding?: "base64") => Buffer | string };
  if (typeof maybeXdr.toXDR !== "function") return undefined;

  try {
    const encoded = maybeXdr.toXDR("base64");
    return typeof encoded === "string" ? encoded : encoded.toString("base64");
  } catch {
    return undefined;
  }
}

function xdrSwitchSummary(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const maybeSwitchable = value as { switch?: () => { name?: string; value?: unknown } };
  if (typeof maybeSwitchable.switch !== "function") return undefined;

  try {
    const switchValue = maybeSwitchable.switch();
    return {
      name: switchValue.name,
      value: switchValue.value
    };
  } catch {
    return undefined;
  }
}

function operationResultSummary(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const summary: Record<string, unknown> = {};
  const operationResult = value as {
    code?: () => unknown;
    switch?: () => { name?: string; value?: unknown };
    tr?: () => unknown;
  };

  const code = typeof operationResult.code === "function" ? xdrSwitchSummary(operationResult.code()) : undefined;
  const result = xdrSwitchSummary(operationResult);
  const tr = typeof operationResult.tr === "function" ? xdrSwitchSummary(operationResult.tr()) : undefined;

  if (code) summary.code = code;
  if (result) summary.result = result;
  if (tr) summary.tr = tr;

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function transactionResultSummary(resultXdr: string | undefined) {
  if (!resultXdr) return undefined;

  try {
    const result = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const txResult = result.result();
    const summary: Record<string, unknown> = {
      feeCharged: result.feeCharged().toString(),
      resultCode: txResult.switch().name,
      resultCodeValue: txResult.switch().value
    };
    const results = (txResult as unknown as { results?: () => unknown }).results?.();
    if (Array.isArray(results)) {
      summary.operationResults = results
        .map((item) => operationResultSummary(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
    return summary;
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : "unable to parse Stellar transaction result"
    };
  }
}

function rpcFailureSummary(response: unknown) {
  const summary: Record<string, unknown> = {};
  if (!response || typeof response !== "object") return summary;

  const record = response as Record<string, unknown>;
  for (const key of ["status", "hash", "latestLedger", "latestLedgerCloseTime"]) {
    if (record[key] !== undefined) summary[key] = record[key];
  }

  const resultXdr =
    typeof record.errorResultXdr === "string"
      ? record.errorResultXdr
      : typeof record.resultXdr === "string"
        ? record.resultXdr
        : xdrValueToBase64(record.errorResult) ??
          xdrValueToBase64(record.resultXdr) ??
          xdrValueToBase64(record.result);
  if (resultXdr) {
    summary.resultXdr = resultXdr;
    summary.transactionResult = transactionResultSummary(resultXdr);
  }

  const resultMetaXdr =
    typeof record.resultMetaXdr === "string" ? record.resultMetaXdr : xdrValueToBase64(record.resultMetaXdr);
  if (resultMetaXdr) summary.resultMetaXdr = resultMetaXdr;

  const diagnosticEvents = Array.isArray(record.diagnosticEventsXdr)
    ? record.diagnosticEventsXdr
    : Array.isArray(record.diagnosticEvents)
      ? record.diagnosticEvents
      : [];
  if (diagnosticEvents.length > 0) {
    summary.diagnosticEventsXdr = diagnosticEvents
      .map((event) => (typeof event === "string" ? event : xdrValueToBase64(event)))
      .filter((event): event is string => Boolean(event));
  }

  if (typeof record.error === "string") summary.error = record.error;
  return summary;
}

function sortedJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${sortedJson(item)}`).join(",")}}`;
}

function intentHashHex(intent: {
  domain: "StelaKey";
  version: 1;
  networkPassphrase: string;
  accountContract: string;
  action: "transfer";
  operationHash: string;
  signaturePayloadHash: string;
  nonce: string;
  expiresAt: string;
}) {
  return hex32(createHash("sha256").update(sortedJson(intent), "utf8").digest());
}

function addressCredentialsFor(entry: xdr.SorobanAuthorizationEntry) {
  const credentials = entry.credentials();
  const switchValue = credentials.switch().value;
  if (switchValue === xdr.SorobanCredentialsType.sorobanCredentialsAddress().value) {
    return credentials.address();
  }
  if (switchValue === xdr.SorobanCredentialsType.sorobanCredentialsAddressV2().value) {
    return credentials.addressV2();
  }
  if (switchValue === xdr.SorobanCredentialsType.sorobanCredentialsAddressWithDelegates().value) {
    return credentials.addressWithDelegates().addressCredentials();
  }
  return null;
}

function findAccountAuthEntry(authEntries: xdr.SorobanAuthorizationEntry[], accountContractId: string) {
  for (let index = 0; index < authEntries.length; index += 1) {
    const entry = authEntries[index];
    if (!entry) continue;
    const credentials = addressCredentialsFor(entry);
    if (!credentials) continue;
    const address = Address.fromScAddress(credentials.address()).toString();
    if (address === accountContractId) {
      return { entry, credentials, index };
    }
  }
  return null;
}

function canonicalAssetLabel(asset: Asset) {
  return asset.isNative() ? "XLM" : `${asset.getCode()}:${asset.getIssuer()}`;
}

function authProofSignatureScVal(input: {
  proofBytes: string;
  publicInputs: string;
  signaturePayloadHash: string;
  ownerCommitment: string;
  expiryLedger: number;
}) {
  return nativeToScVal(
    {
      expires_ledger: input.expiryLedger,
      owner_commitment: bytesFromHex(input.ownerCommitment, "ownerCommitment", 32),
      proof_bytes: bytesFromHex(input.proofBytes, "proofBytes"),
      public_inputs: bytesFromHex(input.publicInputs, "publicInputs"),
      signature_payload_hash: bytesFromHex(input.signaturePayloadHash, "signaturePayloadHash", 32)
    },
    {
      type: {
        expires_ledger: ["symbol", "u32"],
        owner_commitment: ["symbol", "bytes"],
        proof_bytes: ["symbol", "bytes"],
        public_inputs: ["symbol", "bytes"],
        signature_payload_hash: ["symbol", "bytes"]
      }
    }
  );
}

function invokeHostFunctionOperation(transaction: Transaction) {
  if (transaction.operations.length !== 1) {
    throw new TransferRelayerError(400, "INVALID_PREPARED_TRANSACTION", "Prepared transfer transaction must contain exactly one operation.");
  }
  const operation = transaction.operations[0];
  if (!operation || operation.type !== "invokeHostFunction") {
    throw new TransferRelayerError(400, "INVALID_PREPARED_TRANSACTION", "Prepared transfer transaction must invoke a Soroban host function.");
  }
  return operation;
}

function sorobanDataFor(transaction: Transaction) {
  const envelope = transaction.toEnvelope();
  if (envelope.switch().value !== xdr.EnvelopeType.envelopeTypeTx().value) return undefined;
  return envelope.v1().tx().ext().value() ?? undefined;
}

async function waitForTransaction(server: StellarRpcServer, txHash: string) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await server.getTransaction(txHash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") {
      console.error("stellar_transfer_confirmation_failed", { txHash, ...rpcFailureSummary(result) });
      throw new TransferRelayerError(502, "STELLAR_TRANSFER_FAILED", "Stellar rejected the submitted transfer transaction.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new TransferRelayerError(504, "TRANSFER_CONFIRMATION_TIMEOUT", "Stellar accepted the transfer transaction, but it did not confirm before timeout.");
}

export async function prepareTransferAuthorization(body: unknown) {
  assertReady();
  const { config } = transferRelayerReadiness();
  const request = parsePrepareTransfer(body);
  assertTestnet(request.stellarNetwork, config.network);
  assertContractAddress(request.accountContractId, "accountContractId");
  assertStellarAddress(request.destination, "destination");

  const asset = assetFromRequest(request.assetCode, request.assetIssuer);
  const amountStroops = decimalToStroops(request.amount);
  const sourceKeypair = Keypair.fromSecret(sourceSecret as string);
  const server = new StellarRpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://")
  });
  const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

  const tokenContractId = asset.contractId(config.networkPassphrase);
  const tokenContract = new Contract(tokenContractId);
  const transferOperation = tokenContract.call(
    "transfer",
    nativeToScVal(request.accountContractId, { type: "address" }),
    nativeToScVal(request.destination, { type: "address" }),
    nativeToScVal(amountStroops.toString(), { type: "i128" })
  );

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(transferOperation)
    .setTimeout(transferTransactionTimeoutSeconds)
    .build();

  const rawPreflight = await server._simulateTransaction(transaction, undefined, "record");
  const preflight = parseRawSimulation(rawPreflight);
  if ("error" in preflight) {
    throw new TransferRelayerError(
      502,
      "STELLAR_PREPARE_FAILED",
      "Stellar could not prepare this payment for signing. Check that the recipient account exists on testnet and the asset is supported."
    );
  }
  const preparedTransaction = assembleTransaction(transaction, rawPreflight).build();

  const authEntries = preflight.result?.auth ?? [];
  const accountAuth = findAccountAuthEntry(authEntries, request.accountContractId);
  if (!accountAuth) {
    throw new TransferRelayerError(
      502,
      "ACCOUNT_AUTH_NOT_RETURNED",
      "Stellar did not return the account authorization entry required for this StelaKey payment."
    );
  }

  const latestLedger = await server.getLatestLedger();
  const expiryLedger = latestLedger.sequence + authLedgerTtl;
  const signaturePayload = buildAuthorizationEntryPreimage(
    accountAuth.entry,
    expiryLedger,
    config.networkPassphrase
  );
  const signaturePayloadHash = hex32(hash(signaturePayload.toXDR()));
  const networkHash = hex32(hash(Buffer.from(config.networkPassphrase, "utf8")));
  const operationHash = sha256XdrHex(transferOperation);
  const stellarIntentHash = intentHashHex({
    domain: "StelaKey",
    version: 1,
    networkPassphrase: config.networkPassphrase,
    accountContract: request.accountContractId,
    action: "transfer",
    operationHash,
    signaturePayloadHash,
    nonce: accountAuth.credentials.nonce().toString(),
    expiresAt: `ledger:${expiryLedger}`
  });

  return {
    status: "prepared",
    network: config.network,
    accountContractId: request.accountContractId,
    btcAddress: request.btcAddress,
    destination: request.destination,
    assetCode: asset.getCode(),
    assetIssuer: asset.getIssuer(),
    asset: canonicalAssetLabel(asset),
    amount: request.amount,
    amountStroops: amountStroops.toString(),
    tokenContractId,
    operationHash,
    stellarIntentHash,
    signaturePayloadHash,
    signaturePayloadXdr: signaturePayload.toXDR("base64"),
    networkHash,
    expiryLedger,
    authEntryIndex: accountAuth.index,
    authEntryXdr: accountAuth.entry.toXDR("base64"),
    unsignedTransactionXdr: transaction.toXDR(),
    preparedTransactionXdr: preparedTransaction.toXDR()
  };
}

export async function submitAuthorizedTransfer(body: unknown) {
  assertReady();
  const { config } = transferRelayerReadiness();
  const request = parseSubmitTransfer(body);
  assertContractAddress(request.accountContractId, "accountContractId");

  const sourceKeypair = Keypair.fromSecret(sourceSecret as string);
  const server = new StellarRpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://")
  });
  const transaction = TransactionBuilder.fromXDR(
    request.preparedTransactionXdr,
    config.networkPassphrase
  ) as Transaction;
  const operation = invokeHostFunctionOperation(transaction);
  const authEntries = operation.auth ?? [];
  const originalEntry = authEntries[request.authEntryIndex];
  if (!originalEntry) {
    throw new TransferRelayerError(400, "AUTH_ENTRY_NOT_FOUND", "Prepared transaction does not contain the requested auth entry.");
  }

  const expectedEntryXdr = originalEntry.toXDR("base64");
  if (expectedEntryXdr !== request.authEntryXdr) {
    throw new TransferRelayerError(400, "AUTH_ENTRY_MISMATCH", "Prepared transaction auth entry does not match the signed authorization.");
  }

  const credentials = addressCredentialsFor(originalEntry);
  if (!credentials) {
    throw new TransferRelayerError(400, "UNSUPPORTED_AUTH_ENTRY", "Prepared transaction auth entry does not use address credentials.");
  }
  const credentialAddress = Address.fromScAddress(credentials.address()).toString();
  if (credentialAddress !== request.accountContractId) {
    throw new TransferRelayerError(400, "ACCOUNT_AUTH_MISMATCH", "Prepared transaction auth entry is not for the requested StelaKey account.");
  }

  const signaturePayload = buildAuthorizationEntryPreimage(
    originalEntry,
    request.expiryLedger,
    config.networkPassphrase
  );
  const expectedSignaturePayloadHash = hex32(hash(signaturePayload.toXDR()));
  if (expectedSignaturePayloadHash !== normalizeHash(request.signaturePayloadHash, "signaturePayloadHash")) {
    throw new TransferRelayerError(400, "SIGNATURE_PAYLOAD_MISMATCH", "Proof was not produced for this Stellar authorization payload.");
  }

  const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(originalEntry.toXDR());
  const signedCredentials = addressCredentialsFor(signedEntry);
  if (!signedCredentials) {
    throw new TransferRelayerError(400, "UNSUPPORTED_AUTH_ENTRY", "Prepared transaction auth entry does not use address credentials.");
  }
  signedCredentials.signatureExpirationLedger(request.expiryLedger);
  signedCredentials.signature(
    authProofSignatureScVal({
      proofBytes: request.proofBytes,
      publicInputs: request.publicInputs,
      signaturePayloadHash: request.signaturePayloadHash,
      ownerCommitment: request.ownerCommitment,
      expiryLedger: request.expiryLedger
    })
  );

  const signedAuthEntries = [...authEntries];
  signedAuthEntries[request.authEntryIndex] = signedEntry;

  if (!sorobanDataFor(transaction)) {
    throw new TransferRelayerError(
      400,
      "PREPARED_TRANSACTION_MISSING_SOROBAN_DATA",
      "Prepared transfer transaction is missing Soroban preflight data."
    );
  }

  const freshSourceAccount = await server.getAccount(sourceKeypair.publicKey());
  const signedAuthDraft = new TransactionBuilder(freshSourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: operation.func,
        auth: signedAuthEntries,
        ...(operation.source ? { source: operation.source } : {})
      })
    )
    .setTimeout(transferTransactionTimeoutSeconds)
    .build();

  const signedAuthPreflight = await server._simulateTransaction(signedAuthDraft);
  const signedAuthSimulation = parseRawSimulation(signedAuthPreflight);
  if ("error" in signedAuthSimulation) {
    console.error("stellar_transfer_signed_auth_preflight_failed", {
      error: signedAuthSimulation.error,
      latestLedger: signedAuthSimulation.latestLedger,
      events: signedAuthSimulation.events?.map((event) => xdrValueToBase64(event)).filter(Boolean)
    });
    throw new TransferRelayerError(
      502,
      "STELLAR_TRANSFER_PREFLIGHT_FAILED",
      "Stellar rejected the proof-bearing payment preflight. No transaction was submitted."
    );
  }

  const assembledSignedTransaction = assembleTransaction(signedAuthDraft, signedAuthPreflight).build();
  const assembledSorobanData = sorobanDataFor(assembledSignedTransaction);
  if (!assembledSorobanData) {
    throw new TransferRelayerError(
      502,
      "STELLAR_TRANSFER_ASSEMBLY_FAILED",
      "Stellar did not return Soroban resource data for the proof-bearing payment."
    );
  }

  const signedTransaction = assembledSignedTransaction;
  signedTransaction.sign(sourceKeypair);
  const submitted = await server.sendTransaction(signedTransaction);
  if (submitted.status === "ERROR") {
    console.error("stellar_transfer_send_rejected", rpcFailureSummary(submitted));
    throw new TransferRelayerError(502, "STELLAR_TRANSFER_REJECTED", "Stellar rejected the transfer transaction before confirmation.");
  }
  if (submitted.status !== "PENDING" && submitted.status !== "DUPLICATE") {
    throw new TransferRelayerError(502, "STELLAR_TRANSFER_NOT_ACCEPTED", `Stellar returned ${submitted.status}. No confirmed transfer is available.`);
  }

  await waitForTransaction(server, submitted.hash);

  return {
    status: "submitted",
    txHash: submitted.hash,
    network: config.network,
    accountContractId: request.accountContractId,
    explorerUrl: testnetExplorerTxUrl(submitted.hash)
  };
}
