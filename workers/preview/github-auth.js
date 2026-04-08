/**
 * GitHub App authentication for Cloudflare Workers.
 *
 * Generates a JWT signed with the App private key (RS256) using
 * the Web Crypto API, then exchanges it for an installation access
 * token scoped to a specific repository.
 */

const b64urlEncode = (bytes) => {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64urlEncodeString = (str) => {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Parse a PEM-encoded RSA private key and import it as a CryptoKey.
 */
async function importPrivateKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // If it's PKCS#1 (starts with "RSA PRIVATE KEY"), we need to wrap in PKCS#8
  // GitHub Apps export PKCS#1 format. Web Crypto only supports PKCS#8.
  // Convert by prepending the PKCS#8 header for RSA.
  if (pem.includes("RSA PRIVATE KEY")) {
    return await importPKCS1(bytes);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Convert PKCS#1 to PKCS#8 by prepending the ASN.1 wrapper.
 */
async function importPKCS1(pkcs1Bytes) {
  // PKCS#8 wrapper for RSA private keys:
  // SEQUENCE {
  //   INTEGER 0
  //   SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }
  //   OCTET STRING { <pkcs1 bytes> }
  // }
  const rsaOid = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);

  const length = pkcs1Bytes.length;
  const lengthBytes = length < 128
    ? [length]
    : length < 256
      ? [0x81, length]
      : length < 65536
        ? [0x82, length >> 8, length & 0xff]
        : [0x83, length >> 16, (length >> 8) & 0xff, length & 0xff];

  const octetString = new Uint8Array([0x04, ...lengthBytes, ...pkcs1Bytes]);

  const innerSeqContent = new Uint8Array(
    3 + rsaOid.length + octetString.length,
  );
  innerSeqContent[0] = 0x02;
  innerSeqContent[1] = 0x01;
  innerSeqContent[2] = 0x00;
  innerSeqContent.set(rsaOid, 3);
  innerSeqContent.set(octetString, 3 + rsaOid.length);

  const innerLen = innerSeqContent.length;
  const innerLenBytes = innerLen < 128
    ? [innerLen]
    : innerLen < 256
      ? [0x81, innerLen]
      : innerLen < 65536
        ? [0x82, innerLen >> 8, innerLen & 0xff]
        : [0x83, innerLen >> 16, (innerLen >> 8) & 0xff, innerLen & 0xff];

  const pkcs8 = new Uint8Array([0x30, ...innerLenBytes, ...innerSeqContent]);

  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Generate a JWT for the GitHub App.
 *
 * Valid for 10 minutes (GitHub max). Signed with RS256.
 */
export async function generateAppJWT(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,      // 60s leeway for clock drift
    exp: now + 600,     // 10 min
    iss: appId,
  };

  const headerB64 = b64urlEncodeString(JSON.stringify(header));
  const payloadB64 = b64urlEncodeString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${b64urlEncode(signature)}`;
}

/**
 * Get the installation ID for a specific repo.
 * Requires an App JWT.
 */
export async function getInstallationId(jwt, owner, repo) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "interleaved-preview-worker",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get installation for ${owner}/${repo}: ${response.status}`);
  }

  const data = await response.json();
  return data.id;
}

/**
 * Exchange an App JWT for an installation access token.
 * The returned token is valid for ~1 hour and scoped to the installation.
 */
export async function getInstallationToken(jwt, installationId) {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "interleaved-preview-worker",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get installation token: ${response.status}`);
  }

  const data = await response.json();
  return data.token;
}

/**
 * High-level: get an installation token for a specific repo.
 * Wraps the full flow.
 */
export async function getRepoToken(appId, privateKeyPem, owner, repo) {
  const jwt = await generateAppJWT(appId, privateKeyPem);
  const installationId = await getInstallationId(jwt, owner, repo);
  return await getInstallationToken(jwt, installationId);
}
