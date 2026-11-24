// CloudVault seed script.
//
//   node prisma/seed.js           -> core data (roles, permissions) + full demo dataset
//   node prisma/seed.js --core    -> core data only (safe for production bootstrap)
//
// The demo run WIPES existing application data (users, files, shares, logs...) and the
// demo file objects on disk, then rebuilds them. It refuses to run when NODE_ENV=production.
// File contents are written straight to STORAGE_ROOT using the same opaque keys the
// backend storage provider will use, so seeded files can really be downloaded/previewed.

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERMISSIONS, ROLES } from './seed/permissions.js';
import {
  mulberry32,
  makeText,
  makeCsv,
  makePdf,
  makePng,
  makeDocx,
  makeXlsx,
  makeZip,
} from './seed/generators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const CORE_ONLY = process.argv.includes('--core');
const STORAGE_ROOT = path.resolve(repoRoot, process.env.STORAGE_ROOT || './storage');
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD || 'CloudVault#2026';
const DEFAULT_QUOTA = BigInt(process.env.DEFAULT_QUOTA_BYTES || 5368709120);
const WARNING_PERCENT = Number(process.env.QUOTA_WARNING_PERCENT || 80);

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const daysAgo = (d) => new Date(NOW - d * DAY);
const daysAhead = (d) => new Date(NOW + d * DAY);

const prisma = new PrismaClient();
const rng = mulberry32(20261117);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  png: 'image/png',
  zip: 'application/zip',
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------------
// Core data: permissions + roles (idempotent, safe to run anywhere)
// ---------------------------------------------------------------------

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

  const roleIds = {};
  for (const r of ROLES) {
    const row = await prisma.role.upsert({
      where: { name: r.name },
      update: { rank: r.rank, description: r.description },
      create: { name: r.name, rank: r.rank, description: r.description },
    });
    roleIds[r.name] = row.id;

    await prisma.rolePermission.deleteMany({ where: { roleId: row.id } });
    await prisma.rolePermission.createMany({
      data: r.permissions.map((key) => ({ roleId: row.id, permissionId: permissionIds[key] })),
    });
  }
  console.log(`Core data: ${PERMISSIONS.length} permissions, ${ROLES.length} roles`);
  return roleIds;
}

// ---------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------

async function wipeDemoData() {
  await prisma.activityLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.starredResource.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.fileShare.deleteMany();
  await prisma.folderShare.deleteMany();
  await prisma.storageUsage.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.file.updateMany({ data: { currentVersionId: null } });
  await prisma.fileVersion.deleteMany();
  await prisma.file.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();

  await fs.rm(path.join(STORAGE_ROOT, 'versions', 'users'), { recursive: true, force: true });
  for (const dir of ['uploads', 'versions', 'tmp']) {
    await fs.mkdir(path.join(STORAGE_ROOT, dir), { recursive: true });
  }
}

async function writeObject(key, buf) {
  const full = path.join(STORAGE_ROOT, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
}

async function seedDemo(roleIds) {
  await wipeDemoData();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // In-memory ledgers that feed the activity log, notifications and usage snapshots.
  const activity = [];
  const notifications = [];
  const versionLog = []; // { ownerId, createdAt, size }
  const fileLog = []; // { ownerId, createdAt }
  const folderLog = []; // { ownerId, createdAt }
  const usedBytes = new Map();

  const addLog = (user, action, { type, id, name, description, at, metadata, ip } = {}) => {
    activity.push({
      userId: user.id,
      action,
      resourceType: type,
      resourceId: id,
      resourceName: name,
      description,
      ...(metadata ? { metadata } : {}),
      ip: ip ?? '127.0.0.1',
      userAgent: USER_AGENTS[0],
      createdAt: at,
      updatedAt: at,
    });
  };

  const addNotification = (user, type, title, body, at, { read = false, data } = {}) => {
    notifications.push({
      userId: user.id,
      type,
      title,
      body,
      ...(data ? { data } : {}),
      readAt: read ? new Date(at.getTime() + 3 * 60 * 1000) : null,
      createdAt: at,
      updatedAt: at,
    });
  };

  // ---- Users --------------------------------------------------------
  const USER_DEFS = [
    { key: 'superAdmin', name: 'Sofia Reyes', email: 'superadmin@cloudvault.dev', role: 'Super Admin', joined: 90, quota: 20 * GB, theme: 'dark' },
    { key: 'admin', name: 'Marcus Chen', email: 'admin@cloudvault.dev', role: 'Admin', joined: 80, quota: 20 * GB, theme: 'system' },
    { key: 'manager', name: 'Priya Nair', email: 'manager@cloudvault.dev', role: 'Manager', joined: 70, quota: 10 * GB, theme: 'light' },
    { key: 'alice', name: 'Alice Johnson', email: 'alice@cloudvault.dev', role: 'Standard User', joined: 60, theme: 'light' },
    { key: 'bob', name: 'Bob Martinez', email: 'bob@cloudvault.dev', role: 'Standard User', joined: 55, quota: 25 * MB, theme: 'dark' },
    { key: 'viewer', name: 'Vera Okafor', email: 'viewer@cloudvault.dev', role: 'Viewer', joined: 40, theme: 'system' },
    { key: 'suspended', name: 'Sam Whitfield', email: 'suspended@cloudvault.dev', role: 'Standard User', status: 'SUSPENDED', joined: 50 },
    { key: 'pending', name: 'Nina Patel', email: 'pending@cloudvault.dev', role: 'Standard User', status: 'PENDING_VERIFICATION', joined: 1 },
  ];

  const U = {};
  for (const def of USER_DEFS) {
    const status = def.status ?? 'ACTIVE';
    const joinedAt = daysAgo(def.joined);
    U[def.key] = await prisma.user.create({
      data: {
        email: def.email,
        name: def.name,
        passwordHash,
        status,
        emailVerifiedAt: status === 'PENDING_VERIFICATION' ? null : joinedAt,
        storageQuotaBytes: def.quota ? BigInt(def.quota) : DEFAULT_QUOTA,
        themePref: def.theme ?? 'system',
        notificationPrefs: {
          inApp: { shared: true, uploads: true, quota: true },
          email: { shared: true, uploads: false, quota: true },
        },
        lastLoginAt: status === 'ACTIVE' ? daysAgo(rng() * 2) : null,
        createdAt: joinedAt,
        updatedAt: joinedAt,
        roles: { create: [{ roleId: roleIds[def.role] }] },
      },
    });
    addNotification(U[def.key], 'SYSTEM', 'Welcome to CloudVault', 'Your account is ready. Upload your first file to get started.', joinedAt, { read: true });
  }

  // ---- Helpers for folders and files ---------------------------------
  async function mkFolder(owner, name, parent, ageDays) {
    const id = crypto.randomUUID();
    const createdAt = daysAgo(ageDays);
    const row = await prisma.folder.create({
      data: {
        id,
        name,
        ownerId: owner.id,
        parentId: parent ? parent.id : null,
        path: `${parent ? parent.path : '/'}${id}/`,
        createdAt,
        updatedAt: createdAt,
      },
    });
    folderLog.push({ ownerId: owner.id, createdAt });
    addLog(owner, 'FOLDER_CREATE', { type: 'FOLDER', id, name, at: createdAt, description: `${owner.name} created folder "${name}"` });
    return row;
  }

  /** specs: [{ buf, ageDays, by?, comment? }] ordered oldest -> newest. */
  async function mkFile(owner, folder, name, specs, { accessedDaysAgo } = {}) {
    const id = crypto.randomUUID();
    const ext = path.extname(name).slice(1).toLowerCase();
    const mimeType = MIME[ext];
    if (!mimeType) throw new Error(`No MIME mapping for .${ext}`);
    const first = specs[0];
    const last = specs[specs.length - 1];

    await prisma.file.create({
      data: {
        id,
        name,
        ownerId: owner.id,
        folderId: folder ? folder.id : null,
        mimeType,
        extension: ext,
        size: BigInt(first.buf.length),
        lastAccessedAt: accessedDaysAgo != null ? daysAgo(accessedDaysAgo) : null,
        createdAt: daysAgo(first.ageDays),
        updatedAt: daysAgo(first.ageDays),
      },
    });
    fileLog.push({ ownerId: owner.id, createdAt: daysAgo(first.ageDays) });

    let currentVersionId = null;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const uploader = spec.by ?? owner;
      const versionId = crypto.randomUUID();
      const number = i + 1;
      const key = `versions/users/${owner.id}/${id}/v${number}`;
      const createdAt = daysAgo(spec.ageDays);

      await writeObject(key, spec.buf);
      await prisma.fileVersion.create({
        data: {
          id: versionId,
          fileId: id,
          versionNumber: number,
          storageKey: key,
          size: BigInt(spec.buf.length),
          mimeType,
          checksum: sha256(spec.buf),
          uploadedById: uploader.id,
          comment: spec.comment ?? null,
          createdAt,
          updatedAt: createdAt,
        },
      });
      currentVersionId = versionId;

      versionLog.push({ ownerId: owner.id, createdAt, size: spec.buf.length });
      usedBytes.set(owner.id, (usedBytes.get(owner.id) ?? 0) + spec.buf.length);

      if (number === 1) {
        addLog(uploader, 'FILE_UPLOAD', { type: 'FILE', id, name, at: createdAt, description: `${uploader.name} uploaded "${name}"` });
      } else {
        addLog(uploader, 'VERSION_CREATE', { type: 'FILE', id, name, at: createdAt, description: `${uploader.name} uploaded version ${number} of "${name}"`, metadata: { versionNumber: number } });
      }
      if (spec.ageDays <= 7) {
        addNotification(uploader, 'UPLOAD_COMPLETED', 'Upload complete', `"${name}" was uploaded successfully.`, createdAt, { read: spec.ageDays > 2, data: { resourceType: 'FILE', resourceId: id } });
      }
    }

    await prisma.file.update({
      where: { id },
      data: { currentVersionId, size: BigInt(last.buf.length), updatedAt: daysAgo(last.ageDays) },
    });
    return { id, name, ownerId: owner.id, ext };
  }

  // Content builders ----------------------------------------------------
  const pdf = (title, revision, padKb) =>
    makePdf({
      title,
      lines: [
        'CloudVault demo document',
        `Revision ${revision}`,
        '',
        'This file was generated by the seed script so that previews and',
        'downloads work against realistic data.',
        '',
        'Summary',
        '- Objectives are on track for the quarter.',
        '- Budget variance remains within the approved range.',
        '- Two risks require executive attention.',
      ],
      padBytes: padKb * KB,
      rng,
    });
  const png = (hue, w = 640, h = 400) => makePng({ width: w, height: h, hue, rng });
  const txt = (title, kb) => makeText({ title, targetBytes: kb * KB, rng });

  // ---- Alice: the main demo account ----------------------------------
  const alice = U.alice;
  const documents = await mkFolder(alice, 'Documents', null, 29);
  const archive = await mkFolder(alice, 'Archive', null, 27); // intentionally empty (empty-state demo)
  const projects = await mkFolder(alice, 'Projects', documents, 25);
  const apollo = await mkFolder(alice, 'Apollo', projects, 16);
  const finance = await mkFolder(alice, 'Finance', null, 10);
  const images = await mkFolder(alice, 'Images', null, 12);
  const oldDrafts = await mkFolder(alice, 'Old Drafts', null, 23);
  void archive;

  const welcome = await mkFile(alice, null, 'Welcome to CloudVault.pdf', [{ buf: pdf('Welcome to CloudVault', 1, 120), ageDays: 28 }], { accessedDaysAgo: 5 });
  const todo = await mkFile(alice, null, 'Todo.txt', [{ buf: txt('Todo', 3), ageDays: 0.3 }], { accessedDaysAgo: 0.1 });

  const quarterly = await mkFile(alice, documents, 'Quarterly Report.pdf', [
    { buf: pdf('Quarterly Report', 1, 260), ageDays: 24, comment: 'Initial draft' },
    { buf: pdf('Quarterly Report', 2, 300), ageDays: 11, comment: 'Added finance section' },
    { buf: pdf('Quarterly Report', 3, 340), ageDays: 2, comment: 'Final review changes' },
  ], { accessedDaysAgo: 0.5 });
  await mkFile(alice, documents, 'Meeting Notes.txt', [{ buf: txt('Meeting Notes', 12), ageDays: 6 }], { accessedDaysAgo: 3 });

  await mkFile(alice, projects, 'Project Proposal.docx', [
    { buf: makeDocx({ title: 'Project Proposal', paragraphs: ['Draft proposal for the Apollo initiative.', 'Scope, timeline and budget to follow.'] }), ageDays: 19, comment: 'First draft' },
    { buf: makeDocx({ title: 'Project Proposal', paragraphs: ['Proposal for the Apollo initiative.', 'Scope: three phases over two quarters.', 'Budget: approved by finance.', 'Risks: vendor lead times.'] }), ageDays: 7, comment: 'Incorporated review feedback' },
  ], { accessedDaysAgo: 1 });
  await mkFile(alice, apollo, 'Apollo Roadmap.pdf', [{ buf: pdf('Apollo Roadmap', 1, 180), ageDays: 15 }], { accessedDaysAgo: 2 });
  await mkFile(alice, apollo, 'Apollo Budget.xlsx', [{
    buf: makeXlsx({
      sheetName: 'Budget',
      rows: [
        ['Phase', 'Q1', 'Q2', 'Total'],
        ['Discovery', 12000, 8000, 20000],
        ['Build', 45000, 52000, 97000],
        ['Launch', 5000, 18000, 23000],
      ],
    }),
    ageDays: 14,
  }]);
  await mkFile(alice, apollo, 'apollo-assets.zip', [{
    buf: makeZip([
      { name: 'README.txt', data: 'Apollo asset bundle (demo data).\n' },
      { name: 'logo.png', data: png(0.55, 200, 120) },
      { name: 'palette.txt', data: '#4f46e5\n#0ea5e9\n#10b981\n' },
    ]),
    ageDays: 13,
  }]);

  const teamPhoto = await mkFile(alice, images, 'Team Photo.png', [{ buf: png(0.08), ageDays: 9 }], { accessedDaysAgo: 4 });
  const mockup = await mkFile(alice, images, 'Product Mockup.png', [{ buf: png(0.6), ageDays: 8 }]);
  const banner = await mkFile(alice, images, 'Brand Banner.png', [{ buf: png(0.75, 800, 320), ageDays: 4 }], { accessedDaysAgo: 1 });

  await mkFile(alice, finance, 'Expenses 2026.csv', [{ buf: makeCsv({ targetBytes: 900 * KB, rng }), ageDays: 5 }], { accessedDaysAgo: 2 });
  await mkFile(alice, finance, 'Budget 2026.xlsx', [{
    buf: makeXlsx({
      sheetName: 'Budget 2026',
      rows: [
        ['Category', 'Jan', 'Feb', 'Mar'],
        ['Software', 1800, 1800, 2100],
        ['Travel', 900, 1400, 600],
        ['Marketing', 3200, 2900, 4100],
      ],
    }),
    ageDays: 3,
  }]);

  // Trash demo: one loose file and one folder (with its files) in the same state
  const oldDraft = await mkFile(alice, null, 'Old Draft v0.txt', [{ buf: txt('Old Draft', 6), ageDays: 21 }]);
  const draftA = await mkFile(alice, oldDrafts, 'draft-1.txt', [{ buf: txt('Draft 1', 5), ageDays: 22 }]);
  const draftB = await mkFile(alice, oldDrafts, 'draft-2.docx', [{ buf: makeDocx({ title: 'Draft 2', paragraphs: ['Superseded by the final proposal.'] }), ageDays: 22 }]);

  const fileTrashAt = daysAgo(3);
  await prisma.file.update({ where: { id: oldDraft.id }, data: { deletedAt: fileTrashAt, deletedById: alice.id, trashBatchId: crypto.randomUUID() } });
  addLog(alice, 'FILE_DELETE', { type: 'FILE', id: oldDraft.id, name: oldDraft.name, at: fileTrashAt, description: `${alice.name} moved "${oldDraft.name}" to trash` });

  const folderTrashAt = daysAgo(6);
  const folderBatch = crypto.randomUUID();
  await prisma.folder.update({ where: { id: oldDrafts.id }, data: { deletedAt: folderTrashAt, deletedById: alice.id, trashBatchId: folderBatch } });
  await prisma.file.updateMany({ where: { id: { in: [draftA.id, draftB.id] } }, data: { deletedAt: folderTrashAt, deletedById: alice.id, trashBatchId: folderBatch } });
  addLog(alice, 'FOLDER_DELETE', { type: 'FOLDER', id: oldDrafts.id, name: oldDrafts.name, at: folderTrashAt, description: `${alice.name} moved folder "${oldDrafts.name}" to trash` });

  // ---- Bob ------------------------------------------------------------
  const bob = U.bob;
  const design = await mkFolder(bob, 'Design', null, 20);
  const sharedAssets = await mkFolder(bob, 'Shared Assets', null, 18);
  await mkFile(bob, design, 'Logo Concept.png', [{ buf: png(0.95, 700, 500), ageDays: 17 }], { accessedDaysAgo: 6 });
  const designBrief = await mkFile(bob, design, 'Design Brief.pdf', [
    { buf: pdf('Design Brief', 1, 200), ageDays: 16, comment: 'Initial brief' },
    { buf: pdf('Design Brief', 2, 230), ageDays: 6, comment: 'Updated scope' },
  ], { accessedDaysAgo: 1 });
  await mkFile(bob, null, 'Data Export.csv', [{ buf: makeCsv({ targetBytes: 20 * MB, rng, startYear: 2025 }), ageDays: 14 }]);
  const brandGuide = await mkFile(bob, sharedAssets, 'Brand Guidelines.pdf', [{ buf: pdf('Brand Guidelines', 1, 150), ageDays: 13 }]);
  addNotification(bob, 'UPLOAD_FAILED', 'Upload failed', '"promo-video.mp4" exceeds your storage quota.', daysAgo(11), { read: true });
  addLog(bob, 'PASSWORD_CHANGE', { at: daysAgo(8), description: `${bob.name} changed their password` });

  // ---- Manager and Admin ------------------------------------------------
  const manager = U.manager;
  const planning = await mkFolder(manager, 'Team Planning', null, 21);
  const q4 = await mkFile(manager, planning, 'Q4 Planning.xlsx', [
    {
      buf: makeXlsx({ sheetName: 'Q4', rows: [['Team', 'Headcount', 'Budget'], ['Engineering', 24, 480000], ['Design', 6, 90000]] }),
      ageDays: 10,
    },
    {
      buf: makeXlsx({ sheetName: 'Q4', rows: [['Team', 'Headcount', 'Budget'], ['Engineering', 26, 520000], ['Design', 7, 105000], ['Support', 9, 110000]] }),
      ageDays: 4,
      comment: 'Added Support team',
    },
  ], { accessedDaysAgo: 1 });
  await mkFile(manager, planning, 'Hiring Plan.docx', [{ buf: makeDocx({ title: 'Hiring Plan', paragraphs: ['Open roles for Q4 and Q1.', 'Priority: senior backend engineer.'] }), ageDays: 9 }]);
  await mkFile(U.admin, null, 'Admin Runbook.pdf', [{ buf: pdf('Admin Runbook', 1, 140), ageDays: 27 }]);

  // ---- Sharing -----------------------------------------------------------
  async function shareFile(file, from, to, role, ageDays, { canDownload = true, read = false } = {}) {
    const at = daysAgo(ageDays);
    await prisma.fileShare.create({ data: { fileId: file.id, sharedWithId: to.id, sharedById: from.id, role, canDownload, createdAt: at, updatedAt: at } });
    addLog(from, 'SHARE_CREATE', { type: 'FILE', id: file.id, name: file.name, at, description: `${from.name} shared "${file.name}" with ${to.name} as ${role.toLowerCase()}`, metadata: { sharedWith: to.id, role } });
    addNotification(to, 'FILE_SHARED', 'File shared with you', `${from.name} shared "${file.name}" with you.`, at, { read, data: { resourceType: 'FILE', resourceId: file.id, actorId: from.id } });
  }
  async function shareFolder(folder, from, to, role, ageDays, { canDownload = true, read = false } = {}) {
    const at = daysAgo(ageDays);
    await prisma.folderShare.create({ data: { folderId: folder.id, sharedWithId: to.id, sharedById: from.id, role, canDownload, createdAt: at, updatedAt: at } });
    addLog(from, 'SHARE_CREATE', { type: 'FOLDER', id: folder.id, name: folder.name, at, description: `${from.name} shared folder "${folder.name}" with ${to.name} as ${role.toLowerCase()}`, metadata: { sharedWith: to.id, role } });
    addNotification(to, 'FOLDER_SHARED', 'Folder shared with you', `${from.name} shared the folder "${folder.name}" with you.`, at, { read, data: { resourceType: 'FOLDER', resourceId: folder.id, actorId: from.id } });
  }

  await shareFolder(projects, alice, bob, 'EDITOR', 20, { read: true });
  addLog(alice, 'SHARE_UPDATE', { type: 'FOLDER', id: projects.id, name: projects.name, at: daysAgo(18), description: `${alice.name} changed ${bob.name}'s access to "Projects" to editor` });
  addNotification(bob, 'PERMISSION_CHANGED', 'Permissions changed', `${alice.name} changed your access to "Projects" to Editor.`, daysAgo(18), { read: true, data: { resourceType: 'FOLDER', resourceId: projects.id, actorId: alice.id } });

  await shareFile(quarterly, alice, manager, 'VIEWER', 10, { read: true });
  addNotification(manager, 'SHARED_FILE_UPDATED', 'Shared file updated', `${alice.name} uploaded a new version of "${quarterly.name}".`, daysAgo(2), { data: { resourceType: 'FILE', resourceId: quarterly.id, actorId: alice.id } });

  await shareFolder(images, alice, U.viewer, 'VIEWER', 8, { canDownload: false });
  addNotification(U.viewer, 'ACCESS_REVOKED', 'Access revoked', 'Your access to "Q3 Planning.xlsx" was revoked by its owner.', daysAgo(15), { read: true });

  await shareFile(designBrief, bob, alice, 'EDITOR', 14, { read: true });
  addNotification(alice, 'SHARED_FILE_UPDATED', 'Shared file updated', `${bob.name} uploaded a new version of "${designBrief.name}".`, daysAgo(6), { data: { resourceType: 'FILE', resourceId: designBrief.id, actorId: bob.id } });
  await shareFolder(sharedAssets, bob, alice, 'VIEWER', 4);
  await shareFile(q4, manager, alice, 'VIEWER', 3);

  // ---- Share links ---------------------------------------------------------
  async function mkLink(file, creator, ageDays, { expiresAt = null, revokedAt = null, allowDownload = true, accessCount = 0, lastAccessedDaysAgo = null }) {
    const at = daysAgo(ageDays);
    await prisma.shareLink.create({
      data: {
        token: crypto.randomBytes(24).toString('base64url'),
        resourceType: 'FILE',
        fileId: file.id,
        createdById: creator.id,
        role: 'VIEWER',
        allowDownload,
        expiresAt,
        revokedAt,
        accessCount,
        lastAccessedAt: lastAccessedDaysAgo != null ? daysAgo(lastAccessedDaysAgo) : null,
        createdAt: at,
        updatedAt: at,
      },
    });
    addLog(creator, 'LINK_CREATE', { type: 'FILE', id: file.id, name: file.name, at, description: `${creator.name} created a share link for "${file.name}"` });
    if (revokedAt) {
      addLog(creator, 'LINK_REVOKE', { type: 'FILE', id: file.id, name: file.name, at: revokedAt, description: `${creator.name} revoked the share link for "${file.name}"` });
    }
  }
  await mkLink(welcome, alice, 27, { accessCount: 14, lastAccessedDaysAgo: 1 });
  await mkLink(teamPhoto, alice, 2, { expiresAt: daysAhead(7), accessCount: 3, lastAccessedDaysAgo: 0.5 });
  await mkLink(mockup, alice, 7, { revokedAt: daysAgo(2), accessCount: 6, lastAccessedDaysAgo: 3 });
  await mkLink(brandGuide, bob, 12, { expiresAt: daysAgo(3), allowDownload: false, accessCount: 9, lastAccessedDaysAgo: 4 });

  // ---- Starred ---------------------------------------------------------------
  const star = async (user, type, resource, ageDays) => {
    const at = daysAgo(ageDays);
    await prisma.starredResource.create({
      data: { userId: user.id, resourceType: type, ...(type === 'FILE' ? { fileId: resource.id } : { folderId: resource.id }), createdAt: at, updatedAt: at },
    });
    addLog(user, 'STAR', { type, id: resource.id, name: resource.name, at, description: `${user.name} starred "${resource.name}"` });
  };
  await star(alice, 'FILE', quarterly, 9);
  await star(alice, 'FOLDER', projects, 6);
  await star(alice, 'FILE', banner, 2);
  await star(bob, 'FILE', designBrief, 5);

  // ---- Other activity: logins, downloads, admin actions ---------------------
  const loginUsers = ['superAdmin', 'admin', 'manager', 'alice', 'bob', 'viewer'];
  for (const key of loginUsers) {
    const user = U[key];
    for (let i = 0; i < 10; i++) {
      const at = daysAgo(rng() * 29);
      const ip = `192.168.1.${10 + Math.floor(rng() * 40)}`;
      addLog(user, 'LOGIN', { at, ip, description: `${user.name} signed in` });
      if (rng() > 0.4) {
        addLog(user, 'LOGOUT', { at: new Date(at.getTime() + (20 + rng() * 240) * 60 * 1000), ip, description: `${user.name} signed out` });
      }
    }
  }

  const downloads = [
    [alice, quarterly], [alice, welcome], [alice, todo], [bob, designBrief], [alice, designBrief],
    [manager, quarterly], [manager, q4], [bob, quarterly], [alice, q4], [alice, brandGuide],
  ];
  for (const [user, file] of downloads) {
    for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
      addLog(user, 'FILE_DOWNLOAD', { type: 'FILE', id: file.id, name: file.name, at: daysAgo(rng() * 14), description: `${user.name} downloaded "${file.name}"` });
    }
  }

  addLog(alice, 'PROFILE_UPDATE', { at: daysAgo(12), description: `${alice.name} updated their profile` });
  addLog(U.admin, 'ADMIN_ROLE_CHANGE', { at: daysAgo(25), description: `${U.admin.name} assigned the Viewer role to ${U.viewer.name}`, metadata: { targetUserId: U.viewer.id, role: 'Viewer' } });
  addLog(U.admin, 'ADMIN_QUOTA_CHANGE', { at: daysAgo(20), description: `${U.admin.name} set ${bob.name}'s storage quota to 25 MB`, metadata: { targetUserId: bob.id, quotaBytes: 25 * MB } });
  addLog(U.admin, 'ADMIN_USER_STATUS_CHANGE', { at: daysAgo(5), description: `${U.admin.name} suspended ${U.suspended.name}`, metadata: { targetUserId: U.suspended.id, status: 'SUSPENDED' } });

  // ---- Storage usage counters, quota warnings and daily snapshots ---------------
  for (const user of Object.values(U)) {
    const used = usedBytes.get(user.id) ?? 0;
    await prisma.user.update({ where: { id: user.id }, data: { storageUsedBytes: BigInt(used) } });
    const pct = Math.round((used / Number(user.storageQuotaBytes)) * 100);
    if (pct >= WARNING_PERCENT) {
      addNotification(user, 'STORAGE_WARNING', 'Storage almost full', `You have used ${pct}% of your storage quota.`, daysAgo(1), { data: { percent: pct } });
    }
  }

  const snapshots = [];
  for (const user of Object.values(U)) {
    const myVersions = versionLog.filter((v) => v.ownerId === user.id);
    const myFiles = fileLog.filter((f) => f.ownerId === user.id);
    const myFolders = folderLog.filter((f) => f.ownerId === user.id);
    for (let d = 29; d >= 0; d--) {
      const ref = new Date(NOW - d * DAY);
      const dayStart = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
      const cutoff = d === 0 ? new Date(NOW) : new Date(dayStart.getTime() + DAY - 1);
      const uploadedToday = myVersions.filter((v) => v.createdAt >= dayStart && v.createdAt <= cutoff);
      snapshots.push({
        userId: user.id,
        date: dayStart,
        bytesUsed: BigInt(myVersions.filter((v) => v.createdAt <= cutoff).reduce((sum, v) => sum + v.size, 0)),
        fileCount: myFiles.filter((f) => f.createdAt <= cutoff).length,
        folderCount: myFolders.filter((f) => f.createdAt <= cutoff).length,
        bytesUploaded: BigInt(uploadedToday.reduce((sum, v) => sum + v.size, 0)),
        filesUploaded: uploadedToday.length,
      });
    }
  }
  await prisma.storageUsage.createMany({ data: snapshots });

  await prisma.activityLog.createMany({ data: activity });
  await prisma.notification.createMany({ data: notifications });

  // ---- Summary ------------------------------------------------------------------
  const counts = {
    users: await prisma.user.count(),
    folders: await prisma.folder.count(),
    files: await prisma.file.count(),
    versions: await prisma.fileVersion.count(),
    activityLogs: activity.length,
    notifications: notifications.length,
  };
  console.log('Demo data:', counts);
  console.log(`\nDemo accounts (password for all: ${PASSWORD})`);
  for (const def of USER_DEFS) {
    console.log(`  ${def.email.padEnd(30)} ${def.role.padEnd(14)} ${def.status ?? 'ACTIVE'}`);
  }
}

async function main() {
  if (!CORE_ONLY && process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production. Use --core instead.');
  }
  const roleIds = await seedCore();
  if (!CORE_ONLY) await seedDemo(roleIds);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
