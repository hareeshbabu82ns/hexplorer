"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// same-origin: no baseURL needed, so the app works from any host name / IP
export const authClient = createAuthClient({
  plugins: [usernameClient(), passkeyClient(), twoFactorClient()],
});

export const { useSession, signOut } = authClient;
