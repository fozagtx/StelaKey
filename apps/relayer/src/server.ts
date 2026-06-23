import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import cors from "cors";
import express from "express";
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
import { intentHashHex } from "@stelakey/crypto";
import { z } from "zod";

function loadLocalEnv() {
  for (const file of [".env.testnet.local", ".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (!key || rawValue === undefined || process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

loadLocalEnv();

const TESTNET_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

const port = Number.parseInt(process.env.RELAYER_PORT ?? "3002", 10);
const origin = process.env.WEB_ORIGIN ?? process.env.PROVER_ORIGIN ?? "http://localhost:3000";

const config = {
  network: process.env.STELLAR_NETWORK ?? process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? TESTNET_RPC_URL,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? TESTNET_NETWORK_PASSPHRASE,
  sourceSecret:
    process.env.RELAYER_SECRET_KEY ??
    process.env.STELLAR_RELAYER_SECRET_KEY ??
    process.env.STELLAR_DEPLOYER_SECRET_KEY ??
    process.env.STELAKEY_DEPLOYER_SECRET_KEY,
  authLedgerTtl: Number.parseInt(process.env.RELAYER_AUTH_LEDGER_TTL ?? "120", 10)
};

class RelayerError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

const prepareTransferSchema = z.object({
  accountContractId: z.string().min(1),
  btcAddress: z.string().min(8),
  destination: z.string().min(1),
  amount: z.string().min(1),
  assetCode: z.string().min(1).max(12).default("XLM"),
  assetIssuer: z.string().optional(),
  stellarNetwork: z.string().optional()
});

const submitTransferSchema = z.object({
  accountContractId: z.string().min(1),
  preparedTransactionXdr: z.string().min(1),
  authEntryIndex: z.number().int().nonnegative(),
  authEntryXdr: z.string().min(1),
  signaturePayloadHash: z.string().min(1),
  expiryLedger: z.number().int().positive(),
  proofBytes: z.string().min(1),
  publicInputs: z.string().min(1),
  ownerCommitment: z.string().min(1)
});

function missingConfig() {
  const missing: string[] = [];
  if (!config.rpcUrl) missing.push("Stellar RPC URL");
  if (!config.networkPassphrase) missing.push("Stellar network passphrase");
  if (!config.sourceSecret) missing.push("relayer signer");
  if (!Number.isSafeInteger(config.authLedgerTtl) || config.authLedgerTtl <= 0) {
    missing.push("positive relayer auth ledger TTL");
  }
  return missing;
}

function assertReady() {
  const missing = missingConfig();
  if (missing.length > 0) {
    throw new RelayerError(
      503,
      "RELAYER_NOT_CONFIGURED",
      `Relayer is missing ${missing.join(", ")}. No transaction was prepared.`
    );
  }
}

function assertTestnet(stellarNetwork: string | undefined) {
  const requested = stellarNetwork ?? config.network;
  if (requested !== "testnet" || config.network !== "testnet") {
    throw new RelayerError(
      400,
      "UNSUPPORTED_STELLAR_NETWORK",
      "Only Stellar testnet transfer authorization is enabled."
    );
  }
}

function assertContractAddress(value: string, label: string) {
  if (!StrKey.isValidContract(value)) {
    throw new RelayerError(400, "INVALID_STELLAR_CONTRACT", `${label} must be a Stellar contract address.`);
  }
}

function assertStellarAddress(value: string, label: string) {
  const valid =
    StrKey.isValidEd25519PublicKey(value) ||
    StrKey.isValidMed25519PublicKey(value) ||
    StrKey.isValidContract(value);
  if (!valid) {
    throw new RelayerError(400, "INVALID_STELLAR_ADDRESS", `${label} must be a Stellar account or contract address.`);
  }
}

function decimalToStroops(value: string) {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(trimmed);
  if (!match) {
    throw new RelayerError(400, "INVALID_AMOUNT", "Amount must be a positive decimal with at most 7 decimals.");
  }

  const wholeText = match[1];
  if (wholeText === undefined) {
    throw new RelayerError(400, "INVALID_AMOUNT", "Amount must be a positive decimal with at most 7 decimals.");
  }

  const whole = BigInt(wholeText);
  const fraction = BigInt((match[2] ?? "").padEnd(7, "0"));
  const stroops = whole * 10_000_000n + fraction;
  if (stroops <= 0n) {
    throw new RelayerError(400, "INVALID_AMOUNT", "Amount must be greater than zero.");
  }
  return stroops;
}

function assetFromRequest(assetCode: string, assetIssuer: string | undefined) {
  const code = assetCode.trim().toUpperCase();
  if (code === "XLM") return Asset.native();

  if (!assetIssuer) {
    throw new RelayerError(
      400,
      "ASSET_ISSUER_REQUIRED",
      "Non-XLM transfers need an issuer address before a real Stellar asset contract can be prepared."
    );
  }
  if (!StrKey.isValidEd25519PublicKey(assetIssuer)) {
    throw new RelayerError(400, "INVALID_ASSET_ISSUER", "Asset issuer must be a Stellar account address.");
  }
  return new Asset(code, assetIssuer);
}

function hex32(bytes: Buffer | Uint8Array) {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function cleanHex(value: string, label: string) {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new RelayerError(400, "INVALID_HEX", `${label} must be hex.`);
  }
  return clean.toLowerCase();
}

function bytesFromHex(value: string, label: string, length?: number) {
  const clean = cleanHex(value, label);
  if (clean.length % 2 !== 0) {
    throw new RelayerError(400, "INVALID_HEX", `${label} must have an even number of hex characters.`);
  }
  const bytes = Buffer.from(clean, "hex");
  if (length !== undefined && bytes.length !== length) {
    throw new RelayerError(400, "INVALID_HEX_LENGTH", `${label} must be ${length} bytes.`);
  }
  return bytes;
}

function normalizeHash(value: string, label: string) {
  return `0x${bytesFromHex(value, label, 32).toString("hex")}`;
}

function sha256XdrHex(value: { toXDR: () => Buffer }) {
  return hex32(createHash("sha256").update(value.toXDR()).digest());
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
    throw new RelayerError(400, "INVALID_PREPARED_TRANSACTION", "Prepared transfer transaction must contain exactly one operation.");
  }
  const operation = transaction.operations[0];
  if (!operation || operation.type !== "invokeHostFunction") {
    throw new RelayerError(400, "INVALID_PREPARED_TRANSACTION", "Prepared transfer transaction must invoke a Soroban host function.");
  }
  return operation;
}

async function waitForTransaction(server: StellarRpcServer, txHash: string) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await server.getTransaction(txHash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") {
      throw new RelayerError(502, "STELLAR_TRANSFER_FAILED", "Stellar rejected the submitted transfer transaction.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new RelayerError(504, "TRANSFER_CONFIRMATION_TIMEOUT", "Stellar accepted the transfer transaction, but it did not confirm before timeout.");
}

async function sourceAccountFor(server: StellarRpcServer, sourceKeypair: Keypair) {
  return server.getAccount(sourceKeypair.publicKey());
}

async function prepareTransfer(body: unknown) {
  assertReady();
  const request = prepareTransferSchema.parse(body);
  assertTestnet(request.stellarNetwork);
  assertContractAddress(request.accountContractId, "accountContractId");
  assertStellarAddress(request.destination, "destination");

  const asset = assetFromRequest(request.assetCode, request.assetIssuer);
  const amountStroops = decimalToStroops(request.amount);
  const sourceKeypair = Keypair.fromSecret(config.sourceSecret as string);
  const server = new StellarRpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://")
  });
  const sourceAccount = await sourceAccountFor(server, sourceKeypair);

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
    .setTimeout(60)
    .build();

  const rawPreflight = await server._simulateTransaction(transaction, undefined, "record");
  const preflight = parseRawSimulation(rawPreflight);
  if ("error" in preflight) {
    throw new RelayerError(
      502,
      "STELLAR_PREPARE_FAILED",
      "Stellar could not prepare this payment authorization."
    );
  }
  const preparedTransaction = assembleTransaction(transaction, rawPreflight).build();

  const authEntries = preflight.result?.auth ?? [];
  const accountAuth = findAccountAuthEntry(authEntries, request.accountContractId);
  if (!accountAuth) {
    throw new RelayerError(
      502,
      "ACCOUNT_AUTH_NOT_RETURNED",
      "Stellar did not return an authorization entry for the StelaKey account."
    );
  }

  const latestLedger = await server.getLatestLedger();
  const expiryLedger = latestLedger.sequence + config.authLedgerTtl;
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

async function submitTransfer(body: unknown) {
  assertReady();
  const request = submitTransferSchema.parse(body);
  assertContractAddress(request.accountContractId, "accountContractId");

  const sourceKeypair = Keypair.fromSecret(config.sourceSecret as string);
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
    throw new RelayerError(400, "AUTH_ENTRY_NOT_FOUND", "Prepared transaction does not contain the requested auth entry.");
  }

  const expectedEntryXdr = originalEntry.toXDR("base64");
  if (expectedEntryXdr !== request.authEntryXdr) {
    throw new RelayerError(400, "AUTH_ENTRY_MISMATCH", "Prepared transaction auth entry does not match the signed authorization.");
  }

  const credentials = addressCredentialsFor(originalEntry);
  if (!credentials) {
    throw new RelayerError(400, "UNSUPPORTED_AUTH_ENTRY", "Prepared transaction auth entry does not use address credentials.");
  }
  const credentialAddress = Address.fromScAddress(credentials.address()).toString();
  if (credentialAddress !== request.accountContractId) {
    throw new RelayerError(400, "ACCOUNT_AUTH_MISMATCH", "Prepared transaction auth entry is not for the requested StelaKey account.");
  }

  const signaturePayload = buildAuthorizationEntryPreimage(
    originalEntry,
    request.expiryLedger,
    config.networkPassphrase
  );
  const expectedSignaturePayloadHash = hex32(hash(signaturePayload.toXDR()));
  if (expectedSignaturePayloadHash !== normalizeHash(request.signaturePayloadHash, "signaturePayloadHash")) {
    throw new RelayerError(400, "SIGNATURE_PAYLOAD_MISMATCH", "Proof was not produced for this Stellar authorization payload.");
  }

  const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(originalEntry.toXDR());
  const signedCredentials = addressCredentialsFor(signedEntry);
  if (!signedCredentials) {
    throw new RelayerError(400, "UNSUPPORTED_AUTH_ENTRY", "Prepared transaction auth entry does not use address credentials.");
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
  const transactionBuilder = TransactionBuilder.cloneFrom(transaction, {
    networkPassphrase: config.networkPassphrase
  });
  transactionBuilder.clearOperations();
  transactionBuilder.addOperation(
    Operation.invokeHostFunction({
      func: operation.func,
      auth: signedAuthEntries,
      ...(operation.source ? { source: operation.source } : {})
    })
  );

  const signedTransaction = transactionBuilder.build();
  signedTransaction.sign(sourceKeypair);
  const submitted = await server.sendTransaction(signedTransaction);
  if (submitted.status === "ERROR") {
    throw new RelayerError(502, "STELLAR_TRANSFER_REJECTED", "Stellar rejected the transfer transaction before confirmation.");
  }
  if (submitted.status !== "PENDING" && submitted.status !== "DUPLICATE") {
    throw new RelayerError(502, "STELLAR_TRANSFER_NOT_ACCEPTED", `Stellar returned ${submitted.status}. No confirmed transfer is available.`);
  }

  await waitForTransaction(server, submitted.hash);

  return {
    status: "submitted",
    txHash: submitted.hash,
    network: config.network,
    accountContractId: request.accountContractId,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${submitted.hash}`
  };
}

const app = express();
app.use(cors({ origin }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  const missing = missingConfig();
  res.json({
    ok: missing.length === 0,
    service: "stelakey-relayer",
    status: missing.length === 0 ? "prepare-auth-ready" : "missing-config",
    missing,
    network: config.network,
    rpcUrl: config.rpcUrl
  });
});

app.post("/api/transfers/prepare-auth", async (req, res) => {
  try {
    const prepared = await prepareTransfer(req.body);
    res.json(prepared);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        status: "rejected",
        errorCode: "INVALID_TRANSFER_REQUEST",
        message: error.issues[0]?.message ?? "Invalid transfer request."
      });
      return;
    }

    if (error instanceof RelayerError) {
      res.status(error.status).json({
        status: "rejected",
        errorCode: error.errorCode,
        message: error.message
      });
      return;
    }

    console.error("prepare_auth_failed", error);
    res.status(502).json({
      status: "rejected",
      errorCode: "PREPARE_AUTH_FAILED",
      message: error instanceof Error ? error.message : "Transfer authorization failed before signing."
    });
  }
});

app.post("/api/transfers/submit", async (req, res) => {
  try {
    const submitted = await submitTransfer(req.body);
    res.json(submitted);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        status: "rejected",
        errorCode: "INVALID_SUBMIT_REQUEST",
        message: error.issues[0]?.message ?? "Invalid transfer submit request."
      });
      return;
    }

    if (error instanceof RelayerError) {
      res.status(error.status).json({
        status: "rejected",
        errorCode: error.errorCode,
        message: error.message
      });
      return;
    }

    console.error("submit_transfer_failed", error);
    res.status(502).json({
      status: "rejected",
      errorCode: "TRANSFER_SUBMIT_FAILED",
      message: error instanceof Error ? error.message : "Transfer submit failed before Stellar confirmed a transaction."
    });
  }
});

app.listen(port, () => {
  console.log(`[relayer] listening on http://localhost:${port}`);
});
