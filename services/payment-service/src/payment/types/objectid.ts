import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONGO_OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Types {
    export class ObjectId {
        private value: string;

        constructor(id?: string | ObjectId) {
            if (id instanceof ObjectId) {
                this.value = id.value;
            } else if (typeof id === "string" && id.length > 0) {
                this.value = id;
            } else {
                this.value = randomUUID();
            }
        }

        toString(): string {
            return this.value;
        }

        toHexString(): string {
            return this.value;
        }

        valueOf(): string {
            return this.value;
        }

        equals(other: unknown): boolean {
            if (other instanceof ObjectId) {
                return this.value === other.value;
            }
            if (typeof other === "string") {
                return this.value === other;
            }
            return false;
        }

        static isValid(id: unknown): boolean {
            if (typeof id !== "string" || id.trim().length === 0) {
                return false;
            }
            return UUID_REGEX.test(id) || MONGO_OBJECT_ID_REGEX.test(id);
        }
    }
}

export type ObjectId = Types.ObjectId;
export const ObjectId = Types.ObjectId;

export type ClientSession = Prisma.TransactionClient | { tx: Prisma.TransactionClient } | any;
