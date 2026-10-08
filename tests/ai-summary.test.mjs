import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/ai-summary.js";
import signalsPayload from "../data/signals.json" with { type: "json" };

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const knownSignalId = signalsPayload.signals[0].id;
const secondSignalId = signalsPayload.signals[1].id;
const thirdSignalId = signalsPayload.signals[2].id;

function request(id, ip, method = "POST") {
  const url = new URL("https://dashboard.example/api/ai-summary");
  const headers = { "Content-Type": "application/json", "x-real-ip": ip };
  const options = { method, headers };
  if (method === "GET") url.searchParams.set("id", id);
  else options.body = JSON.stringify({ id });
  return new Request(url, options);
}

test("summarizes only a known signal after confirming zero catalog prices", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  let completionCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/models")) {
      return Response.json({ data: [{
        id: "nvidia/nemotron-3.5-lightning",
        pricing: { prompt: "0", completion: "0" },
      }] });
    }
    if (target.endsWith("/chat/completions") && options.method === "POST") {
      completionCalls += 1;
      return Response.json({ choices: [{ message: { content: "Summary: Test." } }] });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await handler.fetch(request(knownSignalId, "203.0.113.10", "GET"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary, "Summary: Test.");
    assert.equal(completionCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

test("does not call the model when catalog prices are missing", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  let completionCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{ id: "nvidia/nemotron-3.5-lightning", pricing: {} }] });
    }
    if (options.method === "POST") completionCalls += 1;
    throw new Error("Unexpected model request");
  };

  try {
    const response = await handler.fetch(request(secondSignalId, "203.0.113.11"));
    assert.equal(response.status, 402);
    assert.equal(completionCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

test("throttles repeated requests from one client IP", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  let dataCalls = 0;
  globalThis.fetch = async () => {
    dataCalls += 1;
    return Response.json({ data: [] });
  };

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await handler.fetch(request("unknown-signal", "203.0.113.12"));
      assert.equal(response.status, 404);
    }
    const limited = await handler.fetch(request("unknown-signal", "203.0.113.12"));
    assert.equal(limited.status, 429);
    assert.equal(dataCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

test("reports upstream free-model rate limits without exposing raw errors", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{
        id: "nvidia/nemotron-3.5-lightning",
        pricing: { prompt: "0", completion: "0" },
      }] });
    }
    if (String(url).endsWith("/chat/completions") && options.method === "POST") {
      return Response.json({ error: {
        code: 429,
        message: "Provider returned error",
        metadata: {
          provider_name: "NVIDIA Test Provider",
          raw: "upstream detail with sk-or-v1-sensitivevalue",
        },
      } }, {
        status: 429,
        headers: { "x-openrouter-request-id": "request-test-id", "retry-after": "30" },
      });
    }
    throw new Error("Unexpected request");
  };

  try {
    const response = await handler.fetch(request(thirdSignalId, "203.0.113.13", "GET"));
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.match(result.error, /Provider: NVIDIA Test Provider/);
    assert.match(result.error, /does not by itself confirm a Nemotron-specific cap/);
    assert.doesNotMatch(JSON.stringify(result), /test-key/);
    assert.doesNotMatch(JSON.stringify(result), /upstream detail|sensitivevalue/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});