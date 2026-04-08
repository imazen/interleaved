import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountTable, userTable } from "@/db/schema";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { refreshGithubToken } from "@/lib/github-token-refresh";
import { decryptOAuthToken } from "@/lib/decrypt-oauth-token";

// Read the linked GitHub OAuth account for a user (decrypts token).
const getGithubAccount = cache(async (userId: string) => {
  const account = await db.query.accountTable.findFirst({
    where: and(
      eq(accountTable.userId, userId),
      eq(accountTable.providerId, "github")
    )
  });
  if (!account) return null;

  // Decrypt access token — better-auth encrypts it with encryptOAuthTokens
  const decryptedToken = await decryptOAuthToken(account.accessToken);

  return {
    ...account,
    accessToken: decryptedToken,
  };
});

const getGithubId = cache(async (userId: string): Promise<number | null> => {
  const account = await getGithubAccount(userId);
  if (!account?.accountId) return null;

  const githubId = Number(account.accountId);
  return Number.isInteger(githubId) ? githubId : null;
});

// Refresh GitHub-derived profile fields after login without overwriting custom names.
const syncGithubProfileOnLogin = async (userId: string) => {
  try {
    const [user, githubAccount] = await Promise.all([
      db.query.userTable.findFirst({
        where: eq(userTable.id, userId),
      }),
      getGithubAccount(userId),
    ]);

    if (!user || !githubAccount?.accessToken) return;

    // Try stored token first, refresh if it fails
    let token = githubAccount.accessToken;
    let octokit = createOctokitInstance(token);
    let profile;

    try {
      const result = await octokit.rest.users.getAuthenticated();
      profile = result.data;
    } catch {
      // Token expired — try refresh
      const refreshed = await refreshGithubToken(userId);
      if (!refreshed) return; // Can't refresh, skip sync silently
      token = refreshed;
      octokit = createOctokitInstance(token);
      try {
        const result = await octokit.rest.users.getAuthenticated();
        profile = result.data;
      } catch {
        return; // Still failing, skip sync silently
      }
    }

    if (!profile) return;

  const nextGithubUsername = profile.login ?? null;
  const nextImage = profile.avatar_url ?? null;
  const nextName = profile.name ?? profile.login ?? user.name;

  const patch: Partial<typeof userTable.$inferInsert> = {};

  if (user.githubUsername !== nextGithubUsername) {
    patch.githubUsername = nextGithubUsername;
  }

  if ((user.image ?? null) !== nextImage) {
    patch.image = nextImage;
  }

  // Preserve custom display names; only refresh names that still mirror GitHub identity.
  if (user.name.trim() === "" || user.name === user.githubUsername) {
    if (user.name !== nextName) {
      patch.name = nextName;
    }
  }

  if (Object.keys(patch).length === 0) return;

    await db
      .update(userTable)
      .set({
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, userId));
  } catch (error) {
    // Never let profile sync crash the login flow
    console.error("[auth] github profile sync failed", { userId, error: (error as Error).message });
  }
};

export { getGithubAccount, getGithubId, syncGithubProfileOnLogin };
