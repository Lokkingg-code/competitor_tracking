import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import endpoint from "../api/ai-test.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.DEEPSEEK_API_KEY;
const originalTestToken = process.env.AI_TEST_TOKEN;
const originalModel = process.env.DEEPSEEK_MODEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalApiKey;
  if (originalTestToken === undefined) delete process.env.AI_TEST_TOKEN;
  else process.env.AI_TEST_TOKEN = originalTestToken;
  if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL;
  else process.env.DEEPSEEK_MODEL = originalModel;
});

function configureTestSecrets() {
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  process.env.AI_TEST_TOKEN = "test-ai-token";
  process.env.DEEPSEEK_MODEL = "deepseek-test-model";
}

function request() {
  return new Request("https://example.test/api/ai-test", {
    method: "POST",
    headers: { Authorization: "Bearer test-ai-token" },
  });
}

test("Vercel smoke test calls DeepSeek with the configured model", async () => {
  configureTestSecrets();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ choices: [{ message: { content: "VERCEL_DEEPSEEK_OK" } }] });
  };

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.model, "deepseek-test-model");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-deepseek-key");
  assert.equal(JSON.parse(calls[0].options.body).model, "deepseek-test-model");
});

test("Vercel smoke test defaults to deepseek-chat", async () => {
  configureTestSecrets();
  delete process.env.DEEPSEEK_MODEL;
  let requestedModel;
  globalThis.fetch = async (_url, options) => {
    requestedModel = JSON.parse(options.body).model;
    return Response.json({ choices: [{ message: { content: "VERCEL_DEEPSEEK_OK" } }] });
  };

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.model, "deepseek-chat");
  assert.equal(requestedModel, "deepseek-chat");
});

test("Vercel smoke test reports DeepSeek API errors", async () => {
  configureTestSecrets();
  globalThis.fetch = async () => Response.json(
    { error: { message: "Insufficient balance" } },
    { status: 402 },
  );

  const response = await endpoint.fetch(request());
  const result = await response.json();

  assert.equal(response.status, 502);
  assert.match(result.error, /DeepSeek returned 402: Insufficient balance/);
});
