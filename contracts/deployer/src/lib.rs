#![no_std]

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};

#[contract]
pub struct StelaKeyDeployer;

#[contractimpl]
impl StelaKeyDeployer {
    pub fn version(_env: Env) -> u32 {
        2
    }

    pub fn account_salt(_env: Env, owner_commitment: BytesN<32>) -> BytesN<32> {
        owner_commitment
    }

    pub fn account_address(env: Env, owner_commitment: BytesN<32>) -> Address {
        env.deployer()
            .with_current_contract(owner_commitment)
            .deployed_address()
    }

    pub fn deploy_account(
        env: Env,
        account_wasm_hash: BytesN<32>,
        owner_commitment: BytesN<32>,
        verifier: Address,
        verification_key_hash: BytesN<32>,
        network_hash: BytesN<32>,
        account_tag: BytesN<32>,
    ) -> Address {
        env.deployer()
            .with_current_contract(owner_commitment.clone())
            .deploy_v2(
                account_wasm_hash,
                (
                    owner_commitment,
                    verifier,
                    verification_key_hash,
                    network_hash,
                    account_tag,
                ),
            )
    }
}
