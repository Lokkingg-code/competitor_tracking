import { timingSafeEqual } from "node:crypto";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const TEST_PROMPT = "Reply with exactly VERCEL_GEMINI_OK and nothing else.";

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

    const apiKey = process.env.GEMINI_API_KEY;
    const expectedToken = process.env.AI_TEST_TOKEN;
    if (!apiKey || !expectedToken) {
      return json({ error: "Gemini test endpoint is not configured." }, 503);
    }

    const authorization = request.headers.get("authorization") || "";
    const receivedToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!safeTokenMatch(receivedToken, expectedToken)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const model = process.env.GEMINI_MODEL?.trim() || "gemma-4-26b-a4b-it";
    try {
      const response = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: TEST_PROMPT }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 32 },
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = result.error?.message || `HTTP ${response.status}`;
        return json({ error: `Gemini returned ${response.status}: ${message}` }, 502);
      }

      const text = (result.candidates?.[0]?.content?.parts || [])
        .filter((part) => !part.thought)
        .map((part) => part.text || "")
        .join("")
        .trim();
      if (text !== "VERCEL_GEMINI_OK") {
        return json({ error: "Gemini did not return the expected test response." }, 502);
      }

      return json({ ok: true, model, response: text });
    } catch {
      return json({ error: "Could not reach Gemini from the Vercel function." }, 502);
    }
  },
};
