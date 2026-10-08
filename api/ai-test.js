import { timingSafeEqual } from "node:crypto";

const MODEL_ID = "nvidia/nemotron-3.5-lightning";
const OPENROUTER_API = "https://openrouter.ai/api/v1";
const TEST_PROMPT = "Reply with exactly VERCEL_OPENROUTER_OK and nothing else.";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeTokenMatch(received, expected) {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes);
}

function parsePrice(value) {
  if (typeof value !== "string" && typeof value !== "number") return Number.NaN;
  return Number(value);
}

async function openRouterFetch(path, apiKey, options = {}) {
  return fetch(`${OPENROUTER_API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(25_000),
  });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const expectedToken = process.env.AI_TEST_TOKEN;
    if (!apiKey || !expectedToken) {
      return json({ error: "AI test endpoint is not configured." }, 503);
    }

    const authorization = request.headers.get("authorization") || "";
    const receivedToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!safeTokenMatch(receivedToken, expectedToken)) {
      return json({ error: "Unauthorized." }, 401);
    }

    try {
      const catalogResponse = await openRouterFetch("models", apiKey);
      if (!catalogResponse.ok) {
        return json({ error: "Could not check OpenRouter model pricing." }, 502);
      }
      const catalog = await catalogResponse.json();
      const model = catalog.data?.find((entry) => entry.id === MODEL_ID);
      if (!model) {
        return json({ error: "Nemotron 3.5 Lightning is not in the current OpenRouter catalog." }, 404);
      }

      const inputPrice = parsePrice(model.pricing?.prompt);
      const outputPrice = parsePrice(model.pricing?.completion);
      if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)
        || inputPrice !== 0 || outputPrice !== 0) {
        return json({
          error: "Nemotron 3.5 Lightning is not verified as free; no model request was sent.",
        }, 402);
      }

      const completionResponse = await openRouterFetch("chat/completions", apiKey, {
        method: "POST",
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [{ role: "user", content: TEST_PROMPT }],
          temperature: 0,
          max_tokens: 32,
        }),
      });
      if (!completionResponse.ok) {
        return json({ error: "OpenRouter could not complete the synthetic test." }, 502);
      }

      const completion = await completionResponse.json();
      const text = completion.choices?.[0]?.message?.content?.trim();
      if (!text?.includes("VERCEL_OPENROUTER_OK")) {
        return json({ error: "The model did not return the expected test response." }, 502);
      }

      return json({ ok: true, model: MODEL_ID, response: text });
    } catch {
      return json({ error: "Could not reach OpenRouter from the Vercel function." }, 502);
    }
  },
};