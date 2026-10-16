const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("GEMINI_API_KEY is not set. Set it in your terminal, then retry.");
  process.exit(1);
}

const apiRoot = "https://generativelanguage.googleapis.com/v1beta";

async function geminiRequest(path, options = {}) {
  const response = await fetch(`${apiRoot}/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API returned ${response.status}: ${message}`);
  }
  return result;
}

try {
  const { models = [] } = await geminiRequest("models");
  const availableModels = models.filter((model) =>
    model.supportedGenerationMethods?.includes("generateContent"),
  );

  console.log("Gemini API key: accepted");
  console.log("Models supporting text generation:");
  for (const model of availableModels) {
    console.log(`  ${model.name.replace(/^models\//, "")} (${model.displayName})`);
  }

  const selectedModel = process.env.GEMINI_MODEL;
  if (!selectedModel) {
    console.log("No prompt sent. Set GEMINI_MODEL to an available model ID to test a response.");
  } else {
    const model = selectedModel.replace(/^models\//, "");
    if (!availableModels.some((candidate) => candidate.name === `models/${model}`)) {
      throw new Error("GEMINI_MODEL is not in the available text-generation model list.");
    }

    const result = await geminiRequest(`models/${model}:generateContent`, {
      method: "POST",
      body: JSON.stringify({
        contents: [{
          parts: [{ text: "Reply with exactly GEMINI_CONNECTION_OK and nothing else." }],
        }],
        generationConfig: { maxOutputTokens: 512 },
      }),
    });
    const text = result.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (text !== "GEMINI_CONNECTION_OK") {
      const finishReason = result.candidates?.[0]?.finishReason || "missing";
      throw new Error(`Gemini did not return the exact connection-test response (finish_reason=${finishReason}).`);
    }
    console.log(`Model response: ${text}`);
    console.log("Gemini connection: OK. No dashboard data was sent or modified.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Gemini connection failed.");
  process.exitCode = 1;
}