process.env.NEXTAUTH_SECRET ??= "test-nextauth-secret-at-least-32-characters";
process.env.SMS_MFA_SECRET ??= "test-sms-mfa-secret-at-least-32-characters";
process.env.OAUTH_EXCHANGE_SECRET ??= "test-oauth-exchange-secret-at-least-32-characters";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/common_ground_test";
