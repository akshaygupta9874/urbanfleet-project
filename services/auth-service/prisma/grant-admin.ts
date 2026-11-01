import 'dotenv/config';
import { prisma } from '../src/db/client.js';
import { Role } from '../src/db/client.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const secret = process.env.ADMIN_BOOTSTRAP_SECRET;

if (!email || !secret || secret.length < 24) {
  throw new Error('Set ADMIN_EMAIL and an ADMIN_BOOTSTRAP_SECRET of at least 24 characters.');
}

const user = await prisma.user.findUnique({ where: { email } });
if (!user) throw new Error(`No existing user found for ${email}. Create and verify the account first.`);

await prisma.user.update({
  where: { id: user.id },
  data: { roles: Array.from(new Set([...user.roles, Role.ADMIN])) },
});
console.log(`Granted ADMIN role to ${email}.`);
await prisma.$disconnect();
