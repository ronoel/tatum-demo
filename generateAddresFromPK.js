import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { readFileSync } from 'fs';

const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;

/**
 * Generate Bitcoin testnet address from private key
 * @param {string} privateKey - Private key in WIF or hex format
 * @returns {string} Bitcoin testnet address
 */
export function generateAddressFromPrivateKey(privateKey) {
  // Check if it's WIF format or hex
  const keyPair = privateKey.length === 64
    ? ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'), { network })
    : ECPair.fromWIF(privateKey, network);

  // Generate address (P2PKH)
  const address = bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network
  }).address;

  return address;
}

// If run directly, use config.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = JSON.parse(readFileSync('./config.json', 'utf8'));
  const address = generateAddressFromPrivateKey(config.privateKey);
  console.log(address);
}