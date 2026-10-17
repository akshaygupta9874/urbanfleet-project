import { describe, expect, it } from "vitest";
import {
  mongoIdToUuid,
  normalizeLedgerReference,
  normalizeLedgerTransactionId,
  uuidToMongoId,
} from "../src/utils/mongo-migration.js";

describe("Mongo-to-Postgres ID mapping", () => {
  it("maps string and Extended JSON ObjectIds bijectively", () => {
    const mongoId = "60b8d295f1d5d82b8c8d2345";
    const uuid = "00000000-60b8-d295-f1d5-d82b8c8d2345";

    expect(mongoIdToUuid(mongoId)).toBe(uuid);
    expect(mongoIdToUuid({ $oid: mongoId })).toBe(uuid);
    expect(uuidToMongoId(uuid)).toBe(mongoId);
    expect(() => uuidToMongoId("00000000-zzzz-d295-f1d5-d82b8c8d2345")).toThrow(/Invalid mapped UUID/);
  });

  it("normalizes ledger ObjectId references and preserves non-ObjectId strings", () => {
    expect(normalizeLedgerReference({ $oid: "60b8d295f1d5d82b8c8d2345" }))
      .toBe("00000000-60b8-d295-f1d5-d82b8c8d2345");
    expect(normalizeLedgerReference("system-account")).toBe("system-account");
    expect(normalizeLedgerReference(undefined)).toBeNull();
  });

  it("requires ledger transaction IDs to be UUIDs or Mongo ObjectIds", () => {
    expect(normalizeLedgerTransactionId("60b8d295f1d5d82b8c8d2345", "fallback"))
      .toBe("00000000-60b8-d295-f1d5-d82b8c8d2345");
    expect(normalizeLedgerTransactionId("f9b3cf77-2e6d-4f29-956e-b1efbd1b70b9", "fallback"))
      .toBe("f9b3cf77-2e6d-4f29-956e-b1efbd1b70b9");
    expect(() => normalizeLedgerTransactionId("invalid", "fallback")).toThrow(/Invalid ledger transaction ID/);
  });
});
