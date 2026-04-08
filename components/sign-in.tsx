"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader } from "lucide-react";

export function SignIn() {
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [submittingMethod, setSubmittingMethod] = useState<
    "github" | "email" | null
  >(null);
  const isSubmitting = submittingMethod !== null;

  const searchParams = useSearchParams();
  const error = searchParams.get("error") || "";
  const redirectParam = searchParams.get("redirect") || "";
  const callbackURL = (redirectParam.startsWith("/") && !redirectParam.startsWith("//")) ? redirectParam : "/";
  const errorCallbackURL =
    callbackURL === "/"
      ? "/sign-in"
      : `/sign-in?redirect=${encodeURIComponent(callbackURL)}`;

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    const email = searchParams.get("email");
    if (email && emailInputRef.current) emailInputRef.current.value = email;
  }, [searchParams]);

  const getNameFromEmail = (email: string) => {
    const localPart = email.split("@")[0]?.trim();
    return localPart || email;
  };

  const handleGithubSignIn = async () => {
    setSubmittingMethod("github");
    try {
      const result = await signIn.social({
        provider: "github",
        callbackURL,
        errorCallbackURL,
        disableRedirect: true,
      });
      if (result.error?.message) {
        toast.error(result.error.message);
        setSubmittingMethod(null);
        return;
      }

      if (result.data?.url) {
        window.location.assign(result.data.url);
        return;
      }

      setSubmittingMethod(null);
      toast.error("Could not start GitHub sign-in. Please try again.");
    } catch (error: any) {
      toast.error(error?.message || "Could not start GitHub sign-in.");
      setSubmittingMethod(null);
    }
  };

  const handleEmailSignIn = async (formData: FormData) => {
    const emailValue = formData.get("email");
    if (typeof emailValue !== "string" || !emailValue) {
      toast.error("Invalid email");
      return;
    }

    setSubmittingMethod("email");
    try {
      const result = await signIn.magicLink({
        email: emailValue,
        name: getNameFromEmail(emailValue),
        callbackURL,
        errorCallbackURL,
      });

      if (result.error?.message) {
        toast.error(result.error.message);
        return;
      }

      toast.success(
        "Check your email for a sign-in link.",
        { duration: 10000 },
      );
      if (emailInputRef.current) emailInputRef.current.value = "";
    } finally {
      setSubmittingMethod(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-[340px] space-y-8">
        {/* Logo + tagline */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="bg-primary text-primary-foreground rounded-xl p-2.5">
              <svg
                className="size-7"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M0 4.8C0 2.14903 2.14903 0 4.8 0H12.0118C13.2848 0 14.5057 0.505713 15.4059 1.40589L22.5941 8.59411C23.4943 9.49429 24 10.7152 24 11.9882V19.2C24 21.851 21.851 24 19.2 24H4.8C2.14903 24 0 21.851 0 19.2V4.8Z" />
              </svg>
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Interleaved</h1>
          <p className="text-sm text-muted-foreground">
            Edit from your phone. Let Claude handle the code.
          </p>
        </div>

        {/* GitHub sign-in — primary action, big and obvious */}
        <Button
          type="button"
          className="w-full h-11 text-[15px]"
          onClick={handleGithubSignIn}
          disabled={isSubmitting}
        >
          <svg
            role="img"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            className="size-5"
          >
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          Continue with GitHub
          {submittingMethod === "github" && (
            <Loader className="size-4 animate-spin" />
          )}
        </Button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              or collaborator sign-in
            </span>
          </div>
        </div>

        {/* Email — secondary, for invited collaborators */}
        <form
          className="space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            await handleEmailSignIn(formData);
          }}
        >
          <Input
            ref={emailInputRef}
            type="email"
            name="email"
            placeholder="you@company.com"
            required
            disabled={isSubmitting}
            className="h-11"
          />
          <Button
            type="submit"
            variant="outline"
            className="w-full h-11"
            disabled={isSubmitting}
          >
            Send sign-in link
            {submittingMethod === "email" && (
              <Loader className="size-4 animate-spin" />
            )}
          </Button>
        </form>

        {/* Footer */}
        <p className="text-xs text-muted-foreground text-center">
          Open source &middot;{" "}
          <a
            className="underline hover:text-foreground transition-colors"
            href="https://github.com/imazen/interleaved"
            target="_blank"
          >
            GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
