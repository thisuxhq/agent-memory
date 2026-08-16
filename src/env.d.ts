interface Env {
  OPENROUTER_API_KEY: string;
  MEMORY_API_TOKEN: string;
  EXTRACT_QUEUE: Queue<ExtractJob>;
}

type ExtractJob = {
  namespace: string;
  profile: string;
};
