/**
 * Decrypt OAuth tokens stored by better-auth.
 *
 * better-auth supports two encrypted formats:
 *   1. Legacy: raw hex (from xchacha20poly1305 with auth secret)
 *   2. Envelope: "$ba$<version>$<ciphertext>" (versioned, newer format)
 *
 * symmetricDecrypt with a string key only handles one path. Using the
 * object-key form ({ keys, currentVersion, legacySecret }) supports
 * both: it parses the $ba$ envelope if present, otherwise falls back
 * to the legacy raw-hex decrypt path.
 */

import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

const secret = (process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET) as string;

// Object key that handles both raw hex (legacy) and $ba$ envelope formats
const key = {
  currentVersion: 0,
  keys: new Map<number, string>([[0, secret]]),
  legacySecret: secret,
};

export async function decryptOAuthToken(encryptedToken: string | null | undefined): Promise<string | null> {
  if (!encryptedToken) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await symmetricDecrypt({ key: key as any, data: encryptedToken });
  } catch (error) {
    console.error("[auth] failed to decrypt OAuth token:", (error as Error).message);
    return null;
  }
}

export async function encryptOAuthToken(rawToken: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return symmetricEncrypt({ key: key as any, data: rawToken });
}
