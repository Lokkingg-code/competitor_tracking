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
it, but sends no prompt. The enrichment workflow defaults to `gemini-3.8-flash`.
To test that exact model with a synthetic connectivity prompt:

```sh
export GEMINI_MODEL=gemini-3.8-flash
read -s "GEMINI_API_KEY?Gemini API key: "; export GEMINI_API_KEY; npm run ai:gemini-check; unset GEMINI_API_KEY; echo
```

The script never reads dashboard files.

Google's free-tier terms say submitted content may be used to improve its
products. Free access and rate limits depend on region, account, and model.
Check Google's current [pricing](https://ai.google.dev/gemini-api/docs/pricing)
and [supported regions](https://ai.google.dev/gemini-api/docs/available-regions)
before sending any captured news. Do not use a VPN or alternate region to bypass
provider restrictions.

## Vercel server-side smoke test

The root `api/ai-test.js` function provides a protected, synthetic-only Gemini
test for Vercel. It sends one fixed connection prompt and does not accept prompt
text from the caller.

In Vercel Project Settings, add these as **Secret** environment variables for a
Preview deployment:

- `GEMINI_API_KEY`: your Google AI Studio API key.
- `AI_TEST_TOKEN`: a separate long random secret used to protect the endpoint.

Optionally set `GEMINI_MODEL` as a nonsecret environment variable to override
the model ID; it defaults to `gemini-3.8-flash`.

Create a new Preview deployment after saving the variables. From a terminal,
call `https://<your-preview-domain>/api/ai-test` using `POST` with
`Authorization: Bearer <AI_TEST_TOKEN>`. Enter the test token only in your
terminal; do not put either secret in browser code. A `502` response includes a
Gemini API or connectivity failure. Vercel functions have their own usage limits
and billing, separate from Gemini API usage.

## Automatic signal enrichment

The `refresh-signals` GitHub Actions workflow runs after a change to
`data/signals.json` and on its daily schedule. It merges captures, then runs
`scripts/enrich_signals.py` before committing the updated dashboard data. Add
`GEMINI_API_KEY` as a GitHub Actions repository secret; Vercel environment
variables are not automatically available to GitHub Actions. The workflow
defaults to `gemini-3.8-flash`; optionally set the repository variable
`GEMINI_MODEL` to another model supported by the Gemini API key.

The local `scripts/capture/weekly_capture.sh` path runs the LinkedIn browser
collector, merges its output, then enriches new signals immediately when
`GEMINI_API_KEY` is set in that shell. Without the key, it leaves those
signals pending; pushing the refreshed feed lets the GitHub workflow enrich them
using the repository secret.

Only new or explicitly pending signal IDs are sent to Gemini. Each successful
result is saved as `ai_enrichment` in the signal and archive, including summary,
one-sentence headline summary, announcement tone, competitive insight, caveat,
named customer airline/relationship/segment when source-supported, suggested
signal type and product focus, confidence, whether each suggestion matches the
existing label, model, timestamp, and source-content hash. The existing canonical `type` and
`product_focus` fields are corrected when the corresponding model confidence is
at least 80%; the previous label is retained in the AI record and shown as an
AI update. Lower-confidence disagreements remain suggestions flagged for
review. Signals with saved enrichment are skipped on future runs. Up to 20
signals are processed per workflow run; rate-limited or failed signals remain
pending for a later run.

The AI summary is tuned to exactly two or three short, evidence-only sentences
and replaces the existing Evidence Preview in the briefing. Competitive insight
remains separate so analysis is not mixed into the source-grounded summary.
The At a Glance **Main movement** uses the newest saved competitive insight for
each competitor in the selected window, falling back to the newest headline
until that competitor has saved AI analysis. When at least two distinct named
airlines have high-confidence, source-supported LCC customer/partner activity,
it reports the distinct airline and signal counts. LCC status is not inferred
from an airline name alone.

The dashboard reads saved analysis locally from `data/signals.json`; viewing or
selecting an enriched signal makes no model request. GitHub Actions commits the
enriched feed and archive, after which Vercel redeploys the saved results. This
does not backfill older signals automatically.

To backfill historical signals, open **Actions → Refresh competitor signals →
Run workflow** and enable **Re-enrich historical signals missing the current AI
schema**. This includes older `ai_enrichment` records missing the newer headline
and customer/segment fields, but skips records already using the current schema.
It enriches at most 20 signals per run; run it again to process the next pending batch.
Backfill makes model requests. Gemini 3.8 Flash has free input and output on
the free tier, but Google may use free-tier prompts to improve its products and
enforces tier-specific rate limits. Review Google's current [pricing](https://ai.google.dev/gemini-api/docs/pricing)
and [terms](https://ai.google.dev/gemini-api/terms) before backfilling. The
separate Vercel smoke-test endpoint uses `AI_TEST_TOKEN` and does not power
dashboard summaries.

## SearXNG public-news discovery

The optional `scripts/capture/capture_searxng.py` collector searches the public
`news_queries` in `scripts/capture/sources.json`. It uses SearXNG's JSON search
endpoint and emits dated, public HTTP(S) results into the existing raw-signal
format. The normal merger handles URL/headline deduplication; AI enrichment then
runs once for each new signal. SearXNG is not used to scrape LinkedIn pages.

To enable it in GitHub Actions, add the root URL of an accessible SearXNG
instance as the repository Actions variable `SEARXNG_BASE_URL` under **Settings
→ Secrets and variables → Actions → Variables**. For a local run, export
`SEARXNG_BASE_URL` in the capture shell. If it is unset, the collector is
skipped. Results without a published date or a valid HTTP(S) source link are
discarded. Search coverage depends on the engines enabled by that SearXNG
instance, so review the deduplicated feed before relying on its coverage.