/**
 * Refresh an expired GitHub OAuth user token using the refresh token.
 *
 * GitHub App user-to-server tokens expire after 8 hours when
 * "Expire user authorization tokens" is enabled. The refresh token
 * lasts 6 months and can be exchanged for a new access token without
 * user interaction.
 */

import { db } from "@/db";
import { accountTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { decryptOAuthToken, encryptOAuthToken } from "@/lib/decrypt-oauth-token";

const refreshInFlight = new Map<string, Promise<string | null>>();

export async function refreshGithubToken(userId: string): Promise<string | null> {
  // Dedup concurrent refreshes for the same user
  const existing = refreshInFlight.get(userId);
  if (existing) return existing;

  const job = doRefresh(userId);
  refreshInFlight.set(userId, job);
  try {
    return await job;
  } finally {
    refreshInFlight.delete(userId);
  }
}

async function doRefresh(userId: string): Promise<string | null> {
  const account = await db.query.accountTable.findFirst({
    where: and(
      eq(accountTable.userId, userId),
      eq(accountTable.providerId, "github"),
    ),
  });

  if (!account?.refreshToken) {
    return null;
  }

  // Decrypt the stored refresh token (better-auth encrypts with encryptOAuthTokens)
  const refreshToken = await decryptOAuthToken(account.refreshToken);
  if (!refreshToken) return null;

  // Check if refresh token is expired
  if (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt.getTime() < Date.now()) {
    console.log("[auth] refresh token expired, cannot refresh silently");
    return null;
  }

  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.error || !data.access_token) {
      console.error("GitHub token refresh failed:", data.error || "no access_token");
      return null;
    }

    // Encrypt the new tokens before storing (matching better-auth's scheme)
    const updates: Record<string, any> = {
      accessToken: await encryptOAuthToken(data.access_token as string),
      updatedAt: new Date(),
    };

    if (data.refresh_token) {
      updates.refreshToken = await encryptOAuthToken(data.refresh_token as string);
    }

    if (data.expires_in) {
      updates.accessTokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);
    }

    if (data.refresh_token_expires_in) {
      updates.refreshTokenExpiresAt = new Date(Date.now() + data.refresh_token_expires_in * 1000);
    }

    await db.update(accountTable)
      .set(updates)
      .where(eq(accountTable.id, account.id));

    return data.access_token;
  } catch (error) {
    console.error("GitHub token refresh error:", error);
    return null;
  }
}
