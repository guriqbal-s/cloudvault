// CloudVault seed script: creates the roles and permissions the app needs.
//
//   node prisma/seed.js     (npm run db:seed)
//
// Idempotent and safe to run anywhere, including production. It creates no user accounts
// and never deletes data. Create the Super Admin and Admin accounts with
// database/create-admins.sql.

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERMISSIONS, ROLES } from './seed/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

async function seedCore() {
  const permissionIds = {};
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      update: { group: p.group, description: p.description },
      create: { key: p.key, group: p.group, description: p.description },
    });
    permissionIds[p.key] = row.id;
  }

  for (const r of ROLES) {
    const row = await prisma.role.upsert({
      where: { name: r.name },
      update: { rank: r.rank, description: r.description },
      create: { name: r.name, rank: r.rank, description: r.description },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: row.id } });
    await prisma.rolePermission.createMany({
      data: r.permissions.map((key) => ({ roleId: row.id, permissionId: permissionIds[key] })),
    });
  }
  console.log(`Core data: ${PERMISSIONS.length} permissions, ${ROLES.length} roles`);
  console.log('Next: create the admin accounts with database/create-admins.sql');
}

seedCore()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
