import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ActivityLog,
  AdminStats,
  CaseStatus,
  CaseStudy,
  EvidenceFile,
  PendingInviteSummary,
  Submission,
  SubmissionStatus,
  Team,
  TeamInvite,
  TeamMember,
} from '../src/types.ts';
import {
  buildInitialSeedData,
  hashPassword,
  type SeedUserRecord,
} from './seedData.ts';

export interface StoredUser extends SeedUserRecord {}

interface LocalDatabaseSchema {
  cases: CaseStudy[];
  users: StoredUser[];
  teams: Team[];
  submissions: Submission[];
  activities: ActivityLog[];
}

const BUCKET_NAME = 'crimeathon-files';

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() ?? '';
const SUPABASE_KEY = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim();
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabaseClient: SupabaseClient | null = null;
let supabaseSchemaError: string | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

export function isSupabaseMode(): boolean {
  return USE_SUPABASE;
}

export function getSupabaseDiagnostics(): { configured: boolean; schemaError: string | null } {
  return {
    configured: USE_SUPABASE,
    schemaError: supabaseSchemaError,
  };
}

// Local disk paths (used only when Supabase env vars are not configured)
const DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'crimeathon-data')
  : path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const SECRET_PATH = path.join(DATA_DIR, 'secret.key');
export const EVIDENCE_DIR = path.join(DATA_DIR, 'uploads', 'evidence');
export const SUBMISSIONS_DIR = path.join(DATA_DIR, 'uploads', 'submissions');

if (!USE_SUPABASE) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
}

export function getSigningSecret(): string {
  if (process.env.AUTH_SIGNING_SECRET?.trim()) {
    return process.env.AUTH_SIGNING_SECRET.trim();
  }
  if (USE_SUPABASE) {
    return crypto.createHash('sha256').update(`crimeathon:${SUPABASE_KEY}`).digest('hex');
  }
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret, 'utf8');
  return secret;
}

// ---------------- LOCAL DATABASE HELPERS ----------------

let localDbCache: LocalDatabaseSchema | null = null;

function saveLocalDb(dbRef: LocalDatabaseSchema): void {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dbRef, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function normalizeLocalDb(rawDb: Partial<LocalDatabaseSchema>): LocalDatabaseSchema {
  const nowIso = new Date().toISOString();
  const users: StoredUser[] = Array.isArray(rawDb.users) ? rawDb.users : [];
  const teams: Team[] = Array.isArray(rawDb.teams)
    ? rawDb.teams.map((t) => ({
        ...t,
        inviteCode: t.inviteCode || `INV-${t.teamCode.replace(/[^A-Z0-9]/g, '')}`,
        leaderId: t.leaderId || 'user-seed',
        membersList: Array.isArray(t.membersList) ? t.membersList : [],
        pendingInvites: Array.isArray(t.pendingInvites) ? t.pendingInvites : [],
      }))
    : [];

  if (users.length === 0) {
    const team101 = teams.find((t) => t.teamCode === 'TEAM-101');
    const team102 = teams.find((t) => t.teamCode === 'TEAM-102');
    if (team101) {
      const u1: StoredUser = {
        id: 'user-101',
        name: 'Kavya R',
        email: 'kavya.r@simats.edu.in',
        collegeId: 'SIMATS',
        teamId: team101.id,
        createdAt: team101.createdAt || nowIso,
        passwordHash: hashPassword('Cipher@123'),
      };
      users.push(u1);
      team101.leaderId = u1.id;
      if (team101.membersList.length === 0) {
        team101.membersList = [
          { userId: u1.id, name: u1.name, email: u1.email, role: 'Leader', joinedAt: u1.createdAt },
        ];
      }
    }
    if (team102) {
      const u2: StoredUser = {
        id: 'user-102',
        name: 'Aditya K',
        email: 'aditya.k@simats.edu.in',
        collegeId: 'SIMATS',
        teamId: team102.id,
        createdAt: team102.createdAt || nowIso,
        passwordHash: hashPassword('Packet@123'),
      };
      users.push(u2);
      team102.leaderId = u2.id;
      if (team102.membersList.length === 0) {
        team102.membersList = [
          { userId: u2.id, name: u2.name, email: u2.email, role: 'Leader', joinedAt: u2.createdAt },
        ];
      }
    }
  }

  return {
    cases: Array.isArray(rawDb.cases) ? rawDb.cases : [],
    users,
    teams,
    submissions: Array.isArray(rawDb.submissions) ? rawDb.submissions : [],
    activities: Array.isArray(rawDb.activities) ? rawDb.activities : [],
  };
}

function getLocalDb(): LocalDatabaseSchema {
  if (localDbCache) return localDbCache;

  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      localDbCache = normalizeLocalDb(JSON.parse(raw) as Partial<LocalDatabaseSchema>);
      saveLocalDb(localDbCache);
      return localDbCache;
    } catch {
      // Re-seed if corrupt
    }
  }

  const seed = buildInitialSeedData(false);
  for (const art of seed.artifacts) {
    const dir = art.folder === 'evidence' ? EVIDENCE_DIR : SUBMISSIONS_DIR;
    fs.writeFileSync(path.join(dir, art.storedName), art.content, 'utf8');
  }

  localDbCache = {
    cases: seed.cases,
    users: seed.users,
    teams: seed.teams,
    submissions: seed.submissions,
    activities: seed.activities,
  };
  saveLocalDb(localDbCache);
  return localDbCache;
}

// ---------------- SUPABASE SEEDING ----------------

let supabaseSeededPromise: Promise<void> | null = null;

export async function ensureInitialized(): Promise<void> {
  if (!USE_SUPABASE) {
    getLocalDb();
    return;
  }

  if (!supabaseSeededPromise) {
    supabaseSeededPromise = (async () => {
      const sb = getSupabase();

      // Ensure private storage bucket exists
      const { error: bucketErr } = await sb.storage.getBucket(BUCKET_NAME);
      if (bucketErr) {
        await sb.storage.createBucket(BUCKET_NAME, { public: false });
      }

      const { data: existingCases, error } = await sb.from('cases').select('id').limit(1);
      if (error) {
        supabaseSchemaError = error.message;
        supabaseSeededPromise = null;
        console.error('Supabase readiness check error:', error.message);
        return;
      }
      supabaseSchemaError = null;
      if (existingCases && existingCases.length > 0) return;

      const seed = buildInitialSeedData(true);

      // Upload starter files to Supabase Storage bucket
      for (const art of seed.artifacts) {
        await sb.storage
          .from(BUCKET_NAME)
          .upload(art.storedName, Buffer.from(art.content, 'utf8'), {
            contentType: 'text/plain',
            upsert: true,
          });
      }

      // Insert seed cases & evidence files
      await sb.from('cases').upsert(
        seed.cases.map((c) => ({
          id: c.id,
          code: c.code,
          title: c.title,
          category: c.category,
          difficulty: c.difficulty,
          briefing: c.briefing,
          objectives: c.objectives,
          status: c.status,
          created_at: c.createdAt,
          updated_at: c.updatedAt,
        }))
      );

      const allFiles = seed.cases.flatMap((c) =>
        c.files.map((f) => ({
          id: f.id,
          case_id: c.id,
          original_name: f.originalName,
          stored_name: f.storedName,
          extension: f.extension,
          mime_type: f.mimeType,
          size_bytes: f.sizeBytes,
          sha256: f.sha256,
          uploaded_at: f.uploadedAt,
          download_count: f.downloadCount,
        }))
      );
      if (allFiles.length > 0) {
        await sb.from('evidence_files').upsert(allFiles);
      }

      await sb.from('users').upsert(
        seed.users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          college_id: u.collegeId,
          team_id: u.teamId,
          password_hash: u.passwordHash,
          created_at: u.createdAt,
        }))
      );

      await sb.from('teams').upsert(
        seed.teams.map((t) => ({
          id: t.id,
          team_code: t.teamCode,
          team_name: t.teamName,
          invite_code: t.inviteCode,
          leader_id: t.leaderId,
          leader_email: t.leaderEmail,
          members: t.members,
          created_at: t.createdAt,
          last_active_at: t.lastActiveAt,
        }))
      );

      const allMembers = seed.teams.flatMap((t) =>
        t.membersList.map((m) => ({
          team_id: t.id,
          user_id: m.userId,
          name: m.name,
          email: m.email,
          role: m.role,
          joined_at: m.joinedAt,
        }))
      );
      if (allMembers.length > 0) {
        await sb.from('team_members').upsert(allMembers);
      }

      await sb.from('submissions').upsert(
        seed.submissions.map((s) => ({
          id: s.id,
          team_id: s.teamId,
          team_code: s.teamCode,
          team_name: s.teamName,
          case_id: s.caseId,
          case_code: s.caseCode,
          case_title: s.caseTitle,
          summary: s.summary,
          methodology: s.methodology,
          file_name: s.fileName,
          stored_name: s.storedName,
          extension: s.extension,
          mime_type: s.mimeType,
          size_bytes: s.sizeBytes,
          sha256: s.sha256,
          submitted_at: s.submittedAt,
          status: s.status,
          score: s.score,
          judge_feedback: s.judgeFeedback,
          evaluated_at: s.evaluatedAt,
        }))
      );

      await sb.from('activities').upsert(
        seed.activities.map((a) => ({
          id: a.id,
          type: a.type,
          team_code: a.teamCode,
          team_name: a.teamName,
          case_code: a.caseCode ?? null,
          file_name: a.fileName ?? null,
          details: a.details,
          timestamp: a.timestamp,
        }))
      );
    })();
  }

  await supabaseSeededPromise;
}

// ---------------- ROW MAPPERS ----------------

function mapEvidenceRow(row: Record<string, unknown>): EvidenceFile {
  return {
    id: String(row.id),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
    extension: String(row.extension),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    uploadedAt: String(row.uploaded_at),
    downloadCount: Number(row.download_count ?? 0),
  };
}

function mapCaseRow(row: Record<string, unknown>, files: EvidenceFile[]): CaseStudy {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    category: String(row.category),
    difficulty: row.difficulty as CaseStudy['difficulty'],
    briefing: String(row.briefing),
    objectives: Array.isArray(row.objectives) ? (row.objectives as string[]) : [],
    status: row.status as CaseStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    files,
  };
}

function mapUserRow(row: Record<string, unknown>): StoredUser {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    collegeId: String(row.college_id ?? 'SIMATS'),
    teamId: row.team_id ? String(row.team_id) : null,
    passwordHash: String(row.password_hash),
    createdAt: String(row.created_at),
  };
}

function mapSubmissionRow(row: Record<string, unknown>): Submission {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    teamCode: String(row.team_code),
    teamName: String(row.team_name),
    caseId: String(row.case_id),
    caseCode: String(row.case_code),
    caseTitle: String(row.case_title),
    summary: String(row.summary),
    methodology: String(row.methodology),
    fileName: String(row.file_name),
    storedName: String(row.stored_name),
    extension: String(row.extension),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    submittedAt: String(row.submitted_at),
    status: row.status as SubmissionStatus,
    score: row.score !== null && row.score !== undefined ? Number(row.score) : null,
    judgeFeedback: String(row.judge_feedback ?? ''),
    evaluatedAt: row.evaluated_at ? String(row.evaluated_at) : null,
  };
}

function mapActivityRow(row: Record<string, unknown>): ActivityLog {
  return {
    id: String(row.id),
    type: row.type as ActivityLog['type'],
    teamCode: String(row.team_code),
    teamName: String(row.team_name),
    caseCode: row.case_code ? String(row.case_code) : undefined,
    fileName: row.file_name ? String(row.file_name) : undefined,
    details: String(row.details),
    timestamp: String(row.timestamp),
  };
}

// ---------------- REPOSITORY OPERATIONS ----------------

export async function listCases(includeDrafts: boolean): Promise<CaseStudy[]> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    return includeDrafts ? db.cases : db.cases.filter((c) => c.status === 'published');
  }

  const sb = getSupabase();
  let query = sb.from('cases').select('*').order('created_at', { ascending: false });
  if (!includeDrafts) {
    query = query.eq('status', 'published');
  }
  const { data: caseRows, error } = await query;
  if (error || !caseRows) return [];

  const { data: fileRows } = await sb
    .from('evidence_files')
    .select('*')
    .order('uploaded_at', { ascending: true });

  const filesByCase = new Map<string, EvidenceFile[]>();
  for (const row of fileRows ?? []) {
    const cid = String(row.case_id);
    const list = filesByCase.get(cid) ?? [];
    list.push(mapEvidenceRow(row));
    filesByCase.set(cid, list);
  }

  return caseRows.map((row) => mapCaseRow(row, filesByCase.get(String(row.id)) ?? []));
}

export async function findCaseById(caseId: string): Promise<CaseStudy | null> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    return getLocalDb().cases.find((c) => c.id === caseId) ?? null;
  }

  const sb = getSupabase();
  const { data: row } = await sb.from('cases').select('*').eq('id', caseId).maybeSingle();
  if (!row) return null;

  const { data: fileRows } = await sb
    .from('evidence_files')
    .select('*')
    .eq('case_id', caseId)
    .order('uploaded_at', { ascending: true });

  return mapCaseRow(row, (fileRows ?? []).map(mapEvidenceRow));
}

export async function createCaseRecord(caseItem: CaseStudy): Promise<CaseStudy> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    db.cases.unshift(caseItem);
    saveLocalDb(db);
    return caseItem;
  }

  const sb = getSupabase();
  await sb.from('cases').insert({
    id: caseItem.id,
    code: caseItem.code,
    title: caseItem.title,
    category: caseItem.category,
    difficulty: caseItem.difficulty,
    briefing: caseItem.briefing,
    objectives: caseItem.objectives,
    status: caseItem.status,
    created_at: caseItem.createdAt,
    updated_at: caseItem.updatedAt,
  });

  if (caseItem.files.length > 0) {
    await sb.from('evidence_files').insert(
      caseItem.files.map((f) => ({
        id: f.id,
        case_id: caseItem.id,
        original_name: f.originalName,
        stored_name: f.storedName,
        extension: f.extension,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes,
        sha256: f.sha256,
        uploaded_at: f.uploadedAt,
        download_count: f.downloadCount,
      }))
    );
  }
  return caseItem;
}

export async function addEvidenceFilesToCase(
  caseId: string,
  files: EvidenceFile[]
): Promise<CaseStudy | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const caseItem = db.cases.find((c) => c.id === caseId);
    if (!caseItem) return null;
    caseItem.files.push(...files);
    caseItem.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    return caseItem;
  }

  const sb = getSupabase();
  await sb.from('evidence_files').insert(
    files.map((f) => ({
      id: f.id,
      case_id: caseId,
      original_name: f.originalName,
      stored_name: f.storedName,
      extension: f.extension,
      mime_type: f.mimeType,
      size_bytes: f.sizeBytes,
      sha256: f.sha256,
      uploaded_at: f.uploadedAt,
      download_count: f.downloadCount,
    }))
  );
  await sb.from('cases').update({ updated_at: new Date().toISOString() }).eq('id', caseId);
  return findCaseById(caseId);
}

export async function updateCaseRecord(
  caseId: string,
  patch: { status?: CaseStatus; title?: string; briefing?: string }
): Promise<CaseStudy | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const caseItem = db.cases.find((c) => c.id === caseId);
    if (!caseItem) return null;
    if (patch.status) caseItem.status = patch.status;
    if (patch.title) caseItem.title = patch.title;
    if (patch.briefing) caseItem.briefing = patch.briefing;
    caseItem.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    return caseItem;
  }

  const sb = getSupabase();
  const updateObj: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) updateObj.status = patch.status;
  if (patch.title) updateObj.title = patch.title;
  if (patch.briefing) updateObj.briefing = patch.briefing;
  await sb.from('cases').update(updateObj).eq('id', caseId);
  return findCaseById(caseId);
}

export async function deleteStorageObject(
  folder: 'evidence' | 'submissions',
  storedName: string
): Promise<void> {
  if (!USE_SUPABASE) {
    const dir = folder === 'evidence' ? EVIDENCE_DIR : SUBMISSIONS_DIR;
    const fullPath = path.join(dir, storedName);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    return;
  }
  const sb = getSupabase();
  await sb.storage.from(BUCKET_NAME).remove([storedName]);
}

export async function deleteEvidenceFileFromCase(
  caseId: string,
  fileId: string
): Promise<CaseStudy | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const caseItem = db.cases.find((c) => c.id === caseId);
    if (!caseItem) return null;
    const idx = caseItem.files.findIndex((f) => f.id === fileId);
    if (idx === -1) return null;
    const [removed] = caseItem.files.splice(idx, 1);
    await deleteStorageObject('evidence', removed.storedName);
    caseItem.updatedAt = new Date().toISOString();
    saveLocalDb(db);
    return caseItem;
  }

  const sb = getSupabase();
  const { data: fileRow } = await sb
    .from('evidence_files')
    .select('stored_name')
    .eq('id', fileId)
    .eq('case_id', caseId)
    .maybeSingle();
  if (!fileRow) return null;
  await sb.from('evidence_files').delete().eq('id', fileId).eq('case_id', caseId);
  await deleteStorageObject('evidence', String(fileRow.stored_name));
  await sb.from('cases').update({ updated_at: new Date().toISOString() }).eq('id', caseId);
  return findCaseById(caseId);
}

export async function deleteCaseRecord(caseId: string): Promise<boolean> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const idx = db.cases.findIndex((c) => c.id === caseId);
    if (idx === -1) return false;
    const [removed] = db.cases.splice(idx, 1);
    for (const f of removed.files) {
      await deleteStorageObject('evidence', f.storedName);
    }
    saveLocalDb(db);
    return true;
  }

  const caseItem = await findCaseById(caseId);
  if (!caseItem) return false;
  for (const f of caseItem.files) {
    await deleteStorageObject('evidence', f.storedName);
  }
  const sb = getSupabase();
  await sb.from('cases').delete().eq('id', caseId);
  return true;
}

export async function incrementFileDownloadCount(
  caseId: string,
  fileId: string,
  currentCount: number
): Promise<void> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const caseItem = db.cases.find((c) => c.id === caseId);
    const fileItem = caseItem?.files.find((f) => f.id === fileId);
    if (fileItem) {
      fileItem.downloadCount += 1;
      saveLocalDb(db);
    }
    return;
  }
  const sb = getSupabase();
  await sb
    .from('evidence_files')
    .update({ download_count: currentCount + 1 })
    .eq('id', fileId)
    .eq('case_id', caseId);
}

// ---------------- USERS ----------------

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  await ensureInitialized();
  const normalized = email.trim().toLowerCase();
  if (!USE_SUPABASE) {
    return getLocalDb().users.find((u) => u.email.toLowerCase() === normalized) ?? null;
  }
  const sb = getSupabase();
  const { data } = await sb.from('users').select('*').ilike('email', normalized).maybeSingle();
  return data ? mapUserRow(data) : null;
}

export async function findUserById(userId: string): Promise<StoredUser | null> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    return getLocalDb().users.find((u) => u.id === userId) ?? null;
  }
  const sb = getSupabase();
  const { data } = await sb.from('users').select('*').eq('id', userId).maybeSingle();
  return data ? mapUserRow(data) : null;
}

export async function createUserRecord(user: StoredUser): Promise<StoredUser> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    db.users.push(user);
    saveLocalDb(db);
    return user;
  }
  const sb = getSupabase();
  await sb.from('users').insert({
    id: user.id,
    name: user.name,
    email: user.email,
    college_id: user.collegeId,
    team_id: user.teamId,
    password_hash: user.passwordHash,
    created_at: user.createdAt,
  });
  return user;
}

export async function updateUserRecord(
  userId: string,
  patch: Partial<Pick<StoredUser, 'name' | 'collegeId' | 'teamId' | 'passwordHash'>>
): Promise<StoredUser | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const user = db.users.find((u) => u.id === userId);
    if (!user) return null;
    if (patch.name !== undefined) user.name = patch.name;
    if (patch.collegeId !== undefined) user.collegeId = patch.collegeId;
    if (patch.teamId !== undefined) user.teamId = patch.teamId;
    if (patch.passwordHash !== undefined) user.passwordHash = patch.passwordHash;
    saveLocalDb(db);
    return user;
  }

  const sb = getSupabase();
  const updateObj: Record<string, unknown> = {};
  if (patch.name !== undefined) updateObj.name = patch.name;
  if (patch.collegeId !== undefined) updateObj.college_id = patch.collegeId;
  if (patch.teamId !== undefined) updateObj.team_id = patch.teamId;
  if (patch.passwordHash !== undefined) updateObj.password_hash = patch.passwordHash;
  await sb.from('users').update(updateObj).eq('id', userId);
  return findUserById(userId);
}

// ---------------- TEAMS ----------------

async function hydrateSupabaseTeams(teamRows: Record<string, unknown>[]): Promise<Team[]> {
  if (teamRows.length === 0) return [];
  const sb = getSupabase();
  const teamIds = teamRows.map((t) => String(t.id));

  const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
    sb.from('team_members').select('*').in('team_id', teamIds),
    sb.from('team_invites').select('*').in('team_id', teamIds),
  ]);

  const membersByTeam = new Map<string, TeamMember[]>();
  for (const m of memberRows ?? []) {
    const tid = String(m.team_id);
    const list = membersByTeam.get(tid) ?? [];
    list.push({
      userId: String(m.user_id),
      name: String(m.name),
      email: String(m.email),
      role: (m.role === 'Leader' ? 'Leader' : 'Member') as TeamMember['role'],
      joinedAt: String(m.joined_at),
    });
    membersByTeam.set(tid, list);
  }

  const invitesByTeam = new Map<string, TeamInvite[]>();
  for (const inv of inviteRows ?? []) {
    const tid = String(inv.team_id);
    const list = invitesByTeam.get(tid) ?? [];
    list.push({
      id: String(inv.id),
      email: String(inv.email),
      invitedBy: String(inv.invited_by),
      createdAt: String(inv.created_at),
    });
    invitesByTeam.set(tid, list);
  }

  return teamRows.map((row) => ({
    id: String(row.id),
    teamCode: String(row.team_code),
    teamName: String(row.team_name),
    inviteCode: String(row.invite_code),
    leaderId: String(row.leader_id),
    leaderEmail: String(row.leader_email),
    members: String(row.members ?? ''),
    membersList: membersByTeam.get(String(row.id)) ?? [],
    pendingInvites: invitesByTeam.get(String(row.id)) ?? [],
    createdAt: String(row.created_at),
    lastActiveAt: String(row.last_active_at),
  }));
}

export async function listTeams(): Promise<Team[]> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    return getLocalDb().teams;
  }
  const sb = getSupabase();
  const { data } = await sb.from('teams').select('*').order('created_at', { ascending: true });
  return hydrateSupabaseTeams(data ?? []);
}

export async function findTeamById(teamId: string): Promise<Team | null> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    return getLocalDb().teams.find((t) => t.id === teamId) ?? null;
  }
  const sb = getSupabase();
  const { data } = await sb.from('teams').select('*').eq('id', teamId).maybeSingle();
  if (!data) return null;
  const hydrated = await hydrateSupabaseTeams([data]);
  return hydrated[0] ?? null;
}

export async function findTeamByCodeOrInvite(code: string): Promise<Team | null> {
  await ensureInitialized();
  const upper = code.trim().toUpperCase();
  if (!USE_SUPABASE) {
    return (
      getLocalDb().teams.find(
        (t) => t.teamCode.toUpperCase() === upper || t.inviteCode.toUpperCase() === upper
      ) ?? null
    );
  }
  const sb = getSupabase();
  const { data } = await sb
    .from('teams')
    .select('*')
    .or(`team_code.ilike.${upper},invite_code.ilike.${upper}`)
    .maybeSingle();
  if (!data) return null;
  const hydrated = await hydrateSupabaseTeams([data]);
  return hydrated[0] ?? null;
}

export async function createTeamRecord(team: Team): Promise<Team> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    db.teams.push(team);
    saveLocalDb(db);
    return team;
  }
  const sb = getSupabase();
  await sb.from('teams').insert({
    id: team.id,
    team_code: team.teamCode,
    team_name: team.teamName,
    invite_code: team.inviteCode,
    leader_id: team.leaderId,
    leader_email: team.leaderEmail,
    members: team.members,
    created_at: team.createdAt,
    last_active_at: team.lastActiveAt,
  });
  if (team.membersList.length > 0) {
    await sb.from('team_members').insert(
      team.membersList.map((m) => ({
        team_id: team.id,
        user_id: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
        joined_at: m.joinedAt,
      }))
    );
  }
  return team;
}

export async function addMemberToTeam(
  teamId: string,
  member: TeamMember,
  userEmail: string
): Promise<Team | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const team = db.teams.find((t) => t.id === teamId);
    if (!team) return null;
    if (!team.membersList.some((m) => m.userId === member.userId)) {
      team.membersList.push(member);
    }
    team.members = team.membersList.map((m) => m.name).join(', ');
    team.lastActiveAt = new Date().toISOString();
    team.pendingInvites = team.pendingInvites.filter(
      (i) => i.email.toLowerCase() !== userEmail.toLowerCase()
    );
    saveLocalDb(db);
    return team;
  }

  const sb = getSupabase();
  await sb.from('team_members').upsert({
    team_id: teamId,
    user_id: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    joined_at: member.joinedAt,
  });
  await sb
    .from('team_invites')
    .delete()
    .eq('team_id', teamId)
    .ilike('email', userEmail.trim().toLowerCase());

  const updated = await findTeamById(teamId);
  if (updated) {
    const membersStr = updated.membersList.map((m) => m.name).join(', ');
    await sb
      .from('teams')
      .update({ members: membersStr, last_active_at: new Date().toISOString() })
      .eq('id', teamId);
    updated.members = membersStr;
  }
  return updated;
}

export async function syncMemberNameInTeam(
  teamId: string,
  userId: string,
  newName: string
): Promise<void> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const team = db.teams.find((t) => t.id === teamId);
    if (team) {
      const m = team.membersList.find((item) => item.userId === userId);
      if (m) m.name = newName;
      team.members = team.membersList.map((item) => item.name).join(', ');
      saveLocalDb(db);
    }
    return;
  }
  const sb = getSupabase();
  await sb.from('team_members').update({ name: newName }).eq('team_id', teamId).eq('user_id', userId);
  const team = await findTeamById(teamId);
  if (team) {
    const membersStr = team.membersList.map((m) => m.name).join(', ');
    await sb.from('teams').update({ members: membersStr }).eq('id', teamId);
  }
}

export async function addInviteToTeam(
  teamId: string,
  invite: TeamInvite
): Promise<Team | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const team = db.teams.find((t) => t.id === teamId);
    if (!team) return null;
    team.pendingInvites.push(invite);
    team.lastActiveAt = new Date().toISOString();
    saveLocalDb(db);
    return team;
  }
  const sb = getSupabase();
  await sb.from('team_invites').insert({
    id: invite.id,
    team_id: teamId,
    email: invite.email,
    invited_by: invite.invitedBy,
    created_at: invite.createdAt,
  });
  await sb.from('teams').update({ last_active_at: new Date().toISOString() }).eq('id', teamId);
  return findTeamById(teamId);
}

export async function touchTeamLastActive(teamId: string): Promise<void> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const team = db.teams.find((t) => t.id === teamId);
    if (team) {
      team.lastActiveAt = new Date().toISOString();
      saveLocalDb(db);
    }
    return;
  }
  const sb = getSupabase();
  await sb.from('teams').update({ last_active_at: new Date().toISOString() }).eq('id', teamId);
}

export async function getPendingInvitesForEmail(email: string): Promise<PendingInviteSummary[]> {
  await ensureInitialized();
  const normalized = email.trim().toLowerCase();
  const teams = await listTeams();
  const list: PendingInviteSummary[] = [];
  for (const team of teams) {
    for (const inv of team.pendingInvites) {
      if (inv.email.toLowerCase() === normalized) {
        list.push({
          teamId: team.id,
          teamCode: team.teamCode,
          teamName: team.teamName,
          inviteCode: team.inviteCode,
          invitedBy: inv.invitedBy,
          createdAt: inv.createdAt,
        });
      }
    }
  }
  return list;
}

// ---------------- SUBMISSIONS ----------------

export async function listSubmissions(teamId?: string): Promise<Submission[]> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    const subs = getLocalDb().submissions;
    return teamId ? subs.filter((s) => s.teamId === teamId) : subs;
  }
  const sb = getSupabase();
  let query = sb.from('submissions').select('*').order('submitted_at', { ascending: false });
  if (teamId) query = query.eq('team_id', teamId);
  const { data } = await query;
  return (data ?? []).map(mapSubmissionRow);
}

export async function findSubmissionById(id: string): Promise<Submission | null> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    return getLocalDb().submissions.find((s) => s.id === id) ?? null;
  }
  const sb = getSupabase();
  const { data } = await sb.from('submissions').select('*').eq('id', id).maybeSingle();
  return data ? mapSubmissionRow(data) : null;
}

export async function createSubmissionRecord(sub: Submission): Promise<Submission> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    db.submissions.unshift(sub);
    saveLocalDb(db);
    return sub;
  }
  const sb = getSupabase();
  await sb.from('submissions').insert({
    id: sub.id,
    team_id: sub.teamId,
    team_code: sub.teamCode,
    team_name: sub.teamName,
    case_id: sub.caseId,
    case_code: sub.caseCode,
    case_title: sub.caseTitle,
    summary: sub.summary,
    methodology: sub.methodology,
    file_name: sub.fileName,
    stored_name: sub.storedName,
    extension: sub.extension,
    mime_type: sub.mimeType,
    size_bytes: sub.sizeBytes,
    sha256: sub.sha256,
    submitted_at: sub.submittedAt,
    status: sub.status,
    score: sub.score,
    judge_feedback: sub.judgeFeedback,
    evaluated_at: sub.evaluatedAt,
  });
  return sub;
}

export async function evaluateSubmissionRecord(
  id: string,
  patch: { status?: SubmissionStatus; score?: number | null; judgeFeedback?: string }
): Promise<Submission | null> {
  if (!USE_SUPABASE) {
    const db = getLocalDb();
    const sub = db.submissions.find((s) => s.id === id);
    if (!sub) return null;
    if (patch.status) sub.status = patch.status;
    if (patch.score !== undefined) sub.score = patch.score;
    if (patch.judgeFeedback !== undefined) sub.judgeFeedback = patch.judgeFeedback;
    sub.evaluatedAt = new Date().toISOString();
    saveLocalDb(db);
    return sub;
  }

  const sb = getSupabase();
  const updateObj: Record<string, unknown> = { evaluated_at: new Date().toISOString() };
  if (patch.status) updateObj.status = patch.status;
  if (patch.score !== undefined) updateObj.score = patch.score;
  if (patch.judgeFeedback !== undefined) updateObj.judge_feedback = patch.judgeFeedback;
  await sb.from('submissions').update(updateObj).eq('id', id);
  return findSubmissionById(id);
}

// ---------------- ACTIVITIES & STATS ----------------

export async function listActivities(): Promise<ActivityLog[]> {
  await ensureInitialized();
  if (!USE_SUPABASE) {
    return getLocalDb().activities;
  }
  const sb = getSupabase();
  const { data } = await sb
    .from('activities')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(500);
  return (data ?? []).map(mapActivityRow);
}

export async function appendActivity(
  entry: Omit<ActivityLog, 'id' | 'timestamp'>
): Promise<ActivityLog> {
  const activity: ActivityLog = {
    id: `act-${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  if (!USE_SUPABASE) {
    const db = getLocalDb();
    db.activities.unshift(activity);
    if (db.activities.length > 500) {
      db.activities = db.activities.slice(0, 500);
    }
    saveLocalDb(db);
    return activity;
  }

  const sb = getSupabase();
  await sb.from('activities').insert({
    id: activity.id,
    type: activity.type,
    team_code: activity.teamCode,
    team_name: activity.teamName,
    case_code: activity.caseCode ?? null,
    file_name: activity.fileName ?? null,
    details: activity.details,
    timestamp: activity.timestamp,
  });
  return activity;
}

export async function computeAdminStats(): Promise<AdminStats> {
  const [cases, teams, submissions] = await Promise.all([
    listCases(true),
    listTeams(),
    listSubmissions(),
  ]);

  const totalEvidenceFiles = cases.reduce((acc, item) => acc + item.files.length, 0);
  const totalDownloads = cases.reduce(
    (acc, item) => acc + item.files.reduce((sum, f) => sum + f.downloadCount, 0),
    0
  );
  const pendingEvaluations = submissions.filter((s) => s.status !== 'Evaluated').length;

  return {
    totalCases: cases.length,
    publishedCases: cases.filter((c) => c.status === 'published').length,
    totalEvidenceFiles,
    totalTeams: teams.length,
    totalDownloads,
    totalSubmissions: submissions.length,
    pendingEvaluations,
  };
}

// ---------------- SUPABASE STORAGE SIGNED URLS ----------------

export async function createSignedUpload(
  folder: 'evidence' | 'submissions',
  originalName: string
): Promise<{ storagePath: string; signedUrl: string; token: string }> {
  const safeExt = path.extname(originalName).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
  const storagePath = `${folder}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(BUCKET_NAME).createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create signed upload URL');
  }
  return {
    storagePath: data.path,
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

export async function createSignedDownload(
  storagePath: string,
  downloadFilename: string
): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 120, { download: downloadFilename });
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? 'Failed to create signed download URL');
  }
  return data.signedUrl;
}
