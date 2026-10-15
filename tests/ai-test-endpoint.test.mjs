import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import endpoint from "../api/ai-test.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.GEMINI_API_KEY;
const originalTestToken = process.env.AI_TEST_TOKEN;
const originalModel = process.env.GEMINI_MODEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
  if (originalTestToken === undefined) delete process.env.AI_TEST_TOKEN;
  else process.env.AI_TEST_TOKEN = originalTestToken;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalModel;
});

function configureTestSecrets() {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.AI_TEST_TOKEN = "test-ai-token";
  process.env.GEMINI_MODEL = "gemini-test-model";
}

function request() {
  return new Request("https://example.test/api/ai-test", {
    method: "POST",
    headers: { Authorization: "Bearer test-ai-token" },
  });
}

test("Vercel smoke test calls Gemini with the configured model", async () => {
  configureTestSecrets();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ candidates: [{ content: { parts: [{ text: "VERCEL_GEMINI_OK" }] } }] });
  };

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.model, "gemini-test-model");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
  assert.equal(calls[0].options.headers["x-goog-api-key"], "test-gemini-key");
});

test("Vercel smoke test defaults to Gemma 4", async () => {
  configureTestSecrets();
  delete process.env.GEMINI_MODEL;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return Response.json({ candidates: [{ content: { parts: [{ text: "VERCEL_GEMINI_OK" }] } }] });
  };

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.model, "gemma-4-26b-a4b-it");
  assert.match(requestedUrl, /models\/gemma-4-26b-a4b-it:generateContent$/);
});

test("Vercel smoke test reports Gemini API errors", async () => {
  configureTestSecrets();
  globalThis.fetch = async () => Response.json(
    { error: { message: "API key not valid" } },
    { status: 400 },
  );

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 502);
  assert.match(result.error, /Gemini returned 400: API key not valid/);
});
