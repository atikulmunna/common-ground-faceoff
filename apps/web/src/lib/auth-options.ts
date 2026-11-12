import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import GitHubProvider from "next-auth/providers/github";
import { getServerApiBaseUrl } from "./api-base";
import { encodeMfaChallenge } from "./mfa-challenge";

type ApiSignInData = {
  user: { id: string; email: string; displayName: string; role: string };
  accessToken: string;
  refreshToken: string;
};

function toSessionUser(data: ApiSignInData) {
  return {
    id: data.user.id,
    email: data.user.email,
    name: data.user.displayName,
    role: data.user.role,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        action: { label: "Action", type: "text" },
        displayName: { label: "Display Name", type: "text" },
        mfaTicket: { label: "MFA ticket", type: "text" },
        mfaCode: { label: "Verification code", type: "text" },
        mfaType: { label: "MFA type", type: "text" }
      },
      async authorize(credentials) {
        // Second step: exchange the ticket from the password step plus the user's code for tokens.
        if (credentials?.mfaTicket && credentials.mfaCode) {
          const res = await fetch(`${getServerApiBaseUrl()}/mfa/verify-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mfaTicket: credentials.mfaTicket,
              token: credentials.mfaCode,
              mfaType: credentials.mfaType === "sms" ? "sms" : "totp"
            })
          });
          const json = await res.json();
          if (!res.ok || !json.success) {
            throw new Error(json.error?.message ?? "Verification failed");
          }
          return toSessionUser(json.data);
        }

        if (!credentials?.email || !credentials?.password) return null;

        const isRegister = credentials.action === "register";
        const endpoint = isRegister ? "/auth/register" : "/auth/login";
        const body = isRegister
          ? { email: credentials.email, password: credentials.password, displayName: credentials.displayName || credentials.email.split("@")[0] }
          : { email: credentials.email, password: credentials.password };

        const res = await fetch(`${getServerApiBaseUrl()}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message ?? "Authentication failed");
        }
        if (isRegister) {
          throw new Error(json.data?.message ?? "Registration successful. Please verify your email.");
        }
        if (json.data?.mfaRequired) {
          throw new Error(encodeMfaChallenge({ mfaType: json.data.mfaType, mfaTicket: json.data.mfaTicket }));
        }

        return toSessionUser(json.data);
      }
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
          })
        ]
      : []),
    ...(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET && process.env.AZURE_AD_TENANT_ID
      ? [
          AzureADProvider({
            clientId: process.env.AZURE_AD_CLIENT_ID,
            clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
            tenantId: process.env.AZURE_AD_TENANT_ID
          })
        ]
      : []),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET
          })
        ]
      : [])
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 60 // CG-FR07: 30 minutes
  },
  pages: {
    signIn: "/sign-in"
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google" || account?.provider === "azure-ad" || account?.provider === "github") {
          // Exchange OAuth profile for API tokens
          const providerName = account.provider === "azure-ad" ? "microsoft" : account.provider;
          const oauthExchangeSecret = process.env.OAUTH_EXCHANGE_SECRET;
          if (!oauthExchangeSecret) {
            throw new Error("OAUTH_EXCHANGE_SECRET is not configured");
          }
          const res = await fetch(`${getServerApiBaseUrl()}/auth/oauth-exchange`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Common-Ground-Internal-Secret": oauthExchangeSecret
            },
            body: JSON.stringify({
              email: user.email,
              displayName: user.name ?? user.email?.split("@")[0] ?? "User",
              provider: providerName
            })
          });
          const json = await res.json();
          if (res.ok && json.success) {
            token.id = json.data.user.id;
            token.role = json.data.user.role;
            token.accessToken = json.data.accessToken;
            token.refreshToken = json.data.refreshToken;
            token.accessTokenExpires = Date.now() + 25 * 60 * 1000; // refresh 5 min before expiry
          }
        } else {
          // Credentials provider — user already has API tokens
          token.id = user.id;
          token.role = (user as unknown as { role: string }).role;
          token.accessToken = (user as unknown as { accessToken: string }).accessToken;
          token.refreshToken = (user as unknown as { refreshToken: string }).refreshToken;
          token.accessTokenExpires = Date.now() + 25 * 60 * 1000;
        }
      }

      // Refresh the API access token if it's about to expire
      if (token.accessTokenExpires && Date.now() > (token.accessTokenExpires as number) && token.refreshToken) {
        try {
          const res = await fetch(`${getServerApiBaseUrl()}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: token.refreshToken })
          });
          const json = await res.json();
          if (res.ok && json.success) {
            token.accessToken = json.data.accessToken;
            token.refreshToken = json.data.refreshToken ?? token.refreshToken;
            token.accessTokenExpires = Date.now() + 25 * 60 * 1000;
          }
        } catch {
          // refresh failed — token will expire and user must re-login
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.accessToken = token.accessToken;
      }
      return session;
    }
  }
};
