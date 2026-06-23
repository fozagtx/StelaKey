import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BASE_FEE,
  Contract,
  type Account,
  type Transaction,
  Keypair,
  TransactionBuilder,
  scValToNative,
  xdr
} from "@stellar/stellar-sdk";
import { Server as StellarRpcServer } from "@stellar/stellar-sdk/rpc";
import { getContractXlmBalance } from "@/lib/account-funding";
import { testnetConfig, testnetExplorerTxUrl } from "@/lib/deployment";
import { ownerCommitmentHex } from "@/lib/owner";

export const runtime = "nodejs";

type DeployAccountRequest = {
  btcAddress?: unknown;
  btcPubKey?: unknown;
  provider?: unknown;
  bitcoinNetwork?: unknown;
};

type StellarFailure = {
  status: string;
  transactionCode?: string;
  operationCode?: string;
  invokeHostFunctionCode?: string;
};

type DeploymentConfig = ReturnType<typeof testnetConfig>;

class AccountDeploymentError extends Error {
  constructor(
    message: string,
    readonly publicCode: string,
    readonly failure?: StellarFailure
  ) {
    super(message);
  }
}

const sourceSecret =
  process.env.STELLAR_DEPLOYER_SECRET_KEY ?? process.env.STELAKEY_DEPLOYER_SECRET_KEY;

function cleanHex(value: string, label: string) {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`${label} must be hex`);
  }
  return clean.toLowerCase();
}

function bytesN32(hex: string, label: string) {
  const clean = cleanHex(hex, label);
  if (clean.length !== 64) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(clean, "hex"));
}

function sha256TextHex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function accountTagHex(ownerCommitment: string, networkHash: string) {
  return createHash("sha256")
    .update("StelaKey account v1\n", "utf8")
    .update(ownerCommitment, "utf8")
    .update("\n", "utf8")
    .update(networkHash, "utf8")
    .digest("hex");
}

async function sourceAccountFor(server: StellarRpcServer, keypair: Keypair) {
  return server.getAccount(keypair.publicKey());
}

function readiness() {
  const config = testnetConfig();
  const missing: string[] = [];

  if (!sourceSecret) missing.push("server signer");
  if (!config.rpcUrl) missing.push("Stellar RPC URL");
  if (!config.networkPassphrase) missing.push("Stellar network passphrase");
  if (!config.deployerContractId) missing.push("account deployer contract");
  if (!config.verifierContractId) missing.push("verifier contract");
  if (!config.accountWasmHash) missing.push("account WASM hash");
  if (!config.verificationKeyHash) missing.push("verification key hash");

  return { config, missing };
}

function parseRequest(body: DeployAccountRequest) {
  if (typeof body.btcAddress !== "string" || body.btcAddress.length < 8) {
    throw new Error("Bitcoin address is required.");
  }
  if (typeof body.btcPubKey !== "string" || body.btcPubKey.length < 66) {
    throw new Error("Bitcoin public key is required.");
  }
  if (typeof body.provider !== "string" || body.provider.length < 1) {
    throw new Error("Wallet provider is required.");
  }
  if (typeof body.bitcoinNetwork !== "string" || body.bitcoinNetwork.length < 1) {
    throw new Error("Bitcoin network is required.");
  }

  return {
    btcAddress: body.btcAddress,
    btcPubKey: body.btcPubKey,
    provider: body.provider,
    bitcoinNetwork: body.bitcoinNetwork
  };
}

async function waitForTransaction(server: StellarRpcServer, txHash: string) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await server.getTransaction(txHash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") {
      throw new AccountDeploymentError(
        publicFailureMessage(stellarFailureFromResult("FAILED", result.resultXdr)),
        "STELLAR_REJECTED_ACCOUNT_DEPLOYMENT",
        stellarFailureFromResult("FAILED", result.resultXdr)
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Stellar transaction was submitted but did not confirm before timeout.");
}

async function sendPreparedTransaction(server: StellarRpcServer, transaction: Transaction) {
  let lastStatus = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const submitted = await server.sendTransaction(transaction);
    lastStatus = submitted.status;

    if (submitted.status === "PENDING" || submitted.status === "DUPLICATE") {
      return submitted;
    }

    if (submitted.status === "ERROR") {
      const failure = stellarFailureFromResult(submitted.status, submitted.errorResult);
      console.error("account_setup_stellar_rejected", failure);
      throw new AccountDeploymentError(
        publicFailureMessage(failure),
        "STELLAR_REJECTED_ACCOUNT_DEPLOYMENT",
        failure
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Stellar did not accept the account deployment transaction (${lastStatus}).`);
}

function switchName(value: { name?: string; value?: number } | null | undefined) {
  if (!value) return undefined;
  return value.name ?? (typeof value.value === "number" ? String(value.value) : undefined);
}

function stellarFailureFromResult(status: string, result?: xdr.TransactionResult): StellarFailure {
  const failure: StellarFailure = { status };
  if (!result) return failure;

  try {
    const resultBody = result.result();
    const transactionCode = switchName(resultBody.switch());
    if (transactionCode) failure.transactionCode = transactionCode;

    const operations = resultBody.results();
    const operation = operations[0];
    if (!operation) return failure;

    const operationCode = switchName(operation.switch());
    if (operationCode) failure.operationCode = operationCode;
    if (failure.operationCode !== "opInner") return failure;

    const invokeResult = operation.tr().invokeHostFunctionResult();
    const invokeHostFunctionCode = switchName(invokeResult.switch());
    if (invokeHostFunctionCode) failure.invokeHostFunctionCode = invokeHostFunctionCode;
  } catch {
    return failure;
  }

  return failure;
}

function publicFailureMessage(failure: StellarFailure) {
  if (failure.transactionCode === "txBadSeq") {
    return "Account setup hit a Stellar sequence collision. The service retried with a fresh sequence, but Stellar still did not confirm an account.";
  }
  if (failure.transactionCode === "txInsufficientBalance") {
    return "Account setup service needs more Stellar testnet XLM before it can create accounts.";
  }
  if (failure.transactionCode === "txInsufficientFee") {
    return "Stellar required a higher setup fee. Try again in a few seconds.";
  }
  if (failure.transactionCode === "txTooLate") {
    return "The setup transaction expired before Stellar accepted it. Try again.";
  }
  if (failure.transactionCode === "txBadAuth") {
    return "The setup service signer was rejected by Stellar. No account was created.";
  }
  if (failure.operationCode === "opExceededWorkLimit") {
    return "Stellar rejected setup because the transaction exceeded the work limit. No account was created.";
  }
  if (failure.invokeHostFunctionCode === "invokeHostFunctionResourceLimitExceeded") {
    return "Stellar rejected setup because the contract call exceeded the resource limit. No account was created.";
  }
  if (failure.invokeHostFunctionCode === "invokeHostFunctionInsufficientRefundableFee") {
    return "Stellar rejected setup because the refundable fee was too low. Try again.";
  }
  if (failure.invokeHostFunctionCode === "invokeHostFunctionEntryArchived") {
    return "Stellar rejected setup because a required contract entry is archived. No account was created.";
  }
  if (
    failure.invokeHostFunctionCode === "invokeHostFunctionTrapped" ||
    failure.invokeHostFunctionCode === "invokeHostFunctionMalformed"
  ) {
    return "The account deployer rejected the setup call. No account was created.";
  }

  return "Stellar rejected the setup transaction. No account was created.";
}

function isRetryableSequenceFailure(error: unknown) {
  if (!(error instanceof AccountDeploymentError)) return false;
  return error.failure?.transactionCode === "txBadSeq" || error.failure?.transactionCode === "txTooLate";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    throw new Error(preflight.error);
  }

  return preflight.result?.retval ? scValToNative(preflight.result.retval) : null;
}

async function accountStatusForOwner(
  server: StellarRpcServer,
  sourceAccount: Account,
  networkPassphrase: string,
  deployerContractId: string,
  ownerCommitment: string
) {
  const accountContractId = await readContractReturn(
    server,
    sourceAccount,
    networkPassphrase,
    deployerContractId,
    "account_address",
    [bytesN32(ownerCommitment, "ownerCommitment")]
  );

  if (typeof accountContractId !== "string" || !accountContractId.startsWith("C")) {
    throw new Error("Stellar did not return a valid account contract address.");
  }

  try {
    await readContractReturn(
      server,
      sourceAccount,
      networkPassphrase,
      accountContractId,
      "config"
    );
    return { accountContractId, deployed: true };
  } catch {
    return { accountContractId, deployed: false };
  }
}

async function xlmBalanceFields(accountContractId: string) {
  try {
    return await getContractXlmBalance(accountContractId);
  } catch (error) {
    return {
      xlmBalanceError: error instanceof Error ? error.message : "XLM balance lookup failed."
    };
  }
}

async function deployAccountOnce({
  server,
  sourceKeypair,
  config,
  ownerCommitment,
  networkHash,
  accountTag
}: {
  server: StellarRpcServer;
  sourceKeypair: Keypair;
  config: DeploymentConfig;
  ownerCommitment: string;
  networkHash: string;
  accountTag: string;
}) {
  const sourceAccount = await sourceAccountFor(server, sourceKeypair);
  const deployer = new Contract(config.deployerContractId);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase
  })
    .addOperation(
      deployer.call(
        "deploy_account",
        bytesN32(config.accountWasmHash, "accountWasmHash"),
        bytesN32(ownerCommitment, "ownerCommitment"),
        new Contract(config.verifierContractId).address().toScVal(),
        bytesN32(config.verificationKeyHash, "verificationKeyHash"),
        bytesN32(networkHash, "networkHash"),
        bytesN32(accountTag, "accountTag")
      )
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(sourceKeypair);

  const submitted = await sendPreparedTransaction(server, prepared);
  const confirmed = await waitForTransaction(server, submitted.hash);
  const accountContractId = confirmed.returnValue ? scValToNative(confirmed.returnValue) : null;

  if (typeof accountContractId !== "string" || !accountContractId.startsWith("C")) {
    throw new Error("Stellar confirmed the transaction without returning an account contract ID.");
  }

  return {
    accountContractId,
    txHash: submitted.hash,
    explorerUrl: testnetExplorerTxUrl(submitted.hash)
  };
}

async function deployAccountWithFreshSequenceRetry({
  server,
  sourceKeypair,
  config,
  ownerCommitment,
  networkHash,
  accountTag
}: {
  server: StellarRpcServer;
  sourceKeypair: Keypair;
  config: DeploymentConfig;
  ownerCommitment: string;
  networkHash: string;
  accountTag: string;
}) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const deployed = await deployAccountOnce({
        server,
        sourceKeypair,
        config,
        ownerCommitment,
        networkHash,
        accountTag
      });

      return {
        ...deployed,
        attempts: attempt + 1
      };
    } catch (error) {
      lastError = error;

      const sourceAccount = await sourceAccountFor(server, sourceKeypair);
      const account = await accountStatusForOwner(
        server,
        sourceAccount,
        config.networkPassphrase,
        config.deployerContractId,
        ownerCommitment
      );

      if (account.deployed) {
        return {
          accountContractId: account.accountContractId,
          existing: true,
          recoveredAfterRejection: true,
          attempts: attempt + 1
        };
      }

      if (!isRetryableSequenceFailure(error) || attempt === 2) {
        throw error;
      }

      await sleep(900 + attempt * 700);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Account setup failed.");
}

export async function GET(request: Request) {
  const { config, missing } = readiness();
  const response: Record<string, unknown> = {
    ok: true,
    ready: missing.length === 0,
    missing,
    network: config.network,
    deployerContractId: config.deployerContractId,
    verifierContractId: config.verifierContractId,
    accountWasmHash: config.accountWasmHash,
    verificationKeyHash: config.verificationKeyHash
  };

  const btcPubKey = new URL(request.url).searchParams.get("btcPubKey");
  if (btcPubKey && missing.length === 0 && sourceSecret) {
    try {
      const ownerCommitment = ownerCommitmentHex(btcPubKey);
      const sourceKeypair = Keypair.fromSecret(sourceSecret);
      const server = new StellarRpcServer(config.rpcUrl, {
        allowHttp: config.rpcUrl.startsWith("http://")
      });
      const sourceAccount = await sourceAccountFor(server, sourceKeypair);
      const account = await accountStatusForOwner(
        server,
        sourceAccount,
        config.networkPassphrase,
        config.deployerContractId,
        ownerCommitment
      );
      response.ownerCommitment = ownerCommitment;
      response.accountContractId = account.accountContractId;
      response.accountDeployed = account.deployed;
      if (account.deployed) {
        Object.assign(response, await xlmBalanceFields(account.accountContractId));
      }
    } catch (error) {
      response.accountLookupError =
        error instanceof Error ? error.message : "Account lookup failed.";
    }
  }

  return NextResponse.json(response);
}

export async function POST(request: Request) {
  const { config, missing } = readiness();
  if (missing.length > 0 || !sourceSecret || !config.verificationKeyHash) {
    return NextResponse.json(
      {
        ok: false,
        error: "ACCOUNT_SETUP_UNAVAILABLE",
        message: "Account setup service is not configured.",
        missing
      },
      { status: 503 }
    );
  }

  let wallet: ReturnType<typeof parseRequest>;
  try {
    wallet = parseRequest((await request.json()) as DeployAccountRequest);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_WALLET_REQUEST",
        message: error instanceof Error ? error.message : "Invalid wallet request."
      },
      { status: 400 }
    );
  }

  let ownerCommitment: string;
  try {
    ownerCommitment = ownerCommitmentHex(wallet.btcPubKey);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_BITCOIN_PUBLIC_KEY",
        message: error instanceof Error ? error.message : "Invalid Bitcoin public key."
      },
      { status: 400 }
    );
  }

  try {
    const networkHash = sha256TextHex(config.networkPassphrase);
    const accountTag = accountTagHex(ownerCommitment, networkHash);
    const sourceKeypair = Keypair.fromSecret(sourceSecret);
    const server = new StellarRpcServer(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://")
    });
    const sourceAccount = await sourceAccountFor(server, sourceKeypair);
    const existingAccount = await accountStatusForOwner(
      server,
      sourceAccount,
      config.networkPassphrase,
      config.deployerContractId,
      ownerCommitment
    );

    if (existingAccount.deployed) {
      const balance = await xlmBalanceFields(existingAccount.accountContractId);
      return NextResponse.json({
        ok: true,
        existing: true,
        accountContractId: existingAccount.accountContractId,
        ownerCommitment,
        network: config.network,
        ...balance,
        wallet: {
          btcAddress: wallet.btcAddress,
          provider: wallet.provider,
          bitcoinNetwork: wallet.bitcoinNetwork
        }
      });
    }

    const deployment = await deployAccountWithFreshSequenceRetry({
      server,
      sourceKeypair,
      config,
      ownerCommitment,
      networkHash,
      accountTag
    });

    const balance = await xlmBalanceFields(deployment.accountContractId);
    return NextResponse.json({
      ok: true,
      ...deployment,
      ownerCommitment,
      network: config.network,
      ...balance,
      wallet: {
        btcAddress: wallet.btcAddress,
        provider: wallet.provider,
        bitcoinNetwork: wallet.bitcoinNetwork
      }
    });
  } catch (error) {
    try {
      const sourceKeypair = Keypair.fromSecret(sourceSecret);
      const server = new StellarRpcServer(config.rpcUrl, {
        allowHttp: config.rpcUrl.startsWith("http://")
      });
      const sourceAccount = await sourceAccountFor(server, sourceKeypair);
      const recoveredAccount = await accountStatusForOwner(
        server,
        sourceAccount,
        config.networkPassphrase,
        config.deployerContractId,
        ownerCommitment
      );

      if (recoveredAccount.deployed) {
        const balance = await xlmBalanceFields(recoveredAccount.accountContractId);
        return NextResponse.json({
          ok: true,
          existing: true,
          recoveredAfterRejection: true,
          accountContractId: recoveredAccount.accountContractId,
          ownerCommitment,
          network: config.network,
          ...balance,
          wallet: {
            btcAddress: wallet.btcAddress,
            provider: wallet.provider,
            bitcoinNetwork: wallet.bitcoinNetwork
          }
        });
      }
    } catch {
      // Keep the original deployment failure below.
    }

    const deploymentError = error instanceof AccountDeploymentError ? error : null;
    if (deploymentError) {
      console.error("account_setup_failed", {
        publicCode: deploymentError.publicCode,
        failure: deploymentError.failure
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: deploymentError?.publicCode ?? "ACCOUNT_DEPLOYMENT_FAILED",
        message:
          error instanceof Error ? error.message : "Account setup failed before Stellar confirmed a contract.",
        reason: deploymentError?.failure,
        nothingCreated: true
      },
      { status: 502 }
    );
  }
}
