import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            MEMORY_API_TOKEN: "test-token",
            OPENROUTER_API_KEY: "test-openrouter-key",
            OPENROUTER_MODEL: "openai/gpt-5.6-luna",
          },
        },
      },
    },
  },
});
