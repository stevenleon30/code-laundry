/**
 * Fake credentials for evals and tests. They are assembled from fragments so the
 * repository never contains a literal that secret scanners (e.g. GitHub push
 * protection) flag. Case files reference them as __SECRET_<NAME>__.
 */
export const SYNTHETIC_SECRETS: Readonly<Record<string, string>> = {
  STRIPE: ["sk", "live", "51NzQ2bKjfP9aZ3mNc8vT4LwqEyR6uI0oP"].join("_"),
  SLACK: ["xoxb", "2847561930", "5839201746", "qW8eRtY2uIoP4aSdF6gHjK9l"].join("-"),
  AWS_KEY_ID: ["AKIA", "Z7QW3RTY5UIO2PLK"].join(""),
  AWS_SECRET: ["wJalrXUtnFEMIK7MDENG", "bPxRfiCYzK9q3nTb8LmA"].join(""),
  OPENAI: ["sk", "proj", "Xk29fLmQ8vRt3nWp7YbZc4Hd6Js1Ga0Ue5Ki2Lo9Pq8Rs7Tu"].join("-"),
  GITHUB: ["ghp", "R4nD0mT0k3nV4lu3F0rT3st1ngPurp0s3s12"].join("_"),
  ANTHROPIC: ["sk", "ant", "api03", "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"].join("-"),
};

/** Replace __SECRET_<NAME>__ placeholders with the synthetic values. */
export function materializeSecrets(code: string): string {
  return code.replace(/__SECRET_([A-Z_]+?)__/g, (m, name: string) => SYNTHETIC_SECRETS[name] ?? m);
}
