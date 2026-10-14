import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for secrets at rest (OAuth refresh/access tokens).
 * Format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
 * The key comes from MASTER_ENCRYPTION_KEY (never from the database). In
 * production this key should itself live in a secret manager (see docs/SECURITY.md).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) {
      throw new Error("MASTER_ENCRYPTION_KEY must be 32 bytes, base64-encoded (run `npm run gen:key`)");
    }
    this.key = key;
  }

  encrypt(plaintext: string, aad = ""): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
  }

  decrypt(envelope: string, aad = ""): string {
    const [version, ivB64, tagB64, ctB64] = envelope.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error("Unsupported secret envelope");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  }
}
