import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/ai-summary.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalVercelUrl = process.env.VERCEL_URL;

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
  process.env.VERCEL_URL = "test-deployment.vercel.app";
  let completionCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith("/data/signals.json")) {
      return Response.json({ signals: [{
        id: "signal-known",
        competitor: "Bytron Skybook",
        date: "2026-10-01",
        headline: "Skybook update",
        summary: "A verified test summary",
        sources: [{ title: "Official source", url: "https://example.com/source" }],
      }] });
    }
    if (target.endsWith("/models")) {
      return Response.json({ data: [{
        id: "inclusionai/ling-3.1-flash",
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
    const response = await handler.fetch(request("signal-known", "203.0.113.10", "GET"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary, "Summary: Test.");
    assert.equal(completionCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalVercelUrl;
  }
});

test("does not call the model when catalog prices are missing", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.VERCEL_URL = "test-deployment.vercel.app";
  let completionCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/data/signals.json")) {
      return Response.json({ signals: [{ id: "signal-no-price", headline: "Test" }] });
    }
    if (String(url).endsWith("/models")) {
      return Response.json({ data: [{ id: "inclusionai/ling-3.1-flash", pricing: {} }] });
    }
    if (options.method === "POST") completionCalls += 1;
    throw new Error("Unexpected model request");
  };

  try {
    const response = await handler.fetch(request("signal-no-price", "203.0.113.11"));
    assert.equal(response.status, 402);
    assert.equal(completionCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalVercelUrl;
  }
});

test("throttles repeated requests from one client IP", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.VERCEL_URL = "test-deployment.vercel.app";
  let dataCalls = 0;
  globalThis.fetch = async () => {
    dataCalls += 1;
    return Response.json({ signals: [] });
  };

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await handler.fetch(request("unknown-signal", "203.0.113.12"));
      assert.equal(response.status, 404);
    }
    const limited = await handler.fetch(request("unknown-signal", "203.0.113.12"));
    assert.equal(limited.status, 429);
    assert.equal(dataCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = originalVercelUrl;
  }
});