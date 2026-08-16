interface Env {
  OPENROUTER_API_KEY: string;
  MEMORY_API_TOKEN: string;
  EXTRACT_QUEUE: Queue<ExtractJob>;
  AI: Ai;
  VECTORIZE: Vectorize;
}

type ExtractJob = {
  namespace: string;
  profile: string;
};
