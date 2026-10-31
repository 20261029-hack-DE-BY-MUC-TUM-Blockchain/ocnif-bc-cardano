# Ocnif Cardano integration

**Selected route: Masumi + Sokosumi.** Use [the Masumi setup and execution guide](masumi/README.md), Node24.x, Sokosumi CLI1.0.4, and `Dockerfile.masumi`. First verify a Personal Workspace execution-only task, then a paid Masumi task. The Ocnif provider credential stays only in the Rust core.

**Ruta elegida: Masumi + Sokosumi.** La implementación y configuración actuales están en [masumi/README.md](masumi/README.md). Primero se verifica una tarea de ejecución en Personal Workspace y después una tarea pagada de Masumi.

The x402 implementation below is a preserved earlier alternative. It is not the selected Cardano route or evidence of sponsor qualification.

# Historical x402 paid-report alternative

## Setup / Instalación

The service sells reports that their owners explicitly published in Ocnif. It uses the official x402 Cardano exact scheme on preprod with one confirmation. The backend's ordinary review approval never publishes a report.

El servicio vende informes que sus propietarios publicaron expresamente en Ocnif. Usa el esquema exact de x402 en Cardano preprod y exige una confirmación. Revisar un informe privado no lo publica.

Requires Node.js26.13 and an accessible Ocnif backend. Copy `.env.example` to ignored `.env`, set the shared private INTERNAL_TOKEN, backend URL, a preprod merchant receive address and a persistent ledger path. Leave CARDANO_PAY_TO empty to run with an explicit wallet-setup-required state. This service never accepts wallet seeds or signing keys.

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm start
```

The `/health` endpoint includes `configured`. `GET /v1/config` describes the preprod price. `GET /v1/reports/<published-report-id>` verifies that the report has been explicitly published before presenting HTTP402 requirements. An x402 client signs in its own preprod wallet and retries with the official PAYMENT-SIGNATURE header. The successful response carries PAYMENT-RESPONSE with the settlement transaction. The report is withheld if settlement fails.

El cliente firma con su propia billetera preprod. Una respuesta HTTP402 solicita el pago; no demuestra un pago. El informe se entrega después de que el facilitador confirme la liquidación.

## Browser wallet / Billetera en el navegador

`client/index.ts` exports `createCip30Signer(api,{koiosUrl,approval,journal})`. Pass the enabled CIP-30 API from the user's wallet. It uses Evolution SDK0.5.19's real CIP-30 transaction builder, and the resulting signer plugs into `new ExactCardanoScheme(signer)` from `@x402/cardano/exact/client`2.29.0. Keys stay in the browser wallet; no mnemonic is accepted. This client supports only the current preprod/default/ADA merchant offer.

The upstream provider is `https://preprod.koios.rest/api/v1` (public endpoint, no application secret). Its live tip returned HTTP200 during implementation but did not return a browser CORS header. Browser callers therefore pass `${location.origin}/cardano-provider`, served by Ocnif's bounded same-origin proxy to that fixed provider. Allow only `GET epoch_params?limit=1&order=epoch_no.desc` and `POST utxo_info` with `{_utxo_refs:["txid#index",...],_extended:true}`; no submission or script-evaluation proxy is needed. Direct official-provider URLs remain available outside the browser.

`approval` contains `{network:"cardano:preprod",payTo,amount,maxFeeLovelace,resourceUrl}` from a separate user review of the exact challenge. Show the maximum fee in addition to the report price. The application must bind the protected resource URL and selected requirements before calling the scheme, since that scheme's signer callback does not pass the resource URL.

The required durable `journal` implements atomic `reserve(key,record)` and `update(key,record)`. Records are `signing`, `signed` (with base64 CBOR and nonce) or `review_required`. Use one persistent journal across tabs; do not replace it with an in-memory map in the product. After any uncertain outcome, retry only the already-recorded payment proof through the server's replay-safe route. Never approve a fresh transaction automatically. The UI's x402 flow must retain and bind the complete proof to this resource.

The signer checks the exact recipient and amount, the explicit fee budget, allowed outputs, TTL and required Ed25519 signatures. It checks every funding UTXO against the live preprod provider before opening the signature prompt, because CIP-30 network id0 also describes Preview. It returns signed CBOR and the consumed UTXO nonce without broadcasting; the facilitator submits it during settlement. `signedTransactionId(base64)` derives the actual transaction hash for reconciliation, without implying submission or confirmation.

La integración utiliza CIP-30 y nunca solicita la frase semilla. El usuario revisa destinatario, precio, red, recurso y comisión máxima. Un diario persistente impide firmar dos veces la misma compra; el facilitador transmite la transacción. La conexión y la firma con una billetera financiada siguen pendientes de verificación real.

Seven tests cover server access/payment replay and browser transaction validation, including real Ed25519 signatures, tampered transactions, nonce/fee/TTL rejection and refusing mainnet. The browser tests validate transaction structure and wallet boundaries locally; no funded extension signing or on-chain client settlement has occurred.

## Persistence / Persistencia

SQLite binds each verified transaction to one published report and the exact payment proof. Verification, settlement and the delivered result survive restart. A retry of the same proof returns the original result; attempts to reuse it for a different report are rejected. Run one service replica using DELETE journaling on the persistent `/data` volume. The backend endpoint `/internal/reports/<id>` requires the shared service token and must return only an immutable, explicitly published snapshot.

The provided tests use a synthetic facilitator boundary and local ledger. To qualify for the Cardano track, complete an actual preprod payment and retain its transaction hash and explorer evidence.

## Containers / Contenedores

Build the Dockerfile from this repository only. `docker-compose.yml` is for local development only; production uses Terraform and Container Apps. Run `gitleaks dir . --redact` before publishing. The pre-commit hook enforces scanning of staged changes.
