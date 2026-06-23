import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  type Account,
  type Transaction
} from "@stellar/stellar-sdk";
import { Server as StellarRpcServer } from "@stellar/stellar-sdk/rpc";
import { testnetConfig, testnetExplorerTxUrl } from "@/lib/deployment";
import { ownerCommitmentHex } from "@/lib/owner";

const sourceSecret =
  process.env.RELAYER_SECRET_KEY ??
  process.env.STELLAR_RELAYER_SECRET_KEY ??
  process.env.STELLAR_DEPLOYER_SECRET_KEY ??
  process.env.STELAKEY_DEPLOYER_SECRET_KEY;

const defaultFundAmount = process.env.STELAKEY_TESTNET_FUND_AMOUNT ?? "10";
const maxFundStroops = 100n * 10_000_000n;

export class AccountFundingError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

type FundRequest = {
  accountContractId: string;
  btcPubKey: string;
  amount?: string;
};

export function accountFundingReadiness() {
  const config = testnetConfig();
  const missing: string[] = [];

  if (!config.rpcUrl) missing.push("Stellar RPC URL");
  if (!config.networkPassphrase) missing.push("Stellar network passphrase");
  if (!config.deployerContractId) missing.push("account deployer contract");
  if (!sourceSecret) missing.push("testnet funding signer");

  return { config, missing };
}

function assertReady() {
  const { missing } = accountFundingReadiness();
  if (missing.length > 0) {
    throw new AccountFundingError(
      503,
      "ACCOUNT_FUNDING_NOT_CONFIGURED",
      `Account funding is missing ${missing.join(", ")}.`
    );
  }
}

function objectBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AccountFundingError(400, "INVALID_FUNDING_REQUEST", "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AccountFundingError(400, "INVALID_FUNDING_REQUEST", `${key} is required.`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new AccountFundingError(400, "INVALID_FUNDING_REQUEST", `${key} must be a string.`);
  }
  return value;
}

function parseFundRequest(body: unknown): FundRequest {
  const input = objectBody(body);
  const amount = optionalString(input, "amount");
  return {
    accountContractId: requiredString(input, "accountContractId"),
    btcPubKey: requiredString(input, "btcPubKey"),
    ...(amount !== undefined ? { amount } : {})
  };
}

function assertContractAddress(value: string, label: string) {
  if (!StrKey.isValidContract(value)) {
    throw new AccountFundingError(400, "INVALID_STELLAR_CONTRACT", `${label} must be a Stellar contract address.`);
  }
}

function decimalToStroops(value: string) {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(trimmed);
  if (!match?.[1]) {
    throw new AccountFundingError(400, "INVALID_AMOUNT", "Amount must be a positive decimal with at most 7 decimals.");
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(7, "0"));
  const stroops = whole * 10_000_000n + fraction;
  if (stroops <= 0n) {
    throw new AccountFundingError(400, "INVALID_AMOUNT", "Amount must be greater than zero.");
  }
  if (stroops > maxFundStroops) {
    throw new AccountFundingError(400, "AMOUNT_TOO_LARGE", "Testnet funding is capped at 100 XLM per request.");
  }
  return stroops;
}

export function formatStroops(stroops: string | bigint) {
  const value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, "0");
  return `${sign}${whole}.${fraction}`;
}

function bytesN32(hex: string, label: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new AccountFundingError(400, "INVALID_HEX", `${label} must be 32 bytes of hex.`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(clean, "hex"));
}

function nativeStroops(value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  throw new AccountFundingError(502, "BALANCE_RESPONSE_INVALID", "Stellar returned an unreadable XLM balance.");
}

async function sourceAccountFor(server: StellarRpcServer, keypair: Keypair) {
  return server.getAccount(keypair.publicKey());
}

async function waitForTransaction(server: StellarRpcServer, transaction: Transaction) {
  const submitted = await server.sendTransaction(transaction);
  if (submitted.status === "ERROR") {
    throw new AccountFundingError(502, "FUNDING_REJECTED", "Stellar rejected the funding transaction before confirmation.");
  }
  if (submitted.status !== "PENDING" && submitted.status !== "DUPLICATE") {
    throw new AccountFundingError(502, "FUNDING_NOT_ACCEPTED", `Stellar returned ${submitted.status}. No funding transaction was confirmed.`);
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await server.getTransaction(submitted.hash);
    if (result.status === "SUCCESS") {
      return {
        txHash: submitted.hash,
        explorerUrl: testnetExplorerTxUrl(submitted.hash)
      };
    }
    if (result.status === "FAILED") {
      throw new AccountFundingError(502, "FUNDING_FAILED", "Stellar rejected the confirmed funding transaction.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new AccountFundingError(504, "FUNDING_TIMEOUT", "Stellar accepted funding, but it did not confirm before timeout.");
}

async function readContractReturn(
  server: StellarRpcServer,
  sourceAccount: Account,
  networkPassphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
) {
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const preflight = await server.simulateTransaction(transaction);
  if ("error" in preflight) {
    throw new AccountFundingError(502, "STELLAR_READ_FAILED", `Stellar could not read account data: ${preflight.error}`);
  }

  return preflight.result?.retval ? scValToNative(preflight.result.retval) : null;
}

async function assertOwnerMatchesAccount(input: {
  accountContractId: string;
  btcPubKey: string;
  config: ReturnType<typeof testnetConfig>;
  server: StellarRpcServer;
  sourceAccount: Account;
}) {
  const ownerCommitment = ownerCommitmentHex(input.btcPubKey);
  const expectedAccount = await readContractReturn(
    input.server,
    input.sourceAccount,
    input.config.networkPassphrase,
    input.config.deployerContractId,
    "account_address",
    [bytesN32(ownerCommitment, "ownerCommitment")]
  );

  if (expectedAccount !== input.accountContractId) {
    throw new AccountFundingError(
      403,
      "ACCOUNT_OWNER_MISMATCH",
      "This contract is not the StelaKey account for the connected Bitcoin wallet."
    );
  }
}

async function assertAccountDeployed(input: {
  accountContractId: string;
  config: ReturnType<typeof testnetConfig>;
  server: StellarRpcServer;
  sourceAccount: Account;
}) {
  try {
    await readContractReturn(
      input.server,
      input.sourceAccount,
      input.config.networkPassphrase,
      input.accountContractId,
      "config"
    );
  } catch {
    throw new AccountFundingError(400, "ACCOUNT_NOT_DEPLOYED", "Create the StelaKey account before funding it.");
  }
}

export async function getContractXlmBalance(accountContractId: string) {
  assertReady();
  assertContractAddress(accountContractId, "accountContractId");

  const { config } = accountFundingReadiness();
  const sourceKeypair = Keypair.fromSecret(sourceSecret as string);
  const server = new StellarRpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://")
  });
  const sourceAccount = await sourceAccountFor(server, sourceKeypair);
  const tokenContractId = Asset.native().contractId(config.networkPassphrase);
  const rawBalance = await readContractReturn(
    server,
    sourceAccount,
    config.networkPassphrase,
    tokenContractId,
    "balance",
    [nativeToScVal(accountContractId, { type: "address" })]
  );
  const stroops = nativeStroops(rawBalance ?? 0n);

  return {
    xlmBalance: formatStroops(stroops),
    xlmBalanceStroops: stroops
  };
}

export async function fundStelaKeyAccount(body: unknown) {
  assertReady();
  const request = parseFundRequest(body);
  assertContractAddress(request.accountContractId, "accountContractId");
  const amountStroops = decimalToStroops(request.amount ?? defaultFundAmount);

  const { config } = accountFundingReadiness();
  const sourceKeypair = Keypair.fromSecret(sourceSecret as string);
  const server = new StellarRpcServer(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://")
  });
  const sourceAccount = await sourceAccountFor(server, sourceKeypair);

  await assertOwnerMatchesAccount({
    accountContractId: request.accountContractId,
    btcPubKey: request.btcPubKey,
    config,
    server,
    sourceAccount
  });
  await assertAccountDeployed({
    accountContractId: request.accountContractId,
    config,
    server,
    sourceAccount
  });

  const tokenContract = new Contract(Asset.native().contractId(config.networkPassphrase));
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      tokenContract.call(
        "transfer",
        nativeToScVal(sourceKeypair.publicKey(), { type: "address" }),
        nativeToScVal(request.accountContractId, { type: "address" }),
        nativeToScVal(amountStroops.toString(), { type: "i128" })
      )
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(sourceKeypair);
  const confirmed = await waitForTransaction(server, prepared);
  const balance = await getContractXlmBalance(request.accountContractId);

  return {
    ok: true,
    status: "funded",
    accountContractId: request.accountContractId,
    amount: formatStroops(amountStroops),
    amountStroops: amountStroops.toString(),
    ...balance,
    ...confirmed
  };
}
