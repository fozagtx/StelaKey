use dep::poseidon::poseidon::bn254;
use dep::sha256;
use dep::std::ecdsa_secp256k1;

global DOMAIN_TAG: Field = 0x5354454c414b4559; // "STELAKEY"
global BITCOIN_PREIMAGE_LEN: u64 = 262;
global MESSAGE_LEN: u32 = 236;

fn bytes16_limb(bytes: [u8; 32], offset: u32) -> Field {
    let mut limb: Field = 0;
    for i in 0..16 {
        limb = limb * 256 + (bytes[offset + i] as Field);
    }
    limb
}

fn hex_char(nibble: u8) -> u8 {
    assert(nibble < 16, "Invalid hex nibble");
    if nibble < 10 {
        48 + nibble
    } else {
        87 + nibble
    }
}

fn write_ascii_12(mut out: [u8; 236], offset: u32, bytes: [u8; 12]) -> [u8; 236] {
    for i in 0..12 {
        out[offset + i] = bytes[i];
    }
    out
}

fn write_ascii_9(mut out: [u8; 236], offset: u32, bytes: [u8; 9]) -> [u8; 236] {
    for i in 0..9 {
        out[offset + i] = bytes[i];
    }
    out
}

fn write_ascii_10(mut out: [u8; 236], offset: u32, bytes: [u8; 10]) -> [u8; 236] {
    for i in 0..10 {
        out[offset + i] = bytes[i];
    }
    out
}

fn write_hash_hex(mut out: [u8; 236], offset: u32, bytes: [u8; 32]) -> [u8; 236] {
    for i in 0..32 {
        let byte = bytes[i];
        out[offset + (2 * i)] = hex_char(byte / 16);
        out[offset + (2 * i) + 1] = hex_char(byte % 16);
    }
    out
}

fn canonical_wallet_message(
    network_hash: [u8; 32],
    signature_payload_hash: [u8; 32],
    stellar_intent_hash: [u8; 32],
) -> [u8; 236] {
    let mut msg: [u8; 236] = [0; 236];

    msg = write_ascii_12(msg, 0, [83, 116, 101, 108, 97, 75, 101, 121, 32, 118, 49, 10]);

    msg = write_ascii_10(msg, 12, [110, 101, 116, 119, 111, 114, 107, 61, 48, 120]);
    msg = write_hash_hex(msg, 22, network_hash);
    msg[86] = 10;

    msg = write_ascii_10(msg, 87, [112, 97, 121, 108, 111, 97, 100, 61, 48, 120]);
    msg = write_hash_hex(msg, 97, signature_payload_hash);
    msg[161] = 10;

    msg = write_ascii_9(msg, 162, [105, 110, 116, 101, 110, 116, 61, 48, 120]);
    msg = write_hash_hex(msg, 171, stellar_intent_hash);
    msg[235] = 10;

    msg
}

fn bitcoin_signed_message_hash(message: [u8; 236]) -> [u8; 32] {
    let mut preimage: [u8; 262] = [0; 262];

    preimage[0] = 24;
    preimage[1] = 66;
    preimage[2] = 105;
    preimage[3] = 116;
    preimage[4] = 99;
    preimage[5] = 111;
    preimage[6] = 105;
    preimage[7] = 110;
    preimage[8] = 32;
    preimage[9] = 83;
    preimage[10] = 105;
    preimage[11] = 103;
    preimage[12] = 110;
    preimage[13] = 101;
    preimage[14] = 100;
    preimage[15] = 32;
    preimage[16] = 77;
    preimage[17] = 101;
    preimage[18] = 115;
    preimage[19] = 115;
    preimage[20] = 97;
    preimage[21] = 103;
    preimage[22] = 101;
    preimage[23] = 58;
    preimage[24] = 10;
    preimage[25] = MESSAGE_LEN as u8;

    for i in 0..236 {
        preimage[26 + i] = message[i];
    }

    let first_hash = sha256::sha256_var(preimage, BITCOIN_PREIMAGE_LEN);
    sha256::sha256_var(first_hash, 32)
}

fn main(
    pubkey_x: [u8; 32],
    pubkey_y: [u8; 32],
    sig_r: [u8; 32],
    sig_s: [u8; 32],
    stellar_intent_hash: pub [u8; 32],
    signature_payload_hash: pub [u8; 32],
    network_hash: pub [u8; 32],
    expiry_ledger: pub Field,
    replay_key: pub Field,
    wallet_scheme: pub Field,
) -> pub [Field; 10] {
    let mut signature: [u8; 64] = [0; 64];
    for i in 0..32 {
        signature[i] = sig_r[i];
        signature[32 + i] = sig_s[i];
    }

    let wallet_message = canonical_wallet_message(
        network_hash,
        signature_payload_hash,
        stellar_intent_hash,
    );
    let bitcoin_message_hash = bitcoin_signed_message_hash(wallet_message);

    let is_valid = ecdsa_secp256k1::verify_signature(
        pubkey_x,
        pubkey_y,
        signature,
        bitcoin_message_hash,
    );
    assert(is_valid, "Invalid secp256k1 ECDSA signature");

    let owner_commitment = bn254::hash_5([
        bytes16_limb(pubkey_x, 0),
        bytes16_limb(pubkey_x, 16),
        bytes16_limb(pubkey_y, 0),
        bytes16_limb(pubkey_y, 16),
        DOMAIN_TAG,
    ]);

    [
        owner_commitment,
        bytes16_limb(stellar_intent_hash, 0),
        bytes16_limb(stellar_intent_hash, 16),
        bytes16_limb(signature_payload_hash, 0),
        bytes16_limb(signature_payload_hash, 16),
        bytes16_limb(network_hash, 0),
        bytes16_limb(network_hash, 16),
        expiry_ledger,
        replay_key,
        wallet_scheme,
    ]
}
