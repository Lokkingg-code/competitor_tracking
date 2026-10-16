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
it, but sends no prompt. The enrichment workflow defaults to `gemma-4-26b-a4b-it`.
To test that exact model with a synthetic connectivity prompt:

```sh
export GEMINI_MODEL=gemma-4-26b-a4b-it
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
the model ID; it defaults to `gemma-4-26b-a4b-it`.

Create a new Preview deployment after saving the variables. From a terminal,
call `https://<your-preview-domain>/api/ai-test` using `POST` with
`Authorization: Bearer <AI_TEST_TOKEN>`. Enter the test token only in your
terminal; do not put either secret in browser code. A `502` response includes a
Gemini API or connectivity failure. Vercel functions have their own usage limits
and billing, separate from Gemini API usage.

## Automatic signal enrichment

Requests use a 180-second socket timeout to allow for slower hosted model
responses. Set the Actions repository variable `AI_ENRICH_REQUEST_TIMEOUT_SECONDS`
to an integer from 1 to 300 to override it (or export the same variable locally).
This is a socket timeout, not a guaranteed total-request deadline. For diagnosis,
run the manual workflow with `max_signals` set to `1` before attempting a batch.

The `refresh-signals` GitHub Actions workflow runs after a change to
`data/signals.json` and on its daily schedule. It merges captures, then runs
`scripts/enrich_signals.py` before committing the updated dashboard data. Add
`GEMINI_API_KEY` as a GitHub Actions repository secret; Vercel environment
variables are not automatically available to GitHub Actions. The workflow
defaults to `gemma-4-26b-a4b-it`; optionally set the repository variable
`GEMINI_MODEL` to another model supported by the Gemini API key.

An existing `GEMINI_MODEL` variable overrides this default: update it to
`gemma-4-26b-a4b-it` or remove it when switching from Gemini Flash. The API key
does not change. Gemma requests ask for JSON in the prompt without assuming
native JSON-mode support; returned records still pass the same strict validation.

The local `scripts/capture/weekly_capture.sh` path runs the LinkedIn browser
collector, merges its output, then enriches new signals immediately when
`GEMINI_API_KEY` is set in that shell. Without the key, it leaves those
signals pending; pushing the refreshed feed lets the GitHub workflow enrich them
using the repository secret.

The default stage is `brief`: it gradually processes all feed signals without a
saved version-1 `ai_brief`, including signals with older full AI analysis. Each
brief contains a useful competitor-movement title and 1-3 evidence-only summary
sentences, plus model, timestamp, evidence scope, and source hash. Thin evidence
may produce fewer sentences. This stage does not classify signal type or product
focus and does not change priority, captured headlines, captured summaries, or
existing `ai_enrichment` records.

The dashboard prefers `ai_brief.title` and `ai_brief.summary` for its displayed
title and Evidence Preview, falling back to saved full analysis or captured text.
The original headline remains available in the briefing. Brief generation uses
the saved captured preview, not an automatic read of source URLs; its evidence
scope records that limitation.

Scheduled runs and local batches default to five signals; manual workflow runs
offer 1, 5, or 20. Every successful brief is immediately saved to both feed and
archive. Completed briefs are skipped on subsequent runs, and failures retain
`ai_brief_status: pending`. Classification remains a separate explicit
`--enrichment-stage classification` path with the existing confidence checks; it is not
invoked by the default workflow.

## Signal classification stage

The second stage is explicit and does not regenerate saved briefs. Trial one
signal without saving classifications:

```sh
python3 scripts/enrich_signals.py --test-signal browser-c4e4a3967528 --test-mode classification
```

To save a small classification batch with the configured `GEMINI_API_KEY`:

```sh
python3 scripts/enrich_signals.py --base-ref HEAD --enrichment-stage classification --max-signals 5
```

The response is stored as `ai_classification` in feed and archive. Type/focus
corrections are applied only at confidence 0.8 or higher, retaining the original
labels in that record; lower-confidence results remain suggestions. The prompt
distinguishes customer selections/contracts from implementations and marketing.
It uses captured evidence, not generated briefs, to avoid reinforcing earlier
AI claims. The legacy `--enrichment-stage full` path remains available separately.

AI technology is an independent flag, not a new message type. Feed rows display
`Feature change | AI`, for example, only when `is_ai_related` is true and
`ai_confidence` is at least 0.8. True flags must include a supporting quote found
in captured text. Automation or optimization alone is not sufficient evidence of
AI. This marker means the announcement concerns AI, not that AI assigned the label.
Completed version-1 classifications are skipped on later classification runs.

To save a small local batch using the configured key:

```sh
python3 scripts/enrich_signals.py --base-ref HEAD --max-signals 5
```

Unlike `--test-signal ... --test-mode brief`, this command writes feed and archive
updates. It never replaces the original captured evidence.

Competitive insight remains separate from the first-stage brief.
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

To backfill first-stage briefs, open **Actions → Refresh competitor signals →
Run workflow** and select the batch size. No backfill checkbox is needed for the
brief stage: each run continues through records without a saved brief. The
historical AI-schema checkbox applies only to the separate full-classification
CLI path and does not force regeneration of completed briefs.
Backfill makes model requests. Google lists Gemma 4 input and output as free,
but this does not mean unlimited usage. Check the selected model's actual RPM
and RPD limits in AI Studio. Google may use free-tier prompts to improve its
products. Review Google's current [pricing](https://ai.google.dev/gemini-api/docs/pricing)
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