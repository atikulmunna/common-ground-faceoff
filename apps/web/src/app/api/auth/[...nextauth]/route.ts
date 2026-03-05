import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        action: { label: "Action", type: "text" },
        displayName: { label: "Display Name", type: "text" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const isRegister = credentials.action === "register";
        const endpoint = isRegister ? "/auth/register" : "/auth/login";
        const body = isRegister
          ? { email: credentials.email, password: credentials.password, displayName: credentials.displayName || credentials.email.split("@")[0] }
          : { email: credentials.email, password: credentials.password };

        const res = await fetch(`${API_BASE}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error?.message ?? "Authentication failed");
        }

        return {
          id: json.data.user.id,
          email: json.data.user.email,
          name: json.data.user.displayName,
          role: json.data.user.role,
          accessToken: json.data.accessToken,
          refreshToken: json.data.refreshToken
        };
      }
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role: string }).role;
        token.accessToken = (user as unknown as { accessToken: string }).accessToken;
        token.refreshToken = (user as unknown as { refreshToken: string }).refreshToken;
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

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
