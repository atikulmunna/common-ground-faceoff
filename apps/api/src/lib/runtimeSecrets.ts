function requireSecret(name: "NEXTAUTH_SECRET" | "SMS_MFA_SECRET" | "OAUTH_EXCHANGE_SECRET"): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} must be configured with at least 32 characters`);
  }
  return value;
}

export function getJwtSecret(): string {
  return requireSecret("NEXTAUTH_SECRET");
}

export function getSmsMfaSecret(): string {
  return requireSecret("SMS_MFA_SECRET");
}

export function getOAuthExchangeSecret(): string {
  return requireSecret("OAUTH_EXCHANGE_SECRET");
}
