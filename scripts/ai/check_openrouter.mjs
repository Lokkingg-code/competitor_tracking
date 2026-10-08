const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set. Set it in your terminal, then retry.");
  process.exit(1);
}

const apiRoot = "https://openrouter.ai/api/v1";

async function openRouterRequest(path, options = {}) {
  const response = await fetch(`${apiRoot}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenRouter API returned ${response.status}: ${message}`);
  }
  return result;
}

try {
  const { data: models = [] } = await openRouterRequest("models");
  const getPrice = (value) => {
    if (typeof value !== "string" && typeof value !== "number") return Number.NaN;
    return Number(value);
  };
  const isFree = (model) =>
    getPrice(model.pricing?.prompt) === 0 && getPrice(model.pricing?.completion) === 0;
  const freeModels = models.filter(isFree);

  console.log("OpenRouter API key: accepted");
  console.log("Currently listed free models:");
  for (const model of freeModels) {
    console.log(`  ${model.id} (${model.name})`);
  }
  if (!freeModels.length) {
    throw new Error("OpenRouter returned no models with zero input and output prices.");
  }

  const selectedModel = process.env.OPENROUTER_MODEL;
  if (!selectedModel) {
    console.log("No prompt sent. Set OPENROUTER_MODEL to a listed free model ID to test a response.");
  } else {
    const model = models.find((candidate) => candidate.id === selectedModel);
    if (!model) {
      throw new Error("OPENROUTER_MODEL is not present in OpenRouter's current model catalog.");
    }
    if (!isFree(model)) {
      const promptPrice = getPrice(model.pricing?.prompt);
      const completionPrice = getPrice(model.pricing?.completion);
      const formatPrice = (price) => Number.isFinite(price)
        ? `$${(price * 1_000_000).toFixed(4)} per 1M tokens`
        : "unavailable";
      throw new Error(
        `${selectedModel} is not verified free (input ${formatPrice(promptPrice)}, output ${formatPrice(completionPrice)}). No model request was sent.`,
      );
    }

    const result = await openRouterRequest("chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: selectedModel,
        messages: [{ role: "user", content: "Reply with exactly OPENROUTER_CONNECTION_OK and nothing else." }],
        temperature: 0,
        max_tokens: 32,
      }),
    });
    const text = result.choices?.[0]?.message?.content?.trim();
    if (!text?.includes("OPENROUTER_CONNECTION_OK")) {
      throw new Error("The model did not return the expected connection-test response.");
    }
    console.log(`Model response: ${text}`);
    console.log("OpenRouter connection: OK. No dashboard data was sent or modified.");
  }
} catch (error) {
  const causeCode = error instanceof Error && "cause" in error
    ? error.cause?.code
    : undefined;
  if (causeCode) {
    console.error(`Network request failed (${causeCode}); no OpenRouter response was received. Check network access and retry.`);
  } else {
    console.error(error instanceof Error ? error.message : "OpenRouter connection failed.");
  }
  process.exitCode = 1;
}