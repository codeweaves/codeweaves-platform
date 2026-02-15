import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const auth0Id = process.env.SUPER_ADMIN_AUTH0_ID;

  if (!email || !auth0Id) {
    console.error(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_AUTH0_ID environment variables are required',
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Super admin already exists: ${email}`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      auth0Id,
      role: Role.SUPER_ADMIN,
      name: 'Super Admin',
    },
  });

  console.log(`Created super admin: ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
