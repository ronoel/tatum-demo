import readline from 'readline';
import { TatumSDK, Network } from '@tatumio/tatum';
import { UtxoWalletProvider } from '@tatumio/utxo-wallet-provider';
import { generateAddressFromPrivateKey } from './generateAddresFromPK.js';
import { getBitcoinBalance } from './getUTXos.js';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompts user for input
 * @param {string} question - Question to ask the user
 * @returns {Promise<string>} User's answer
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Initialize Tatum SDK for Bitcoin testnet
 * @param {string} apiKey - Optional Tatum API key
 * @returns {Promise<TatumSDK>} Initialized Tatum SDK instance
 */
async function initTatumSDK(apiKey = null) {
  const config = {
    network: Network.BITCOIN_TESTNET,
    configureWalletProviders: [
      { type: UtxoWalletProvider, config: { skipAllChecks: true } }
    ],
    verbose: true // Enable verbose logging
  };

  // Add API key if provided
  if (apiKey) {
    config.apiKey = { v4: apiKey };
  }

  console.log('SDK Config:', JSON.stringify({
    network: config.network,
    hasApiKey: !!apiKey,
    verbose: config.verbose,
    walletProvider: 'UtxoWalletProvider with skipAllChecks'
  }, null, 2));

  const tatumSdk = await TatumSDK.init(config);
  return tatumSdk;
}

/**
 * Generate a new random mnemonic using Tatum SDK
 * @param {TatumSDK} tatumSdk - Initialized Tatum SDK instance
 * @returns {string} 24-word mnemonic phrase
 */
function generateNewMnemonic(tatumSdk) {
  const mnemonic = tatumSdk.walletProvider.use(UtxoWalletProvider).generateMnemonic();
  return mnemonic;
}

/**
 * Derive private key from mnemonic using Tatum SDK
 * @param {TatumSDK} tatumSdk - Initialized Tatum SDK instance
 * @param {string} mnemonic - BIP39 mnemonic phrase
 * @param {number} index - Derivation index (default: 0)
 * @returns {Promise<string>} Private key in WIF format
 */
async function derivePrivateKeyFromMnemonic(tatumSdk, mnemonic, index = 0) {
  const privateKey = await tatumSdk.walletProvider
    .use(UtxoWalletProvider)
    .generatePrivateKeyFromMnemonic(mnemonic, index);
  return privateKey;
}

/**
 * Display wallet balance and UTXOs
 * @param {string} address - Bitcoin address
 * @param {Object} balance - Balance information from getBitcoinBalance
 */
function displayWalletInfo(address, balance) {
  console.log('\n=== Bitcoin Testnet Wallet ===');
  console.log(`Address: ${address}`);
  console.log(`Incoming (confirmed): ${balance.incoming} satoshis`);
  console.log(`Outgoing (confirmed): ${balance.outgoing} satoshis`);
  console.log(`Incoming Pending: ${balance.incomingPending} satoshis`);
  console.log(`Outgoing Pending: ${balance.outgoingPending} satoshis`);
  console.log(`\nAvailable to Spend: ${balance.availableBalance} satoshis (${balance.availableBalanceBTC} BTC)`);
  console.log(`\nUnspent UTXOs: ${balance.unspentUTXOs.length}`);

  if (balance.unspentUTXOs.length > 0) {
    balance.unspentUTXOs.forEach(utxo => {
      console.log(`  - ${utxo.utxo}: ${utxo.value} satoshis ${utxo.confirmed ? '(confirmed)' : '(pending)'}`);
    });
  } else {
    console.log('  No unspent UTXOs found');
  }
}

/**
 * Calculate maximum sendable amount considering network fees
 * @param {number} availableBalance - Available balance in satoshis
 * @param {number} feeInSatoshis - Estimated network fee in satoshis
 * @returns {number} Maximum sendable amount in satoshis
 */
function calculateMaxSendable(availableBalance, feeInSatoshis) {
  const maxSendable = availableBalance - feeInSatoshis;
  return maxSendable > 0 ? maxSendable : 0;
}

/**
 * Ask user for amount to send and validate it
 * @param {number} availableBalance - Available balance in satoshis
 * @param {number} feeInSatoshis - Network fee in satoshis
 * @returns {Promise<number>} Amount to send in BTC
 */
async function getAmountToSend(availableBalance, feeInSatoshis) {
  const maxSendable = calculateMaxSendable(availableBalance, feeInSatoshis);
  const maxSendableBTC = maxSendable / 100000000;
  const feeBTC = feeInSatoshis / 100000000;

  console.log(`\n=== Send Bitcoin ===`);
  console.log(`Network Fee: ${feeInSatoshis} satoshis (${feeBTC} BTC)`);
  console.log(`Maximum you can send: ${maxSendable} satoshis (${maxSendableBTC} BTC)`);
  console.log('');

  while (true) {
    const amountStr = await askQuestion('Enter amount to send in BTC (or "cancel" to exit): ');

    if (amountStr.toLowerCase() === 'cancel') {
      return null;
    }

    const amountBTC = parseFloat(amountStr);

    if (isNaN(amountBTC) || amountBTC <= 0) {
      console.log('Error: Please enter a valid positive number.');
      continue;
    }

    const amountSatoshis = Math.round(amountBTC * 100000000);

    if (amountSatoshis > maxSendable) {
      console.log(`Error: Amount exceeds maximum sendable amount of ${maxSendableBTC} BTC (including fee).`);
      continue;
    }

    // Minimum amount check (dust limit for Bitcoin is typically 546 satoshis)
    if (amountSatoshis < 546) {
      console.log('Error: Amount too small. Minimum is 546 satoshis (0.00000546 BTC).');
      continue;
    }

    return amountBTC;
  }
}


/**
 * Send Bitcoin transaction using Tatum SDK
 * @param {TatumSDK} tatumSdk - Initialized Tatum SDK instance
 * @param {string} fromAddress - Sender's address
 * @param {string} privateKey - Sender's private key
 * @param {string} toAddress - Recipient's address
 * @param {number} amountBTC - Amount to send in BTC
 * @param {number} feeBTC - Network fee in BTC
 * @param {Object} balance - Balance object with UTXOs
 * @returns {Promise<string>} Transaction hash
 */
async function sendTransaction(tatumSdk, fromAddress, privateKey, toAddress, amountBTC, feeBTC, balance) {
  const amountSatoshis = Math.round(amountBTC * 100000000);
  const feeSatoshis = Math.round(feeBTC * 100000000);

  console.log('\n=== Transaction Summary ===');
  console.log(`From: ${fromAddress}`);
  console.log(`To: ${toAddress}`);
  console.log(`Amount: ${amountBTC} BTC (${amountSatoshis} satoshis)`);
  console.log(`Fee: ${feeBTC} BTC (${feeSatoshis} satoshis)`);
  console.log(`Change Address: ${fromAddress}`);
  console.log('');

  const confirm = await askQuestion('Confirm transaction? (yes/no): ');

  if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
    console.log('Transaction cancelled.');
    return null;
  }

  // Select confirmed UTXOs to cover amount + fee
  const sortedUtxos = balance.unspentUTXOs
    .filter(utxo => utxo.confirmed)
    .sort((a, b) => b.value - a.value);

  let inputSum = 0;
  const selectedUtxos = [];
  const requiredAmount = amountSatoshis + feeSatoshis;

  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    inputSum += utxo.value;

    if (inputSum >= requiredAmount) {
      break;
    }
  }

  if (inputSum < requiredAmount) {
    throw new Error(`Insufficient confirmed funds. Have ${inputSum}, need ${requiredAmount} satoshis.`);
  }

  console.log(`\nUsing ${selectedUtxos.length} UTXO(s) totaling ${inputSum} satoshis`);

  // Prepare payload for Tatum SDK
  const payloadUtxo = {
    fromAddress: [{
      address: fromAddress,
      privateKey: privateKey
    }],
    to: [{
      address: toAddress,
      value: amountBTC
    }],
    fee: feeBTC.toString(),
    changeAddress: fromAddress
  };

  console.log('Sending transaction via Tatum SDK...');
  console.log('\nRequest Details:');
  console.log('fromAddress:', [{ address: fromAddress, privateKey: '***' }]);
  console.log('to:', JSON.stringify(payloadUtxo.to, null, 2));
  console.log('fee:', payloadUtxo.fee);
  console.log('changeAddress:', payloadUtxo.changeAddress);

  try {
    // Sign and broadcast transaction using Tatum SDK
    const txHash = await tatumSdk.walletProvider
      .use(UtxoWalletProvider)
      .signAndBroadcast(payloadUtxo);

    return txHash;
  } catch (error) {
    console.error('\nTransaction failed:', error.message);
    throw error;
  }
}

/**
 * Main application flow
 */
async function main() {
  let tatumSdk;

  try {
    console.log('=== Bitcoin Testnet Wallet Manager ===\n');

    // Load API key from config
    let apiKey = null;
    try {
      const { readFileSync } = await import('fs');
      const config = JSON.parse(readFileSync('./config.json', 'utf8'));
      apiKey = config.apiKey;
    } catch (error) {
      console.log('Note: config.json not found or apiKey not configured. Some features may be limited.\n');
    }

    console.log('Initializing Tatum SDK...\n');

    // Initialize Tatum SDK with API key if available
    tatumSdk = await initTatumSDK(apiKey);

    // Ask user for wallet option
    console.log('Please select an option:');
    console.log('1. I have a mnemonic phrase');
    console.log('2. I have a private key');
    console.log('3. Generate a new wallet');
    console.log('');

    const option = await askQuestion('Enter your choice (1, 2, or 3): ');

    let privateKey;
    let mnemonic;

    switch (option) {
      case '1':
        // User has mnemonic
        mnemonic = await askQuestion('Enter your mnemonic phrase: ');
        const derivationIndex = await askQuestion('Enter derivation index (default: 0): ');
        const index = derivationIndex ? parseInt(derivationIndex) : 0;

        console.log('\nDeriving private key from mnemonic...');
        privateKey = await derivePrivateKeyFromMnemonic(tatumSdk, mnemonic, index);
        console.log('Private key derived successfully!');
        console.log(`Private Key (WIF): ${privateKey}`);
        break;

      case '2':
        // User has private key
        privateKey = await askQuestion('Enter your private key (WIF or hex format): ');
        break;

      case '3':
        // Generate new wallet
        console.log('\nGenerating new wallet...');
        mnemonic = generateNewMnemonic(tatumSdk);
        console.log('\n⚠️  IMPORTANT: Save this mnemonic phrase securely! ⚠️');
        console.log('Mnemonic:', mnemonic);
        console.log('');

        privateKey = await derivePrivateKeyFromMnemonic(tatumSdk, mnemonic, 0);
        console.log('Private Key (WIF):', privateKey);
        console.log('');
        break;

      default:
        console.log('Invalid option. Please run the program again.');
        rl.close();
        if (tatumSdk) await tatumSdk.destroy();
        process.exit(1);
    }

    // Generate address from private key
    console.log('\nGenerating address...');
    const address = generateAddressFromPrivateKey(privateKey);

    // Fetch and display balance and UTXOs
    console.log('Fetching wallet information...\n');
    const balance = await getBitcoinBalance(address);

    // Display wallet information
    displayWalletInfo(address, balance);

    // Check if wallet has sufficient balance to send
    if (balance.availableBalance === 0) {
      console.log('\nWallet has no funds to send.');
      rl.close();
      await tatumSdk.destroy();
      return;
    }

    // Ask if user wants to send Bitcoin
    console.log('');
    const sendChoice = await askQuestion('Do you want to send Bitcoin? (yes/no): ');

    if (sendChoice.toLowerCase() !== 'yes' && sendChoice.toLowerCase() !== 'y') {
      console.log('Transaction cancelled.');
      rl.close();
      await tatumSdk.destroy();
      return;
    }

    // Set network fee (typical testnet fee: 1000 satoshis = 0.00001 BTC)
    // For mainnet, you should use dynamic fee estimation
    const feeInSatoshis = 1000; // 0.00001 BTC
    const feeBTC = feeInSatoshis / 100000000;

    // Check if balance is sufficient for minimum transaction + fee
    if (balance.availableBalance <= feeInSatoshis + 546) {
      console.log('\nInsufficient balance to send a transaction (need at least fee + dust limit).');
      rl.close();
      await tatumSdk.destroy();
      return;
    }

    // Get amount to send
    const amountBTC = await getAmountToSend(balance.availableBalance, feeInSatoshis);

    if (amountBTC === null) {
      console.log('Transaction cancelled.');
      rl.close();
      await tatumSdk.destroy();
      return;
    }

    // Get receiver address
    let receiverAddress;
    while (true) {
      receiverAddress = await askQuestion('Enter receiver Bitcoin address: ');

      // Basic validation (Bitcoin testnet addresses start with 'm', 'n', or 'tb1')
      if (!receiverAddress || receiverAddress.trim() === '') {
        console.log('Error: Address cannot be empty.');
        continue;
      }

      // Check if it's a valid testnet address format
      if (!receiverAddress.match(/^(m|n|tb1|2)[a-zA-Z0-9]{25,90}$/)) {
        console.log('Warning: Address format may be invalid for Bitcoin testnet.');
        const proceed = await askQuestion('Continue anyway? (yes/no): ');
        if (proceed.toLowerCase() !== 'yes' && proceed.toLowerCase() !== 'y') {
          continue;
        }
      }

      break;
    }

    // Send transaction using Tatum SDK
    const txHash = await sendTransaction(tatumSdk, address, privateKey, receiverAddress, amountBTC, feeBTC, balance);

    if (txHash) {
      console.log('\n=== Transaction Successful! ===');
      console.log(`txId: "${txHash}"`);
      console.log(`\nView on Block Explorer:`);
      console.log(`https://blockstream.info/testnet/tx/${txHash}`);
    }

    // Cleanup
    rl.close();
    await tatumSdk.destroy();

  } catch (error) {
    console.error('\nError:', error.message);
    rl.close();
    if (tatumSdk) await tatumSdk.destroy();
    process.exit(1);
  }
}

// Run the application
main();
