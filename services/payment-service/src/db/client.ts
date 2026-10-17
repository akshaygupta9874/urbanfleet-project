import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

if (process.env.NODE_ENV === "test") {
  prisma.$transaction = (async (arg: any) => {
    if (typeof arg === "function") {
      return await arg(prisma);
    }
    if (Array.isArray(arg)) {
      return await Promise.all(arg);
    }
    return arg;
  }) as any;
}
