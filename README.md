# Ocnif Cardano paid reports

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

## Persistence / Persistencia

SQLite binds each verified transaction to one published report and the exact payment proof. Verification, settlement and the delivered result survive restart. A retry of the same proof returns the original result; attempts to reuse it for a different report are rejected. Run one service replica using DELETE journaling on the persistent `/data` volume. The backend endpoint `/internal/reports/<id>` requires the shared service token and must return only an immutable, explicitly published snapshot.

The provided tests use a synthetic facilitator boundary and local ledger. To qualify for the Cardano track, complete an actual preprod payment and retain its transaction hash and explorer evidence.

## Containers / Contenedores

Build the Dockerfile from this repository only. `docker-compose.yml` is for local development only; production uses Terraform and Container Apps. Run `gitleaks dir . --redact` before publishing. The pre-commit hook enforces scanning of staged changes.
