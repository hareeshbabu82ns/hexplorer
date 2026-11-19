import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { twoFactor, username } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { MongoClient } from "mongodb";
import { getDbSync } from "@/lib/db";

/**
 * Single-user auth: one account (username + password) created on first visit,
 * plus passkeys. Further sign ups are refused by the user.create hook below.
 *
 * BETTER_AUTH_URL must be the URL you open the app with (passkeys are bound to
 * its host name). Extra origins (LAN IP, other host names) go in
 * BETTER_AUTH_TRUSTED_ORIGINS, comma separated.
 */
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3000";
const rpID = process.env.PASSKEY_RP_ID || new URL(baseURL).hostname;
const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// DATABASE_URL is missing while `next build` collects routes: give the adapter an
// unconnected placeholder (the driver only connects on first query)
const db = process.env.DATABASE_URL
  ? getDbSync()
  : new MongoClient("mongodb://127.0.0.1:27017/hexplorer").db();

export const USER_COLLECTION = "user";

export const auth = betterAuth({
  appName: "HExplorer",
  baseURL,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET || process.env.APP_SECRET,
  database: mongodbAdapter(db, { transaction: false }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const count = await db.collection(USER_COLLECTION).countDocuments({}, { limit: 1 });
          if (count > 0)
            throw new APIError("FORBIDDEN", {
              message: "This is a single-user app and the account already exists",
            });
          return { data: user };
        },
      },
    },
  },
  plugins: [
    username({ minUsernameLength: 3, maxUsernameLength: 32 }),
    passkey({ rpID, rpName: "HExplorer", origin: [new URL(baseURL).origin, ...trustedOrigins] }),
    // TOTP (authenticator app) + one-time backup codes, asked after password sign in.
    // Passkey sign in skips it: a passkey is already two factors.
    twoFactor({ issuer: "HExplorer", trustDeviceMaxAge: 30 * 24 * 60 * 60 }),
    nextCookies(), // must stay last
  ],
});

/** true until the one account has been created */
export async function needsSetup() {
  const count = await db.collection(USER_COLLECTION).countDocuments({}, { limit: 1 });
  return count === 0;
}

export type Session = typeof auth.$Infer.Session;
