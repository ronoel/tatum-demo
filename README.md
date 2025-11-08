# Bitcoin Testnet Wallet Manager

A demo application for managing Bitcoin testnet wallets using the Tatum SDK/API. This interactive CLI tool allows you to generate wallets, check balances, and send Bitcoin transactions on the testnet.

## Prerequisites

- **Node.js** (v14 or higher)
- **Tatum API Key** - Get one free at [Tatum Dashboard](https://dashboard.tatum.io/)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure your API key:
```bash
cp config.example.json config.json
```

Then edit `config.json` and replace `your-api-key-here` with your actual Tatum API key.

## How to Run

Run the main wallet manager:
```bash
node sendBTC.js
```

Alternatively, you can check UTXOs for a specific address:
```bash
node getUTXos.js
```

## What to Expect

When you run `sendBTC.js`, the application will:

1. **Wallet Setup** - You'll be prompted to choose one of three options:
   - Enter an existing mnemonic phrase
   - Enter an existing private key
   - Generate a new wallet (mnemonic + private key)

2. **Balance Check** - The app will:
   - Display your Bitcoin testnet address
   - Show incoming/outgoing balances (confirmed and pending)
   - List all unspent UTXOs (transaction outputs)
   - Display available balance in both satoshis and BTC

3. **Send Transaction** (optional) - If you have funds, you can:
   - Enter a recipient address
   - Specify amount to send in BTC
   - Review transaction details (amount, fee, change address)
   - Confirm and broadcast the transaction
   - Receive a transaction hash and block explorer link

## Example Output

```
=== Bitcoin Testnet Wallet ===
Address: tb1q...
Incoming (confirmed): 50000 satoshis
Outgoing (confirmed): 0 satoshis
Available to Spend: 50000 satoshis (0.0005 BTC)

Unspent UTXOs: 1
  - abc123...:0: 50000 satoshis (confirmed)
```

## Features

- Generate new Bitcoin testnet wallets
- Derive addresses from mnemonic phrases or private keys
- View detailed balance and UTXO information
- Send Bitcoin transactions with automatic UTXO selection
- Interactive prompts with validation
- Transaction confirmation before broadcasting

## Network

This application operates on **Bitcoin Testnet**. Testnet coins have no real value and are meant for testing purposes only.

## Notes

- The default network fee is set to 1000 satoshis (0.00001 BTC)
- Minimum transaction amount is 546 satoshis (dust limit)
- Get free testnet Bitcoin from faucets like [Coinfaucet](https://coinfaucet.eu/en/btc-testnet/)
