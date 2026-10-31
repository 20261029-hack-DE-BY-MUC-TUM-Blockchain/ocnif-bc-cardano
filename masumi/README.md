# Ocnif Masumi and Sokosumi agent

This is the selected Cardano integration. The agent turns supplied security evidence into an observed-facts assessment, uncertainty, prioritized remediation, and verification/rollback steps. Its Node24 bridge calls the existing Ocnif Rust core. The provider credential stays only in that core. This bridge does not launch scanners or contact a target.

The worker/payment state machines adapt the official TUM quickstart at revision `d93783b907a5b0b7008c67496c6e093faa70553f`; `provenance.json` records exact upstream source hashes. Upstream README and AGENTS were read; governance was not copied. Eve/ZAI inference is replaced by the Ocnif core bridge, so this subproject has no npm runtime dependencies. The separately installed Sokosumi CLI must be **1.0.4 under Node24.x** because the supported vault/runtime adapter imports that version's modules.

## Execution-only setup first

1. Use your own account at `https://preprod.sokosumi.com`. Run `sokosumi --preprod auth login`, `auth whoami --json`, and `sokosumi skills`. Read help before account changes.
2. Inspect `workspaces list --json`, `vendors me --json`, and `coworkers list --scope owned --json`. Reuse your existing resources. Vendor creation requires organization membership; obtain the TUM invitation privately from the official guide. Continue the first test in **Personal Workspace**, with sufficient Preprod credits.
3. Register/connect your private Coworker with task capability and personal access. Import its runtime credential **once**, directly into the CLI vault:

   ```sh
   sokosumi --preprod coworkers api-key COWORKER_ID --json |
     sokosumi --preprod runtime key-import --coworker-id COWORKER_ID --api-key-stdin
   ```

   Never paste this credential into `.env`, chat, or Git. Do not generate another key on resume after successful import.
4. From this directory, install the empty locked dependency set with `npm ci --ignore-scripts`. If `.env` does not already exist, copy `.env.example` and set mode600. Configure `CORE_HTTP_URL`, the shared `INTERNAL_TOKEN`, local agent URL/port, and your `COWORKER_ID`. Leave both organization settings blank and `PAID_TASKS_ENABLED=false`. No model-provider key belongs here.
5. Start `npm start`; run `npm run probe` once to verify a real core result, then `npm run worker` in another terminal. Keep exactly one worker and agent running. The supported CLI credential vault and private journals remain on this host.
6. Only after `Continuous worker running`, create a small task using your account login:

   ```sh
   sokosumi --preprod tasks create --personal --coworker-id COWORKER_ID \
     --name "Ocnif evidence review" \
     --description "Review this synthetic evidence: the app runs as root, egress is unrestricted, and its token is in a secret manager. Distinguish observations and hypotheses; propose three verification steps. Do not scan a target." \
     --status READY --json
   ```

7. Verify `COMPLETED`, read the saved useful result in Sokosumi, then send one follow-up comment and verify the answer. `.local/execution-proof.json` is written only after the pinned CLI confirms the completion event/result and a fresh runtime read confirms the task status. It is local evidence, not cloud worker proof.

The worker saves a pending journal before starting a task, model request, completion, comment, or payment write. An uncertain effect requires inspection of the existing task and journal; it is never automatically replayed. For `grant_required`, stop the worker and follow the official guide's owner-approval/recovery procedure. Do not remove a journal until the prior write's outcome is known.

## Masumi paid task after execution proof

Use the official Masumi Payment Service setup for a **dedicated** Preprod database, encryption key, and selling wallet. Keep the setup-only administrator key in `.local/mps.env` mode600; never pass it to the continuous worker. Fund the selling wallet with test ADA. Buyer Preprod credits/test tokens and seller transaction-fee funds are different requirements.

Save only your own returned `sourceId`, `walletId`, and `sellerAddress` in private `.local/payment-state.json`. Set `MPS_URL`, `AGENT_API_PORT`, `AGENT_AUTHOR`, and `BLOCKFROST_API_KEY_PREPROD` in private `.env`. The selected Masumi settlement verifier uses a **Preprod Blockfrost project key**; enter it locally, never in chat. The historical x402 Koios route does not remove this requirement.

```sh
node --env-file=.env --env-file=.local/mps.env payment-registration.mjs key
node --env-file=.env --env-file=.local/mps.env payment-registration.mjs register
node --env-file=.env --env-file=.local/mps.env payment-registration.mjs
```

The key is wallet-scoped ReadAndPay without administrator rights. Wait for confirmed registration, then complete private `.local/registration-state.json` with its actual `agentIdentifier`, `supportedPaymentSourceIndex`, and seller `sellerVkey`, read from your own confirmed registry/wallet responses. The helper preserves unknown writes for manual reconciliation. Never substitute another project's registration or wallet.

Start `npm run api`, enable `PAID_TASKS_ENABLED=true`, and restart the single worker. The worker refuses paid mode without a verified Personal Workspace execution proof and confirmed Masumi setup. A paid task requests **1 test USDM** using the official Preprod asset identifier and signed terms. The model starts only after confirmed FundsLocked. The result hash must be confirmed before completion. A seller receipt requires matching Sokosumi/MPS withdrawal hashes plus positive seller token net flow verified from Blockfrost transaction inputs/outputs. Task completion, quote creation, signature, escrow, and settlement remain distinct states.

## API and deployment

`GET /health` is process liveness. `GET /v1/config` reports `integration:"masumi-sokosumi"`, Preprod, Rust-core health, and separate worker/execution/paid setup states. It exposes no task content or credential. Optional local receipt metadata names its source and observation time. `POST /answer` requires the shared bearer token and accepts `{input,history?}`. Input is limited to12,000 UTF-8 bytes and assembled core context to16,000 bytes.

Build `Dockerfile.masumi` from the repository root. It contains only the stateless Node24 agent bridge, runs as non-root, and uses no ledger volume or Coworker credential. Set `AGENT_HOST=0.0.0.0`, `AGENT_PORT=8096`, `CORE_HTTP_URL`, `INTERNAL_TOKEN`, and optional `AGENT_LOCALE`. Use `docker-compose.masumi.yml` only for local development and set its core URL to an actually reachable host.

The native worker requires the user's supported CLI vault and durable private `.local` directory. The cloud image does not contain that worker, vault, MPS, or local receipts. Therefore cloud setup flags remain unverified; a health response is never proof of a completed or paid task. The legacy root Dockerfile and x402 source remain an explicit earlier alternative.

## Verification boundary

Run `npm test`. Tests cover real local HTTP authentication/limits/error redaction, exact completion-result confirmation, cross-workspace isolation, uncertain effects, payment terms and deadlines, confirmed escrow, receipt accounting, and concurrent worker locks. They use offline fixtures for Sokosumi/MPS and cannot prove settlement. A real local Rust-core probe returned a useful synthetic-evidence review on October31,2026; account execution and funded settlement require their own later receipts. No paid task or on-chain transfer is claimed by these tests.
