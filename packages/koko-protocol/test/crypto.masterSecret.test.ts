import { beforeAll, describe, expect, it } from "vitest";
import { deriveKeysFromMaster, generateMasterSecret, initCrypto } from "../src/crypto";

describe("master secret", () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it("generateMasterSecret returns 32 bytes", () => {
    expect(generateMasterSecret()).toHaveLength(32);
  });

  it("deriveKeysFromMaster returns deterministic signingSeed and boxSeed", () => {
    const masterSecret = Uint8Array.from({ length: 32 }, (_, index) => index);

    expect(deriveKeysFromMaster(masterSecret)).toEqual(deriveKeysFromMaster(masterSecret));
  });

  it("derives different signingSeed and boxSeed", () => {
    const masterSecret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const derived = deriveKeysFromMaster(masterSecret);

    expect(derived.signingSeed).not.toEqual(derived.boxSeed);
  });

  it("returns different derived keys for different master secrets", () => {
    const first = deriveKeysFromMaster(Uint8Array.from({ length: 32 }, (_, index) => index));
    const second = deriveKeysFromMaster(Uint8Array.from({ length: 32 }, (_, index) => index + 1));

    expect(first.signingSeed).not.toEqual(second.signingSeed);
    expect(first.boxSeed).not.toEqual(second.boxSeed);
  });
});
