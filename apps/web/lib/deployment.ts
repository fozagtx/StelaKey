const TESTNET_DEPLOYMENT = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  verifierContractId: "CCFJSBSDOOT65K56MNBLZLAPZ47ZJ64F3TKP4VNOTFXSCEMQ7P3A54LS",
  deployerContractId: "CDG2AJMIVLEVBV2HE7KLK3LHOO6FVGHLEUW63ID2YK6O5755BHF62HZA",
  accountWasmHash: "a15735d74aa1c892063d75014bdc848ec9f7987813064b4b09c37cb6bc69646e",
  verificationKeyHash: "6dfbb9837b001ef99c7b32afdfb9e488f6c15c24f7eea9e76291ee1916b1966b"
} as const;

export function testnetConfig() {
  return {
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? TESTNET_DEPLOYMENT.network,
    rpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? TESTNET_DEPLOYMENT.rpcUrl,
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE ?? TESTNET_DEPLOYMENT.networkPassphrase,
    verifierContractId:
      process.env.NEXT_PUBLIC_STELAKEY_VERIFIER_CONTRACT_ID ??
      TESTNET_DEPLOYMENT.verifierContractId,
    deployerContractId:
      process.env.NEXT_PUBLIC_STELAKEY_DEPLOYER_CONTRACT_ID ??
      TESTNET_DEPLOYMENT.deployerContractId,
    accountWasmHash:
      process.env.NEXT_PUBLIC_STELAKEY_ACCOUNT_WASM_HASH ??
      TESTNET_DEPLOYMENT.accountWasmHash,
    verificationKeyHash:
      process.env.STELAKEY_VERIFICATION_KEY_HASH ?? TESTNET_DEPLOYMENT.verificationKeyHash
  };
}

export function testnetExplorerTxUrl(txHash: string) {
  return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
}
