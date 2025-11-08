import https from 'https';
import { readFileSync } from 'fs';
import readline from 'readline';

const config = JSON.parse(readFileSync('./config.json', 'utf8'));

/**
 * Fetches Bitcoin transactions for a given address using Tatum API
 * @param {string} address - Bitcoin address to query
 * @param {number} pageSize - Number of transactions per page
 * @param {number} offset - Page offset
 * @returns {Promise<Array>} Array of transactions
 */
export function fetchTransactions(address, pageSize = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.tatum.io',
      path: `/v3/bitcoin/transaction/address/${address}?pageSize=${pageSize}&offset=${offset}`,
      method: 'GET',
      headers: {
        'x-api-key': config.apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const transactions = JSON.parse(data);
          resolve(transactions);
        } catch (error) {
          reject(new Error('Failed to parse response: ' + error.message));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * Analyzes UTXOs and calculates incoming/outgoing/pending amounts
 * @param {string} address - Bitcoin address to analyze
 * @param {Array} transactions - Array of transactions
 * @returns {Object} Balance information
 */
export function analyzeUTXOs(address, transactions) {
  const utxos = new Map(); // Track unspent outputs: key = "txHash:index", value = { value, spent, confirmed }
  
  let incoming = 0;
  let outgoing = 0;
  let incomingPending = 0;
  let outgoingPending = 0;

  // First pass: Mark all spent UTXOs
  const spentUtxos = new Set();
  for (const tx of transactions) {
    for (const input of tx.inputs) {
      if (input.coin && input.coin.address === address) {
        const utxoKey = `${input.prevout.hash}:${input.prevout.index}`;
        spentUtxos.add(utxoKey);
      }
    }
  }

  // Second pass: Process transactions (assuming they're ordered by block number, newest first)
  for (const tx of transactions) {
    const isConfirmed = tx.blockNumber !== undefined && tx.blockNumber !== null;

    // Process outputs (potential incoming)
    for (let i = 0; i < tx.outputs.length; i++) {
      const output = tx.outputs[i];

      if (output.address === address) {
        const utxoKey = `${tx.hash}:${i}`;
        const value = output.value;
        const isSpent = spentUtxos.has(utxoKey);

        // Add to UTXO set
        utxos.set(utxoKey, {
          value: value,
          spent: isSpent,
          confirmed: isConfirmed
        });

        if (isConfirmed) {
          incoming += value;
        } else {
          incomingPending += value;
        }
      }
    }

    // Process inputs (spending)
    for (const input of tx.inputs) {
      if (input.coin && input.coin.address === address) {
        const value = input.coin.value;

        if (isConfirmed) {
          outgoing += value;
        } else {
          outgoingPending += value;
        }
      }
    }
  }

  // Calculate available balance (unspent confirmed UTXOs)
  let availableBalance = 0;
  for (const [key, utxo] of utxos.entries()) {
    if (!utxo.spent && utxo.confirmed) {
      availableBalance += utxo.value;
    }
  }

  return {
    incoming,
    outgoing,
    incomingPending,
    outgoingPending,
    availableBalance,
    availableBalanceBTC: availableBalance / 100000000, // Convert satoshis to BTC
    unspentUTXOs: Array.from(utxos.entries())
      .filter(([key, utxo]) => !utxo.spent)
      .map(([key, utxo]) => ({
        utxo: key,
        value: utxo.value,
        confirmed: utxo.confirmed
      }))
  };
}

/**
 * Main function to get Bitcoin balance for an address
 * @param {string} address - Bitcoin address
 * @returns {Promise<Object>} Balance information
 */
export async function getBitcoinBalance(address) {
  try {
    console.log(`Fetching transactions for address: ${address}`);
    
    // Fetch all transactions with pagination
    const allTransactions = [];
    let offset = 0;
    const pageSize = 50;
    let hasMore = true;
    
    while (hasMore) {
      console.log(`Fetching page at offset ${offset}...`);
      const transactions = await fetchTransactions(address, pageSize, offset);
      
      if (transactions.length === 0) {
        hasMore = false;
      } else {
        allTransactions.push(...transactions);
        offset += pageSize;
        
        // If we got fewer transactions than pageSize, we've reached the end
        if (transactions.length < pageSize) {
          hasMore = false;
        }
      }
    }
    
    console.log(`Found ${allTransactions.length} total transactions`);
    
    // Analyze UTXOs
    const balance = analyzeUTXOs(address, allTransactions);
    
    return balance;
  } catch (error) {
    console.error('Error fetching Bitcoin balance:', error);
    throw error;
  }
}

// Execute the function for the specified address if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (question) => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  (async () => {
    try {
      const address = await askQuestion('Enter Bitcoin address to check: ');

      if (!address) {
        console.error('Error: Address cannot be empty.');
        rl.close();
        process.exit(1);
      }

      const result = await getBitcoinBalance(address);

      console.log('\n=== Bitcoin Balance Analysis ===');
      console.log(`Address: ${address}`);
      console.log(`Incoming (confirmed): ${result.incoming} satoshis`);
      console.log(`Outgoing (confirmed): ${result.outgoing} satoshis`);
      console.log(`Incoming Pending: ${result.incomingPending} satoshis`);
      console.log(`Outgoing Pending: ${result.outgoingPending} satoshis`);
      console.log(`\nAvailable to Spend: ${result.availableBalance} satoshis (${result.availableBalanceBTC} BTC)`);
      console.log(`\nUnspent UTXOs: ${result.unspentUTXOs.length}`);
      result.unspentUTXOs.forEach(utxo => {
        console.log(`  - ${utxo.utxo}: ${utxo.value} satoshis ${utxo.confirmed ? '(confirmed)' : '(pending)'}`);
      });

      rl.close();
    } catch (error) {
      console.error('Failed to get balance:', error);
      rl.close();
      process.exit(1);
    }
  })();
}
