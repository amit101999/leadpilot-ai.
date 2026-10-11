import { hash, verify } from "@node-rs/argon2";

// argon2id with OWASP-recommended baseline parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * A fixed hash verified when the e-mail does not exist, so login timing does
 * not reveal which accounts exist.
 */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("leadpilot-timing-equalizer");
  await verifyPassword(await dummyHash, password);
  return false;
}
