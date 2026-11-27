import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP (SHA-1, 30-second steps), so tests can act as the user's
 * authenticator app. Test-only: the application never computes codes.
 */

export function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totp(secretBase32: string, timeMs = Date.now(), digits = 6): string {
  return hotp(base32Decode(secretBase32), Math.floor(timeMs / 1000 / 30), digits);
}

/** Wait until a fresh 30-second window starts (servers may refuse a code that was already used). */
export async function nextTotpWindow(): Promise<void> {
  const ms = 30_000 - (Date.now() % 30_000) + 250;
  await new Promise((r) => setTimeout(r, ms));
}
