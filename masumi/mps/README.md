# Dedicated local Masumi payment service

This directory reproduces the local payment-service changes used by Ocnif's Masumi/Sokosumi worker. The Azure Cardano container remains a stateless adapter to the Rust core. The payment database, encrypted seller wallet, administrator key, and Sokosumi credential vault stay on the operator's computer.

The official source is pinned in `provenance.json`. The patch changes only five files: it defaults HTTP listening to loopback, prevents generated wallet mnemonics from appearing in logs, and updates four exact transitive dependency versions. It preserves upstream's separate V1/V2 Mesh SDK versions and encryption format. No governance files are copied or modified.

## Prepare the official source

Use Node 24.22.1 and pnpm 10.30.2. Clone the public repository into a dedicated directory, then run these commands from this `masumi` directory. Replace `/absolute/path/masumi-payment-service` with that checkout's actual path.

```sh
git clone https://github.com/masumi-network/masumi-payment-service /absolute/path/masumi-payment-service
git -C /absolute/path/masumi-payment-service checkout a846392ccfc8f5a85aee594ad9441dc90820dab0
node mps/prepare.mjs /absolute/path/masumi-payment-service
pnpm --dir /absolute/path/masumi-payment-service install --frozen-lockfile --ignore-scripts
node mps/verify.mjs /absolute/path/masumi-payment-service
```

The preparation command verifies the original commit and all five file hashes before applying the patch. Repeating it verifies the patched hashes. Other source versions or partial edits fail closed. Dependency lifecycle scripts are disabled; Prisma generation is invoked explicitly below.

## Private configuration

Provision a dedicated PostgreSQL database with SCRAM password authentication on `127.0.0.1:58327`. The observed setup used PostgreSQL 18.6, database/user `ocnif_mps`, 64 MB shared buffers, and 30 maximum connections. Keep the data directory and logs under the ignored `masumi/.local/` directory, with access restricted to your account. Do not reuse an unrelated application's database.

Create `.local/mps.env` with permissions 600. Enter a dedicated PostgreSQL URL, a cryptographically random encryption key, and a separate administrator key in the editor. Preserve the encryption key with the encrypted database: losing either loses access to the generated test wallet. The actual secret values must never be copied into source, chat, terminal commands, screenshots, or receipts.

```dotenv
DATABASE_URL=postgresql://ocnif_mps:<dedicated-password>@127.0.0.1:58327/ocnif_mps
ENCRYPTION_KEY=<dedicated-random-secret>
ADMIN_KEY=<different-dedicated-random-secret>
```

In the ignored `masumi/.env`, enter your **Preprod** Blockfrost project key in `BLOCKFROST_API_KEY_PREPROD`. Preview and Mainnet keys are not accepted by this setup. No wallet recovery phrase or private signing key is requested. The service generates its own dedicated Preprod test wallets and stores the secrets encrypted in PostgreSQL.

## Initialize and run

```sh
node mps/run-local.mjs /absolute/path/masumi-payment-service generate
node mps/run-local.mjs /absolute/path/masumi-payment-service migrate
node mps/run-local.mjs /absolute/path/masumi-payment-service seed
node mps/run-local.mjs /absolute/path/masumi-payment-service serve
```

The launcher passes only the dedicated database, encryption, administrator, and Preprod provider configuration to the child. It never forwards OpenAI credentials. HTTP binds to `127.0.0.1:38127`. Child output goes into private files under `.local/`. A seed journal is created before starting the seed operation; an interrupted or failed seed requires inspecting the existing database before deciding whether a retry is safe. Do not remove that journal merely to bypass the check.

After seeding, inspect public source and selling-wallet identifiers through the local authenticated API. Fund the generated **Preprod** selling address with test ADA for registration/transaction fees. Save public IDs in `.local/payment-state.json`, create one wallet-scoped ReadAndPay runtime key with `payment-registration.mjs key`, and use the separate administrator key only for registration. The worker's signed quote remains **1 test USDM**; ADA fees, registration, Sokosumi execution credits, and payment settlement are distinct.

The actual Personal Workspace execution task and follow-up must be verified before enabling paid tasks. A real paid result requires confirmed registry state, matching FundsLocked, model output and result hash, a matching withdrawal, and observed positive seller receipt. A service health response or local unit test does not establish any of these chain events.

## Evidence and limits

On October 31, 2026, the dedicated database migrations and backend TypeScript check passed. The pinned production dependency audit reported zero critical/high findings and four moderate findings, down from two high/six moderate before the patch. The remaining minimatch/glob findings are retained; a broad major-version override was not applied to the payment SDK tree. This is dependency checking, not a formal security audit.

The pinned-source verification checks that generated wallet material is absent from console output and that missing Preprod prerequisites are rejected. Funded registration, a paid Sokosumi Task, and actual settlement remain separate runtime steps and are not claimed by this preparation record.
