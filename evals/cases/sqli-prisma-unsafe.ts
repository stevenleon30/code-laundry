import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function searchProducts(term: string) {
  return prisma.$queryRawUnsafe(`SELECT * FROM products WHERE name LIKE '%${term}%'`);
}
