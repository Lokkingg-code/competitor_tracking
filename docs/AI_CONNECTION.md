# Copilot connection pilot

This manually triggered check uses the official GitHub Copilot SDK. It does not
read signal files, modify dashboard data, or enable scheduled analysis.

## Check access

Install dependencies with `npm install`, then run:

```sh
npm run ai:check
```

This checks authentication and lists available models without sending a model
prompt. If authentication is missing, run `copilot login` yourself in the
terminal and follow the GitHub sign-in flow. Never paste credentials into chat
or commit them to this repository. Signing into VS Code does not necessarily
sign into the standalone CLI.

The client uses `copilot-cli` mode to access the CLI's macOS Keychain login.
SDK `empty` mode disables Keychain access and cannot reuse a login stored there.

If authentication passes but GitHub returns `403 Forbidden`, verify that the
signed-in GitHub account has your company Copilot seat and ask the administrator
to check CLI/SDK feature access. Repeating login does not resolve a feature
authorization refusal. Do not work around company restrictions with another
account or an unapproved provider.

## Test a model reply

Confirm which model your company permits, then substitute its listed ID:

```sh
COPILOT_MODEL=<approved-model-id> npm run ai:check
```

The check sends a synthetic prompt requesting `COPILOT_CONNECTION_OK`, validates
that reply, and closes the runtime. Model invocation can consume your Copilot
usage allowance. Availability alone does not establish company approval.

The session has no available tools, rejects permission requests, disables
file hooks, instruction discovery, skills and memory, and runs outside the
repository in a temporary directory.
Copilot may retain session metadata locally according to its runtime behavior.
The check times out after 90 seconds. Authentication, model access, network
restrictions, and organization SDK/CLI policy can prevent a successful reply.

Credentials remain outside the browser. This pilot does not establish an
approved shared-service identity or authorize production automation.

## Gemini API connection check

The Gemini check uses Node's built-in `fetch`. Create an API key through
[Google AI Studio](https://aistudio.google.com/apikey), then enter it at a hidden
terminal prompt and run the check without saving the key in shell history:

```sh
read -s "GEMINI_API_KEY?Gemini API key: "; export GEMINI_API_KEY; npm run ai:gemini-check; unset GEMINI_API_KEY; echo
```

Without `GEMINI_MODEL`, the check verifies the key and lists models available to
it, but sends no prompt. Choose an eligible model ID, then run the same command
with that ID set to send a synthetic connectivity prompt:

```sh
export GEMINI_MODEL=<model-id>
read -s "GEMINI_API_KEY?Gemini API key: "; export GEMINI_API_KEY; npm run ai:gemini-check; unset GEMINI_API_KEY; echo
```

The script never reads dashboard files.

Google's free-tier terms say submitted content may be used to improve its
products. Free access and rate limits depend on region, account, and model.
Check Google's current [pricing](https://ai.google.dev/gemini-api/docs/pricing)
and [supported regions](https://ai.google.dev/gemini-api/docs/available-regions)
before sending any captured news. Do not use a VPN or alternate region to bypass
provider restrictions.

## OpenRouter free-model connection check

Create an OpenRouter API key at
[openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). In the
terminal, enter it at the hidden prompt to validate the key and list currently
available zero-priced models. This first check sends no model prompt:

```sh
read -s "OPENROUTER_API_KEY?OpenRouter API key: "; export OPENROUTER_API_KEY; npm run ai:openrouter-check; unset OPENROUTER_API_KEY; echo
```

Select an exact model ID printed by the check and set it before repeating the
command to test a synthetic response. The checker re-reads current catalog
pricing, and sends the synthetic prompt only when both input and output are
priced at zero:

```sh
export OPENROUTER_MODEL="replace-with-listed-free-model-id"
read -s "OPENROUTER_API_KEY?OpenRouter API key: "; export OPENROUTER_API_KEY; npm run ai:openrouter-check; unset OPENROUTER_API_KEY; echo
```

To safely check a specific model first, such as `nvidia/nemotron-3.5-lightning`,
set its exact ID as `OPENROUTER_MODEL`. If the catalog reports a nonzero price or
cannot verify zero pricing, the script refuses to send a model request.

Free-model availability, capacity, and account limits can change. OpenRouter
routes requests to the selected model's provider; review both OpenRouter's and
the underlying provider's data and retention terms before sending captured
news. The check never reads dashboard files.

## Vercel server-side smoke test

The root `api/ai-test.js` function provides a protected, synthetic-only test for
Vercel. It checks the live OpenRouter catalog and sends a completion only when
Nemotron 3.5 Lightning has valid, nonnegative input and output prices. It does not accept
prompt text from the caller.

In Vercel Project Settings, add these as **Secret** environment variables for a
Preview deployment:

- `OPENROUTER_API_KEY`: your OpenRouter key.
- `AI_TEST_TOKEN`: a separate long random secret used to protect the endpoint.

Create a new Preview deployment after saving the variables. From a terminal,
call `https://<your-preview-domain>/api/ai-test` using `POST` with
`Authorization: Bearer <AI_TEST_TOKEN>`. Enter the test token only in your
terminal; do not put either secret in browser code. A `402` response means Nemotron
pricing is missing or invalid and no model prompt was sent. A `502` response means the
Vercel function could not reach or use OpenRouter. Vercel functions have their
own usage limits and billing; this is separate from OpenRouter model charges.

## Automatic signal enrichment

The `refresh-signals` GitHub Actions workflow runs after a change to
`data/signals.json` and on its daily schedule. It merges captures, then runs
`scripts/enrich_signals.py` before committing the updated dashboard data. Add
`OPENROUTER_API_KEY` as a GitHub Actions repository secret; Vercel environment
variables are not automatically available to GitHub Actions.

Only new or explicitly pending signal IDs are sent to Nemotron. Each successful
result is saved as `ai_enrichment` in the signal and archive, including summary,
announcement tone, competitive insight, caveat, suggested signal type and
product focus, confidence, whether each suggestion matches the existing label,
model, timestamp, and source-content hash. The existing canonical `type` and
`product_focus` fields are not overwritten; disagreements are flagged for
review. Signals with saved enrichment are skipped on future runs. Up to 20
signals are processed per workflow run; rate-limited or failed signals remain
pending for a later run.

The dashboard reads saved analysis locally from `data/signals.json`; viewing or
selecting an enriched signal makes no model request. GitHub Actions commits the
enriched feed and archive, after which Vercel redeploys the saved results. This
does not backfill older signals automatically.

To backfill historical signals, open **Actions → Refresh competitor signals →
Run workflow** and enable **Queue all historical signals without saved AI
analysis**. It enriches at most 20 signals per run; run it again to process the
next pending batch. Signals already carrying `ai_enrichment` are always skipped.
Backfill makes model requests and can consume OpenRouter credits; review the
catalog rates and account balance first. A missing card does not guarantee zero
usage if credits are already available.

OpenRouter's current catalog rates are used and displayed with each summary.
They can change. A missing payment method does not guarantee zero usage charges
if the account has credits or another balance; check the OpenRouter usage and
balance. The separate Vercel smoke-test endpoint uses `AI_TEST_TOKEN` and does
not power dashboard summaries.