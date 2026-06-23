#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    Address, Bytes, BytesN, Env, Error, Symbol, TryIntoVal, Vec,
};

#[contract]
pub struct StelaKeyAccount;

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub owner_commitment: BytesN<32>,
    pub verifier: Address,
    pub verification_key_hash: BytesN<32>,
    pub network_hash: BytesN<32>,
    pub account_tag: BytesN<32>,
    pub paused: bool,
    pub version: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct AuthProof {
    pub proof_bytes: Bytes,
    pub public_inputs: Bytes,
    pub signature_payload_hash: BytesN<32>,
    pub owner_commitment: BytesN<32>,
    pub expires_ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Config,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccountError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    OwnerCommitmentMismatch = 4,
    PayloadMismatch = 5,
    Expired = 6,
    VerifierRejected = 7,
    PublicInputsMalformed = 8,
    PublicInputMismatch = 9,
}

const FIELD_BYTES: u32 = 32;
const PUBLIC_INPUT_BYTES: u32 = 3488;
const OWNER_COMMITMENT_FIELD: u32 = 99;
const SIGNATURE_PAYLOAD_FIELD_0: u32 = 102;
const SIGNATURE_PAYLOAD_FIELD_1: u32 = 103;
const NETWORK_HASH_FIELD_0: u32 = 104;
const NETWORK_HASH_FIELD_1: u32 = 105;
const EXPIRY_LEDGER_FIELD: u32 = 106;
const WALLET_SCHEME_FIELD: u32 = 108;
const WALLET_SCHEME_ECDSA_MESSAGE: u32 = 1;

#[contractimpl]
impl StelaKeyAccount {
    fn write_config(
        env: Env,
        owner_commitment: BytesN<32>,
        verifier: Address,
        verification_key_hash: BytesN<32>,
        network_hash: BytesN<32>,
        account_tag: BytesN<32>,
    ) -> Result<(), AccountError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(AccountError::AlreadyInitialized);
        }

        let config = Config {
            owner_commitment,
            verifier,
            verification_key_hash,
            network_hash,
            account_tag,
            paused: false,
            version: 1,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    pub fn __constructor(
        env: Env,
        owner_commitment: BytesN<32>,
        verifier: Address,
        verification_key_hash: BytesN<32>,
        network_hash: BytesN<32>,
        account_tag: BytesN<32>,
    ) -> Result<(), AccountError> {
        Self::write_config(
            env,
            owner_commitment,
            verifier,
            verification_key_hash,
            network_hash,
            account_tag,
        )
    }

    pub fn init(
        env: Env,
        owner_commitment: BytesN<32>,
        verifier: Address,
        verification_key_hash: BytesN<32>,
        network_hash: BytesN<32>,
        account_tag: BytesN<32>,
    ) -> Result<(), AccountError> {
        Self::write_config(
            env,
            owner_commitment,
            verifier,
            verification_key_hash,
            network_hash,
            account_tag,
        )
    }

    pub fn config(env: Env) -> Result<Config, AccountError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(AccountError::NotInitialized)
    }

    fn public_input_field(
        env: &Env,
        public_inputs: &Bytes,
        index: u32,
    ) -> Result<BytesN<32>, AccountError> {
        if public_inputs.len() != PUBLIC_INPUT_BYTES {
            return Err(AccountError::PublicInputsMalformed);
        }

        let start = index * FIELD_BYTES;
        let mut field = [0u8; 32];
        public_inputs
            .slice(start..start + FIELD_BYTES)
            .copy_into_slice(&mut field);

        Ok(BytesN::from_array(env, &field))
    }

    fn hash_limb(env: &Env, hash: &BytesN<32>, offset: usize) -> BytesN<32> {
        let hash_bytes = hash.to_array();
        let mut field = [0u8; 32];
        field[16..].copy_from_slice(&hash_bytes[offset..offset + 16]);
        BytesN::from_array(env, &field)
    }

    fn u32_field(env: &Env, value: u32) -> BytesN<32> {
        let mut field = [0u8; 32];
        field[28..].copy_from_slice(&value.to_be_bytes());
        BytesN::from_array(env, &field)
    }

    fn check_public_inputs(
        env: &Env,
        config: &Config,
        signature: &AuthProof,
        signature_payload_hash: &BytesN<32>,
    ) -> Result<(), AccountError> {
        if Self::public_input_field(env, &signature.public_inputs, OWNER_COMMITMENT_FIELD)?
            != signature.owner_commitment
        {
            return Err(AccountError::PublicInputMismatch);
        }

        if Self::public_input_field(env, &signature.public_inputs, SIGNATURE_PAYLOAD_FIELD_0)?
            != Self::hash_limb(env, signature_payload_hash, 0)
        {
            return Err(AccountError::PublicInputMismatch);
        }
        if Self::public_input_field(env, &signature.public_inputs, SIGNATURE_PAYLOAD_FIELD_1)?
            != Self::hash_limb(env, signature_payload_hash, 16)
        {
            return Err(AccountError::PublicInputMismatch);
        }

        if Self::public_input_field(env, &signature.public_inputs, NETWORK_HASH_FIELD_0)?
            != Self::hash_limb(env, &config.network_hash, 0)
        {
            return Err(AccountError::PublicInputMismatch);
        }
        if Self::public_input_field(env, &signature.public_inputs, NETWORK_HASH_FIELD_1)?
            != Self::hash_limb(env, &config.network_hash, 16)
        {
            return Err(AccountError::PublicInputMismatch);
        }

        if Self::public_input_field(env, &signature.public_inputs, EXPIRY_LEDGER_FIELD)?
            != Self::u32_field(env, signature.expires_ledger)
        {
            return Err(AccountError::PublicInputMismatch);
        }
        if Self::public_input_field(env, &signature.public_inputs, WALLET_SCHEME_FIELD)?
            != Self::u32_field(env, WALLET_SCHEME_ECDSA_MESSAGE)
        {
            return Err(AccountError::PublicInputMismatch);
        }

        Ok(())
    }
}

#[contractimpl]
impl CustomAccountInterface for StelaKeyAccount {
    type Signature = AuthProof;
    type Error = AccountError;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: Self::Signature,
        _auth_context: Vec<Context>,
    ) -> Result<(), Self::Error> {
        let config = Self::config(env.clone())?;
        if config.paused {
            return Err(AccountError::Paused);
        }
        if signature.owner_commitment != config.owner_commitment {
            return Err(AccountError::OwnerCommitmentMismatch);
        }
        let signature_payload_hash = signature_payload.to_bytes();
        if signature.signature_payload_hash != signature_payload_hash {
            return Err(AccountError::PayloadMismatch);
        }
        if env.ledger().sequence() > signature.expires_ledger {
            return Err(AccountError::Expired);
        }
        Self::check_public_inputs(&env, &config, &signature, &signature_payload_hash)?;

        let args = (signature.public_inputs, signature.proof_bytes)
            .try_into_val(&env)
            .map_err(|_| AccountError::VerifierRejected)?;

        match env.try_invoke_contract::<(), Error>(
            &config.verifier,
            &Symbol::new(&env, "verify_proof"),
            args,
        ) {
            Ok(Ok(())) => Ok(()),
            _ => Err(AccountError::VerifierRejected),
        }
    }
}
