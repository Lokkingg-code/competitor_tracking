import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotClient } from "@github/copilot-sdk";

const workingDirectory = await mkdtemp(join(tmpdir(), "competitor-ai-check-"));
const client = new CopilotClient({
  mode: "copilot-cli",
  baseDirectory: process.env.COPILOT_HOME || join(homedir(), ".copilot"),
  workingDirectory,
  logLevel: "error",
});
let session;
const deadline = setTimeout(async () => {
  console.error("Copilot connection check timed out after 90 seconds.");
  try {
    await client.forceStop();
  } finally {
    process.exit(1);
  }
}, 90_000);

try {
  await client.start();
  const auth = await client.getAuthStatus();
  if (!auth.isAuthenticated) {
    throw new Error("Not authenticated. Run copilot login in your terminal, then retry.");
  }
  console.log("Copilot authentication: OK");

  const models = await client.listModels();
  console.log("Available models:");
  for (const model of models) {
    console.log(`  ${model.id} (${model.name})`);
  }

  const model = process.env.COPILOT_MODEL;
  if (!model) {
    console.log("No prompt sent. Set COPILOT_MODEL to a company-approved model ID to test a reply.");
  } else {
    if (!models.some((candidate) => candidate.id === model)) {
      throw new Error("COPILOT_MODEL is not in the available model list.");
    }
    session = await client.createSession({
      model,
      availableTools: [],
      onPermissionRequest: () => ({ kind: "reject" }),
      enableOnDemandInstructionDiscovery: false,
      enableFileHooks: false,
      enableHostGitOperations: false,
      enableSessionTelemetry: false,
      enableSkills: false,
      enableSessionStore: false,
      infiniteSessions: { enabled: false },
      memory: { enabled: false },
      systemMessage: {
        mode: "append",
        content: "This is a synthetic connectivity check. Do not use tools or access files.",
      },
    });
    console.log(`Testing model: ${model}`);
    const response = await session.sendAndWait({
      prompt: "Reply with exactly COPILOT_CONNECTION_OK and nothing else.",
    }, 60_000);
    const content = response?.data.content?.trim();
    if (content !== "COPILOT_CONNECTION_OK") {
      throw new Error("The model did not return the expected connection-test response.");
    }
    console.log(`Model response: ${content}`);
    console.log("AI connection: OK. No dashboard data was sent or modified.");
  }
} catch (error) {
  if (error instanceof Error && /^(Not authenticated\.|COPILOT_MODEL |The model did not)/.test(error.message)) {
    console.error(error.message);
  } else {
    const message = error instanceof Error ? error.message : "";
    if (/not authorized to use this Copilot feature|\b403\b/.test(message)) {
      console.error("Copilot login succeeded, but GitHub denied feature access (403 Forbidden).");
      console.error("Check that the signed-in account has the company Copilot seat and that CLI/SDK use is permitted.");
    } else {
      console.error("Copilot connection failed. Check CLI login, company SDK/CLI policy, and network access.");
    }
  }
  process.exitCode = 1;
} finally {
  try {
    if (session) await session.disconnect();
  } finally {
    const errors = await client.stop();
    if (errors.length) {
      console.error("Copilot runtime cleanup failed.");
      process.exitCode = 1;
    }
    await rm(workingDirectory, { recursive: true, force: true });
    clearTimeout(deadline);
  }
}