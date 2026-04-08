"use client";

import { useEffect } from "react";
import { signOut, signIn } from "@/lib/auth-client";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

const GithubAuthExpired = () => {
  useEffect(() => {
    let cancelled = false;

    const reauth = async () => {
      // Sign out to clear the stale session completely
      try {
        await signOut({ fetchOptions: { onSuccess: () => {} } });
      } catch {
        // Ignore signout errors — the session may already be invalid
      }

      if (cancelled) return;

      // Immediately start a fresh GitHub OAuth flow — don't just go to /sign-in
      // where the user would have to click "Continue with GitHub" again
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const callbackURL = returnTo && returnTo !== "/sign-in" ? returnTo : "/";

      try {
        const result = await signIn.social({
          provider: "github",
          callbackURL,
          errorCallbackURL: `/sign-in?redirect=${encodeURIComponent(callbackURL)}`,
          disableRedirect: true,
        });

        if (!cancelled && result.data?.url) {
          window.location.assign(result.data.url);
          return;
        }
      } catch {
        // If OAuth initiation fails, fall back to sign-in page
      }

      if (!cancelled) {
        const signInUrl = `/sign-in?redirect=${encodeURIComponent(callbackURL)}`;
        window.location.assign(signInUrl);
      }
    };

    reauth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Empty className="absolute inset-0 border-0 rounded-none">
      <EmptyHeader>
        <EmptyTitle>Reconnecting to GitHub...</EmptyTitle>
        <EmptyDescription>Your GitHub session expired. Redirecting you to sign in again.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

export { GithubAuthExpired };
