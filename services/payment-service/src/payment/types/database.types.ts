import type { Prisma } from "../../db/client.js";

export type DbClient = Prisma.TransactionClient | { tx: Prisma.TransactionClient } | any;
export type ClientSession = DbClient;
