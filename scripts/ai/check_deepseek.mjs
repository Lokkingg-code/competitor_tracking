const apiKey = process.env.DEEPSEEK_API_KEY;

if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is not set. Set it in your terminal, then retry.");
  process.exit(1);
}

const apiRoot = (process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

try {
  const response = await fetch(`${apiRoot}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with exactly DEEPSEEK_CONNECTION_OK and nothing else." }],
      temperature: 0,
      max_tokens: 32,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.message || `HTTP ${response.status}`);
  }
  const text = result.choices?.[0]?.message?.content?.trim();
  if (!text?.includes("DEEPSEEK_CONNECTION_OK")) {
    throw new Error("The model did not return the expected connection-test response.");
  }

  console.log(`DeepSeek API: OK (${model})`);
  console.log(`Model response: ${text}`);
  console.log("Only the synthetic connection-test prompt was sent.");
} catch (error) {
  const causeCode = error instanceof Error && "cause" in error
    ? error.cause?.code
    : undefined;
  if (causeCode) {
    console.error(`Network request failed (${causeCode}); no DeepSeek response was received.`);
  } else {
    console.error(error instanceof Error ? error.message : "DeepSeek connection failed.");
  }
  process.exitCode = 1;
}
