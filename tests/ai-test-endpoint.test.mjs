import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import endpoint from "../api/ai-test.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalTestToken = process.env.AI_TEST_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
  if (originalTestToken === undefined) delete process.env.AI_TEST_TOKEN;
  else process.env.AI_TEST_TOKEN = originalTestToken;
});

function configureTestSecrets() {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.AI_TEST_TOKEN = "test-ai-token";
}

function request() {
  return new Request("https://example.test/api/ai-test", {
    method: "POST",
    headers: { Authorization: "Bearer test-ai-token" },
  });
}

test("Vercel smoke test calls LiquidAI only when catalog pricing is zero", async () => {
  configureTestSecrets();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/models")) {
      return Response.json({ data: [{ id: "liquid/lfm-2.5-2.6b", pricing: { prompt: "0", completion: "0" } }] });
    }
    return Response.json({ choices: [{ message: { content: "VERCEL_OPENROUTER_OK" } }] });
  };

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.model, "liquid/lfm-2.5-2.6b");
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).model, "liquid/lfm-2.5-2.6b");
});

test("Vercel smoke test refuses a nonzero-priced model before completion", async () => {
  configureTestSecrets();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({ data: [{ id: "liquid/lfm-2.5-2.6b", pricing: { prompt: "0.000001", completion: "0" } }] });
  };

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 402);
  assert.match(result.error, /not verified free/);
  assert.equal(calls.length, 1);
});
