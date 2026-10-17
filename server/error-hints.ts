/**
 * server/error-hints.ts
 *
 * Universal "what's wrong + how to fix it" mapping for AI provider errors.
 * Every failure surface (generate prevalidation, key save, model fetch,
 * connection test, FAILED logs) funnels through actionable() so the dashboard
 * always tells the user exactly what went wrong AND what to do next.
 */

export interface ActionableError {
  /** the raw problem, with the provider's own detail */
  message: string;
  /** the exact remediation step (may be "" when nothing known applies) */
  fix: string;
}

/** Where each provider's API keys are created. */
const KEY_URLS: Record<string, string> = {
  ollama: "ollama.com/settings/keys",
  openai: "platform.openai.com/api-keys",
  anthropic: "console.anthropic.com/settings/keys",
  google: "aistudio.google.com/apikey",
  openrouter: "openrouter.ai/settings/keys",
  gateway: "vercel.com dashboard → AI Gateway API Keys",
};

export function keyUrlFor(provider: string | undefined): string {
  return (provider && KEY_URLS[provider]) || "your provider's console";
}

export function actionable(raw: string, provider?: string): ActionableError {
  const text = raw.slice(0, 400);
  const url = keyUrlFor(provider);

  if (/401|unauthorized|invalid\s?api\s?key|missing bearer|invalid x-api-key|api key not valid|invalid api key|requires an ollama account|sign in to ollama|not signed in/i.test(text)) {
    return {
      message: text,
      fix: `API key is missing or wrong — create a fresh key at ${url}, Save it in the Providers tab, then click Test`,
    };
  }
  if (/429|insufficient_quota|quota|billing|credit|rate\s?limit/i.test(text)) {
    return {
      message: text,
      fix: `Account limit hit — top up credit/quota at ${url}, or switch to another provider/model`,
    };
  }
  if (/403/i.test(text)) {
    return {
      message: text,
      fix: `Access denied — check your plan/permissions at ${url}`,
    };
  }
  if (/econnrefused|econnreset|econnaborted|fetch failed|network error/i.test(text)) {
    if (text.includes("11434")) {
      return {
        message: text,
        fix: "Local Ollama isn't running — start it with `ollama serve`, or switch the provider to Ollama Cloud (baseUrl https://ollama.com/v1 + API key)",
      };
    }
    return {
      message: text,
      fix: "Provider endpoint unreachable — check the baseUrl in ai.config.json and your internet connection",
    };
  }
  if (/timeout|aborterror|aborted/i.test(text)) {
    return {
      message: text,
      fix: "Provider didn't respond in time — try again, or pick a smaller/faster model",
    };
  }
  if (/model/i.test(text) && /not found|unknown|does not exist|invalid model|no endpoints|not in provider list/i.test(text)) {
    return {
      message: text,
      fix: "This model isn't served by the provider — click 'Fetch models' and pick one from the real list",
    };
  }
  if (/did not match schema|no object generated|schema violations|failed after \d+ attempts/i.test(text)) {
    return {
      message: text,
      fix: "This model can't reliably emit strict schema JSON — pick a bigger reasoning model from 'Fetch models' (e.g. a non-flash / larger-parameter model), or switch provider",
    };
  }
  return { message: text, fix: "" };
}