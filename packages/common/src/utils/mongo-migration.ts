const HEX_24_REGEX = /^[0-9a-fA-F]{24}$/;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function unwrapMongoId(mongoId: unknown): string {
    if (!mongoId) {
        throw new Error("mongoId cannot be empty or null");
    }
    const str = typeof mongoId === "object" && "$oid" in (mongoId as any)
        ? (mongoId as { $oid: unknown }).$oid
        : mongoId;
    if (typeof str !== "string") {
        throw new Error("MongoDB ObjectId must be a 24-character hexadecimal string or Extended JSON $oid.");
    }
    return str;
}

export function mongoIdToUuid(mongoId: unknown): string {
    const str = unwrapMongoId(mongoId);
    if (!HEX_24_REGEX.test(str)) {
        throw new Error(`Invalid MongoDB ObjectId: "${str}". Expected a 24-character hexadecimal string.`);
    }
    const clean = str.toLowerCase();
    const full = `00000000${clean}`;
    return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20, 32)}`;
}

export function normalizeLedgerReference(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (typeof value === "object") {
        return mongoIdToUuid(value);
    }
    if (typeof value !== "string") {
        throw new Error("Ledger reference must be a string or MongoDB Extended JSON ObjectId.");
    }
    return HEX_24_REGEX.test(value) ? mongoIdToUuid(value) : value;
}

export function normalizeLedgerTransactionId(value: unknown, fallback: string): string {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    if (typeof value !== "string") {
        return mongoIdToUuid(value);
    }
    if (HEX_24_REGEX.test(value)) {
        return mongoIdToUuid(value);
    }
    if (!UUID_REGEX.test(value)) {
        throw new Error(`Invalid ledger transaction ID: "${value}". Expected a UUID or MongoDB ObjectId.`);
    }
    return value;
}

export function uuidToMongoId(uuid: string): string {
    const clean = uuid.replace(/-/g, "");
    if (!UUID_REGEX.test(uuid) || !clean.startsWith("00000000")) {
        throw new Error(`Invalid mapped UUID: "${uuid}". Expected 32-hex string starting with 00000000.`);
    }
    return clean.slice(8);
}
