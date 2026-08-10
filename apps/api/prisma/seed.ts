import { AccessScope, PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

/** The role that grants every permission. Seeded by the RBAC migration. */
const SUPER_ADMIN_ROLE_KEY = 'platform.super_admin';

/**
 * Bootstraps the first account on a fresh database.
 *
 * This is the ONLY way to create that account: sign-up is invitation-only, and
 * creating an invitation requires `Invitation:Create`, which requires a user who
 * already holds a platform role. Without this the database is unusable.
 *
 * Run AFTER `prisma migrate deploy` — the role assignment has a foreign key to
 * `roles`, whose rows the RBAC migration seeds.
 *
 * Idempotent, and self-healing: pointed at a database whose super admin predates
 * RBAC, it adds the missing scope and role rather than failing.
 */
async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  // Renamed with the Auth0 -> Clerk migration; the old name still works so an
  // existing .env keeps functioning.
  const clerkId = process.env.SUPER_ADMIN_CLERK_ID ?? process.env.SUPER_ADMIN_AUTH0_ID;

  if (!email || !clerkId) {
    console.error(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_CLERK_ID environment variables are required',
    );
    process.exit(1);
  }

  const role = await prisma.appRole.findUnique({
    where: { key: SUPER_ADMIN_ROLE_KEY },
  });
  if (!role) {
    console.error(
      `Role "${SUPER_ADMIN_ROLE_KEY}" not found. Run "prisma migrate deploy" first — ` +
        'the RBAC migration seeds the role catalog this depends on.',
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    include: { roleAssignments: { where: { deletedAt: null } } },
  });

  if (existing) {
    const updates: string[] = [];

    // A super admin must be PLATFORM-scoped; the column defaults to ORG.
    if (existing.accessScope !== AccessScope.PLATFORM) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { accessScope: AccessScope.PLATFORM },
      });
      updates.push('accessScope=PLATFORM');
    }

    // Without this the account resolves to zero permissions and every screen is
    // denied, which is what an account created before RBAC looks like.
    if (!existing.roleAssignments.some((a) => a.roleKey === SUPER_ADMIN_ROLE_KEY)) {
      await prisma.userRoleAssignment.create({
        data: { userId: existing.id, roleKey: SUPER_ADMIN_ROLE_KEY },
      });
      updates.push(`role=${SUPER_ADMIN_ROLE_KEY}`);
    }

    console.log(
      updates.length > 0
        ? `Super admin already existed, repaired: ${email} (${updates.join(', ')})`
        : `Super admin already exists and is correctly configured: ${email}`,
    );
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      clerkId,
      name: 'Super Admin',
      // Legacy tier, still written because invitations read it.
      role: Role.SUPER_ADMIN,
      accessScope: AccessScope.PLATFORM,
      roleAssignments: { create: [{ roleKey: SUPER_ADMIN_ROLE_KEY }] },
    },
  });

  console.log(
    `Created super admin: ${user.email} (${user.id}) with ${SUPER_ADMIN_ROLE_KEY}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
