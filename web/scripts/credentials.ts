import { webcrypto } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type PublishCredentials = {
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

export type StoredPublishStatus = {
  readonly apiUrl: string;
  readonly accessClientId?: string;
  readonly encryptedFile: string;
};

export type ImportCredentialsOptions = {
  readonly accessClientId: string;
  readonly apiUrl?: string;
};

type ProjectConfig = {
  readonly apiUrl: string;
};

type CredentialFile = {
  readonly version: 1;
  readonly apiUrl: string;
  readonly accessClientId: string;
  readonly secret: EncryptedSecret;
};

type EncryptedSecret = {
  readonly cipher: "AES-256-GCM";
  readonly kdf: "PBKDF2-SHA-256";
  readonly iterations: number;
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
};

const configFileName = "credentials.json";
const kdfIterations = 210_000;

export async function loadPublishCredentials(
  env: Record<string, string | undefined>,
): Promise<PublishCredentials> {
  const stored = await readCredentialFile();
  const passphrase = await readPassphrase(env, "Credential passphrase: ");
  const clientSecret = await decryptSecret(stored.secret, passphrase);
  return {
    apiUrl: stored.apiUrl,
    clientId: stored.accessClientId,
    clientSecret,
  };
}

export async function importPublishCredentials(
  options: ImportCredentialsOptions,
  env: Record<string, string | undefined>,
): Promise<StoredPublishStatus> {
  const apiUrl = options.apiUrl ?? (await readProjectConfig(env)).apiUrl;
  const clientSecret = await promptHidden("Cloudflare Access client secret: ");
  const passphrase = await readNewPassphrase(env);
  const file: CredentialFile = {
    version: 1,
    apiUrl,
    accessClientId: options.accessClientId,
    secret: await encryptSecret(clientSecret, passphrase),
  };
  await writeCredentialFile(file);
  return {
    apiUrl,
    accessClientId: options.accessClientId,
    encryptedFile: credentialPath(),
  };
}

export async function readPublishLoginStatus(
  env: Record<string, string | undefined>,
): Promise<StoredPublishStatus> {
  const project = await readProjectConfig(env);
  const stored = await readCredentialFileOrUndefined();
  return {
    apiUrl: stored?.apiUrl ?? project.apiUrl,
    accessClientId: stored?.accessClientId,
    encryptedFile: credentialPath(),
  };
}

export async function clearPublishLogin(): Promise<void> {
  await unlink(credentialPath()).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  });
}

async function readCredentialFile(): Promise<CredentialFile> {
  const file = await readCredentialFileOrUndefined();
  if (!file) {
    throw new Error(
      "publish credentials are not configured; run `pnpm auth import --access-client-id <id>`",
    );
  }
  return file;
}

async function readCredentialFileOrUndefined(): Promise<CredentialFile | undefined> {
  let text: string;
  try {
    text = await readFile(credentialPath(), "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const value = JSON.parse(text) as Partial<CredentialFile>;
  if (
    value.version !== 1 ||
    !value.apiUrl ||
    !value.accessClientId ||
    !value.secret
  ) {
    throw new Error(`${credentialPath()} is not a valid benchmark credential file`);
  }
  return {
    version: 1,
    apiUrl: value.apiUrl,
    accessClientId: value.accessClientId,
    secret: value.secret,
  };
}

async function writeCredentialFile(file: CredentialFile): Promise<void> {
  const path = credentialPath();
  await mkdir(credentialDir(), { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await chmod(path, 0o600);
}

async function readProjectConfig(
  _env: Record<string, string | undefined>,
): Promise<ProjectConfig> {
  const configPath = fileURLToPath(new URL("../bench.config.json", import.meta.url));
  const value = JSON.parse(await readFile(configPath, "utf8")) as Partial<ProjectConfig>;
  if (!value.apiUrl) {
    throw new Error(`${configPath} is missing apiUrl`);
  }
  return { apiUrl: value.apiUrl };
}

async function readNewPassphrase(
  _env: Record<string, string | undefined>,
): Promise<string> {
  const passphrase = await promptHidden("Credential encryption passphrase: ");
  const confirmation = await promptHidden("Confirm credential encryption passphrase: ");
  if (passphrase !== confirmation) {
    throw new Error("passphrases did not match");
  }
  if (passphrase.length < 8) {
    throw new Error("credential passphrase must be at least 8 characters");
  }
  return passphrase;
}

async function readPassphrase(
  _env: Record<string, string | undefined>,
  prompt: string,
): Promise<string> {
  return promptHidden(prompt);
}

async function encryptSecret(secret: string, passphrase: string): Promise<EncryptedSecret> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(passphrase, salt, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      textBytes(secret),
    ),
  );
  return {
    cipher: "AES-256-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: kdfIterations,
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

async function decryptSecret(secret: EncryptedSecret, passphrase: string): Promise<string> {
  if (secret.cipher !== "AES-256-GCM" || secret.kdf !== "PBKDF2-SHA-256") {
    throw new Error("unsupported credential encryption format");
  }
  const salt = decodeBase64Url(secret.salt);
  const iv = decodeBase64Url(secret.iv);
  const ciphertext = decodeBase64Url(secret.ciphertext);
  const key = await deriveAesKey(passphrase, salt, ["decrypt"], secret.iterations);
  try {
    const plaintext = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("failed to decrypt publish credentials; check the passphrase");
  }
}

async function deriveAesKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[],
  iterations = kdfIterations,
): Promise<CryptoKey> {
  const material = await webcrypto.subtle.importKey(
    "raw",
    textBytes(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function promptHidden(prompt: string): Promise<string> {
  const shouldHide = process.stdin.isTTY && process.stdout.isTTY && platform() !== "win32";
  if (shouldHide) {
    spawnSync("stty", ["-echo"], { stdio: "inherit" });
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = await rl.question(prompt);
    if (shouldHide) {
      process.stdout.write("\n");
    }
    return value;
  } finally {
    rl.close();
    if (shouldHide) {
      spawnSync("stty", ["echo"], { stdio: "inherit" });
    }
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return webcrypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return exactBytes(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}

function exactBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

function textBytes(value: string): Uint8Array<ArrayBuffer> {
  return exactBytes(new TextEncoder().encode(value));
}

function credentialDir(): string {
  return `${homedir()}/.config/benchmark-explorer`;
}

function credentialPath(): string {
  return `${credentialDir()}/${configFileName}`;
}
