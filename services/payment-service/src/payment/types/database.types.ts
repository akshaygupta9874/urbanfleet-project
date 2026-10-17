import type { Prisma } from "@prisma/client";

export type DbClient = Prisma.TransactionClient | { tx: Prisma.TransactionClient } | any;
export type ClientSession = DbClient;
