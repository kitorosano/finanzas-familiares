export function requiredEnv(
  name: string,
  errorMessage = `Missing required environment variable: ${name}`,
): string {
  const value = process.env[name];

  if (!value) throw new Error(errorMessage);

  return value;
}
