import { assertByteLength } from "./bytes";
import { hkdf } from "./hkdf";
import { randomBytes } from "./random";

/** Key material derived from the 32-byte master secret. */
export interface DerivedKeys {
  /** 32-byte seed for Ed25519 signing keys. */
  signingSeed: Uint8Array;
  /** 32-byte seed for Curve25519 box keys. */
  boxSeed: Uint8Array;
}

/** Generates a fresh 32-byte master secret. */
export function generateMasterSecret(): Uint8Array {
  return randomBytes(32);
}

/** Derives disjoint signing and box seeds from a 32-byte master secret. */
export function deriveKeysFromMaster(masterSecret: Uint8Array): DerivedKeys {
  assertByteLength("masterSecret", masterSecret, 32);

  return {
    signingSeed: hkdf(masterSecret, "sig", 32),
    boxSeed: hkdf(masterSecret, "box", 32)
  };
}
