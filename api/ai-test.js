import { timingSafeEqual } from "node:crypto";

const DEEPSEEK_API = "https://api.deepseek.com";
const TEST_PROMPT = "Reply with exactly VERCEL_DEEPSEEK_OK and nothing else.";

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

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    const expectedToken = process.env.AI_TEST_TOKEN;
    if (!apiKey || !expectedToken) {
      return json({ error: "DeepSeek test endpoint is not configured." }, 503);
    }

    const authorization = request.headers.get("authorization") || "";
    const receivedToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!safeTokenMatch(receivedToken, expectedToken)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
    try {
      const response = await fetch(`${DEEPSEEK_API}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: TEST_PROMPT }],
          temperature: 0,
          max_tokens: 32,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = result.error?.message || `HTTP ${response.status}`;
        return json({ error: `DeepSeek returned ${response.status}: ${message}` }, 502);
      }

      const text = result.choices?.[0]?.message?.content?.trim();
      if (!text?.includes("VERCEL_DEEPSEEK_OK")) {
        return json({ error: "DeepSeek did not return the expected test response." }, 502);
      }

      return json({ ok: true, model, response: text });
    } catch {
      return json({ error: "Could not reach DeepSeek from the Vercel function." }, 502);
    }
  },
};
