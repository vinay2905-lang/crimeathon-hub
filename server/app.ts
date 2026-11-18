import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import type {
  CaseDifficulty,
  CaseStatus,
  CaseStudy,
  EvidenceFile,
  ParticipantUser,
  Submission,
  SubmissionStatus,
  Team,
} from '../src/types.ts';
import { hashPassword, sha256Buffer, verifyPassword } from './seedData.ts';
import {
  addEvidenceFilesToCase,
  addInviteToTeam,
  addMemberToTeam,
  appendActivity,
  computeAdminStats,
  createCaseRecord,
  createSignedDownload,
  createSignedUpload,
  createSubmissionRecord,
  createTeamRecord,
  createUserRecord,
  deleteCaseRecord,
  deleteEvidenceFileFromCase,
  EVIDENCE_DIR,
  ensureInitialized,
  evaluateSubmissionRecord,
  findCaseById,
  findSubmissionById,
  findTeamByCodeOrInvite,
  findTeamById,
  findUserByEmail,
  findUserById,
  getPendingInvitesForEmail,
  getSigningSecret,
  getSupabaseDiagnostics,
  incrementFileDownloadCount,
  isSupabaseMode,
  listActivities,
  listCases,
  listSubmissions,
  listTeams,
  SUBMISSIONS_DIR,
  syncMemberNameInTeam,
  touchTeamLastActive,
  updateCaseRecord,
  updateUserRecord,
  type StoredUser,
} from './store.ts';

const ADMIN_EMAIL = 'crimeathonadmin@gmail.com';
const ADMIN_PASS = 'crimeathonadmin@12345';

interface UploadedFileMetadata {
  originalName: string;
  storedName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

function signPayload(data: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifySignedToken(token: string | undefined): Record<string, unknown> | null {
  if (!token || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function createAdminToken(email: string): string {
  return signPayload({ email, role: 'admin', iat: Date.now() });
}

function verifyAdminToken(token: string | undefined): boolean {
  const decoded = verifySignedToken(token);
  return Boolean(decoded && decoded.email === ADMIN_EMAIL && decoded.role === 'admin');
}

function createParticipantToken(userId: string, email: string): string {
  return signPayload({ userId, email, role: 'participant', iat: Date.now() });
}

function verifyParticipantToken(
  token: string | undefined
): { userId: string; email: string } | null {
  const decoded = verifySignedToken(token);
  if (
    decoded &&
    decoded.role === 'participant' &&
    typeof decoded.userId === 'string' &&
    typeof decoded.email === 'string'
  ) {
    return { userId: decoded.userId, email: decoded.email };
  }
  return null;
}

function extractBearer(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return undefined;
  return auth.slice(7).trim();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!verifyAdminToken(extractBearer(req))) {
    res.status(401).json({ error: 'Unauthorized. Valid administrator credentials required.' });
    return;
  }
  next();
}

async function getAuthenticatedParticipant(req: Request): Promise<StoredUser | null> {
  const parsed = verifyParticipantToken(extractBearer(req));
  if (!parsed) return null;
  return findUserById(parsed.userId);
}

function sanitizeUser(user: StoredUser): ParticipantUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    collegeId: user.collegeId,
    teamId: user.teamId,
    createdAt: user.createdAt,
  };
}

function generateTeamCode(existingTeams: Team[]): string {
  const used = new Set(existingTeams.map((t) => t.teamCode));
  let idx = 103;
  while (used.has(`TEAM-${idx}`)) {
    idx += 1;
  }
  return `TEAM-${idx}`;
}

function generateInviteCode(): string {
  return `INV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const evidenceUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, EVIDENCE_DIR),
      filename: (_req, file, cb) => {
        const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  const submissionUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, SUBMISSIONS_DIR),
      filename: (_req, file, cb) => {
        const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  const optionalEvidenceMulter = (req: Request, res: Response, next: NextFunction) => {
    if (req.is('multipart/form-data')) {
      evidenceUpload.array('files', 15)(req, res, next);
      return;
    }
    next();
  };

  const optionalSubmissionMulter = (req: Request, res: Response, next: NextFunction) => {
    if (req.is('multipart/form-data')) {
      submissionUpload.single('reportFile')(req, res, next);
      return;
    }
    next();
  };

  app.get('/api/health', async (_req, res) => {
    await ensureInitialized();
    const diag = getSupabaseDiagnostics();
    res.json({
      ok: true,
      service: 'Crimeathon Hub',
      storageMode: isSupabaseMode() ? 'supabase' : 'local',
      supabaseSchemaReady: diag.configured ? diag.schemaError === null : null,
      supabaseSchemaError: diag.schemaError,
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      storageMode: isSupabaseMode() ? 'supabase' : 'local',
    });
  });

  // ---------------- PARTICIPANT AUTH & PROFILE ----------------

  app.post('/api/participants/register', async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const collegeId = String(req.body?.collegeId ?? '').trim();

      if (!name || !email || !password) {
        res.status(400).json({ error: 'Full name, email, and password are required.' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        return;
      }
      const existing = await findUserByEmail(email);
      if (existing) {
        res.status(409).json({
          error: 'An account with this email already exists. Please sign in instead.',
        });
        return;
      }

      const newUser: StoredUser = {
        id: `user-${crypto.randomUUID().slice(0, 8)}`,
        name,
        email,
        collegeId: collegeId || 'SIMATS',
        teamId: null,
        createdAt: new Date().toISOString(),
        passwordHash: hashPassword(password),
      };
      await createUserRecord(newUser);
      await appendActivity({
        type: 'PARTICIPANT_REGISTER',
        teamCode: 'UNASSIGNED',
        teamName: newUser.name,
        details: `Participant ${newUser.name} (${newUser.email}) created an account`,
      });

      const token = createParticipantToken(newUser.id, newUser.email);
      const invites = await getPendingInvitesForEmail(newUser.email);
      res.status(201).json({
        token,
        user: sanitizeUser(newUser),
        team: null,
        invites,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Registration failed.',
      });
    }
  });

  app.post('/api/participants/login', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const user = await findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ error: 'Invalid participant email or password.' });
        return;
      }

      const team = user.teamId ? await findTeamById(user.teamId) : null;
      if (team) {
        await touchTeamLastActive(team.id);
      }

      await appendActivity({
        type: 'PARTICIPANT_LOGIN',
        teamCode: team?.teamCode ?? 'UNASSIGNED',
        teamName: team?.teamName ?? user.name,
        details: `${user.name} (${user.email}) signed into the participant portal`,
      });

      const token = createParticipantToken(user.id, user.email);
      const invites = await getPendingInvitesForEmail(user.email);
      res.json({
        token,
        user: sanitizeUser(user),
        team,
        invites,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Login failed.',
      });
    }
  });

  app.get('/api/participants/me', async (req, res) => {
    const user = await getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Participant session required.' });
      return;
    }
    const team = user.teamId ? await findTeamById(user.teamId) : null;
    const invites = await getPendingInvitesForEmail(user.email);
    res.json({ user: sanitizeUser(user), team, invites });
  });

  app.patch('/api/participants/profile', async (req, res) => {
    const user = await getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Participant session required.' });
      return;
    }
    const name = String(req.body?.name ?? '').trim();
    const collegeId = String(req.body?.collegeId ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Full name cannot be empty.' });
      return;
    }
    const updated = await updateUserRecord(user.id, {
      name,
      collegeId: collegeId || user.collegeId,
    });
    if (user.teamId) {
      await syncMemberNameInTeam(user.teamId, user.id, name);
    }
    res.json({ user: sanitizeUser(updated ?? user) });
  });

  app.patch('/api/participants/password', async (req, res) => {
    const user = await getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Participant session required.' });
      return;
    }
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters.' });
      return;
    }

    await updateUserRecord(user.id, { passwordHash: hashPassword(newPassword) });
    res.json({ ok: true });
  });

  // ---------------- TEAM CREATION, INVITE & JOIN ----------------

  app.post('/api/teams/create', async (req, res) => {
    const user = await getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Please sign in before creating a team.' });
      return;
    }
    if (user.teamId) {
      res.status(400).json({ error: 'You already belong to a team.' });
      return;
    }

    const teamName = String(req.body?.teamName ?? '').trim();
    const requestedCode = String(req.body?.teamCode ?? '').trim().toUpperCase();
    if (!teamName) {
      res.status(400).json({ error: 'Team Name is required.' });
      return;
    }

    const existingTeams = await listTeams();
    const teamCode = requestedCode || generateTeamCode(existingTeams);
    if (existingTeams.some((t) => t.teamCode === teamCode)) {
      res.status(409).json({ error: `Team Code ${teamCode} is already taken.` });
      return;
    }

    const nowIso = new Date().toISOString();
    const newTeam: Team = {
      id: `team-${crypto.randomUUID().slice(0, 8)}`,
      teamCode,
      teamName,
      inviteCode: generateInviteCode(),
      leaderId: user.id,
      leaderEmail: user.email,
      members: user.name,
      membersList: [
        {
          userId: user.id,
          name: user.name,
          email: user.email,
          role: 'Leader',
          joinedAt: nowIso,
        },
      ],
      pendingInvites: [],
      createdAt: nowIso,
      lastActiveAt: nowIso,
    };

    await createTeamRecord(newTeam);
    const updatedUser = await updateUserRecord(user.id, { teamId: newTeam.id });

    await appendActivity({
      type: 'TEAM_CREATED',
      teamCode: newTeam.teamCode,
      teamName: newTeam.teamName,
      details: `${user.name} created team ${newTeam.teamName} (${newTeam.teamCode})`,
    });

    res.status(201).json({ team: newTeam, user: sanitizeUser(updatedUser ?? user) });
  });

  app.post('/api/teams/join', async (req, res) => {
    const user = await getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Please sign in before joining a team.' });
      return;
    }
    if (user.teamId) {
      res.status(400).json({ error: 'You are already part of a team.' });
      return;
    }

    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: 'Enter a Team Code or Invite Code to join.' });
      return;
    }

    const team = await findTeamByCodeOrInvite(code);
    if (!team) {
      res.status(404).json({ error: 'No team found matching that Team Code or Invite Code.' });
      return;
    }

    const updatedTeam = await addMemberToTeam(
      team.id,
      {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: 'Member',
        joinedAt: new Date().toISOString(),
      },
      user.email
    );
    const updatedUser = await updateUserRecord(user.id, { teamId: team.id });

    await appendActivity({
      type: 'TEAM_JOINED',
      teamCode: team.teamCode,
      teamName: team.teamName,
      details: `${user.name} joined team ${team.teamName} (${team.teamCode})`,
    });

    res.json({ team: updatedTeam ?? team, user: sanitizeUser(updatedUser ?? user) });
  });

  app.post('/api/teams/invite', async (req, res) => {
    const user = await getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Participant session required.' });
      return;
    }
    if (!user.teamId) {
      res.status(400).json({ error: 'Create or join a team before sending invitations.' });
      return;
    }

    const team = await findTeamById(user.teamId);
    if (!team) {
      res.status(404).json({ error: 'Team not found.' });
      return;
    }

    const inviteEmail = String(req.body?.email ?? '').trim().toLowerCase();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      res.status(400).json({ error: 'Enter a valid teammate email address.' });
      return;
    }

    if (team.membersList.some((m) => m.email.toLowerCase() === inviteEmail)) {
      res.status(400).json({ error: 'This participant is already in your team.' });
      return;
    }
    if (team.pendingInvites.some((i) => i.email.toLowerCase() === inviteEmail)) {
      res.status(400).json({ error: 'An invitation has already been sent to this email.' });
      return;
    }

    const updatedTeam = await addInviteToTeam(team.id, {
      id: `inv-${crypto.randomUUID().slice(0, 8)}`,
      email: inviteEmail,
      invitedBy: user.name,
      createdAt: new Date().toISOString(),
    });

    await appendActivity({
      type: 'TEAM_INVITE_SENT',
      teamCode: team.teamCode,
      teamName: team.teamName,
      details: `${user.name} invited ${inviteEmail} to join ${team.teamName}`,
    });

    res.json({ team: updatedTeam ?? team });
  });

  // ---------------- ADMIN AUTH ----------------

  app.post('/api/admin/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASS) {
      res.status(401).json({ error: 'Invalid administrator email or password.' });
      return;
    }
    const token = createAdminToken(ADMIN_EMAIL);
    res.json({ token, email: ADMIN_EMAIL });
  });

  app.get('/api/admin/session', (req, res) => {
    const valid = verifyAdminToken(extractBearer(req));
    res.json({ authenticated: valid, email: valid ? ADMIN_EMAIL : null });
  });

  app.post('/api/admin/logout', (_req, res) => {
    res.json({ ok: true });
  });

  // ---------------- CASES & EVIDENCE ----------------

  app.get('/api/cases', async (req, res) => {
    const isAdmin = verifyAdminToken(extractBearer(req));
    const cases = await listCases(isAdmin);
    res.json({ cases });
  });

  app.get('/api/cases/:caseId/files/:fileId/download', async (req, res) => {
    const caseItem = await findCaseById(req.params.caseId);
    if (!caseItem) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }
    const isAdmin = verifyAdminToken(extractBearer(req));
    const participant = await getAuthenticatedParticipant(req);

    if (caseItem.status !== 'published' && !isAdmin) {
      res.status(403).json({ error: 'Case study is not published yet.' });
      return;
    }
    if (!isAdmin && !participant) {
      res
        .status(401)
        .json({ error: 'Please sign in as a registered participant to download case files.' });
      return;
    }

    const fileItem = caseItem.files.find((f) => f.id === req.params.fileId);
    if (!fileItem) {
      res.status(404).json({ error: 'Evidence file not found.' });
      return;
    }

    await incrementFileDownloadCount(caseItem.id, fileItem.id, fileItem.downloadCount);

    if (!isAdmin && participant) {
      const matchedTeam = participant.teamId ? await findTeamById(participant.teamId) : null;
      if (matchedTeam) {
        await touchTeamLastActive(matchedTeam.id);
      }
      await appendActivity({
        type: 'FILE_DOWNLOAD',
        teamCode: matchedTeam?.teamCode ?? 'INDIVIDUAL',
        teamName: matchedTeam?.teamName ?? participant.name,
        caseCode: caseItem.code,
        fileName: fileItem.originalName,
        details: `${participant.name} downloaded ${fileItem.originalName} from ${caseItem.code}`,
      });
    }

    if (isSupabaseMode()) {
      try {
        const signedUrl = await createSignedDownload(fileItem.storedName, fileItem.originalName);
        if (req.headers.accept?.includes('application/json') || req.query.mode === 'url') {
          res.json({ url: signedUrl, fileName: fileItem.originalName });
          return;
        }
        res.redirect(signedUrl);
        return;
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to generate download URL.',
        });
        return;
      }
    }

    const fullPath = path.join(EVIDENCE_DIR, fileItem.storedName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'File missing on storage volume.' });
      return;
    }
    res.download(fullPath, fileItem.originalName);
  });

  // ---------------- SUBMISSIONS ----------------

  app.get('/api/submissions', async (req, res) => {
    const isAdmin = verifyAdminToken(extractBearer(req));
    if (isAdmin) {
      const submissions = await listSubmissions();
      res.json({ submissions });
      return;
    }

    const participant = await getAuthenticatedParticipant(req);
    if (!participant || !participant.teamId) {
      res.json({ submissions: [] });
      return;
    }
    const filtered = await listSubmissions(participant.teamId);
    res.json({ submissions: filtered });
  });

  // Signed upload URL for participant investigation report (Supabase mode)
  app.post('/api/submissions/sign-upload', async (req, res) => {
    const participant = await getAuthenticatedParticipant(req);
    if (!participant) {
      res.status(401).json({ error: 'Please sign in to upload an investigation report.' });
      return;
    }
    if (!participant.teamId) {
      res.status(400).json({ error: 'Create or join a team before submitting a report.' });
      return;
    }
    if (!isSupabaseMode()) {
      res.status(400).json({ error: 'Signed URLs only apply in Supabase storage mode.' });
      return;
    }
    const originalName = String(req.body?.originalName ?? '').trim();
    if (!originalName) {
      res.status(400).json({ error: 'Filename is required.' });
      return;
    }
    try {
      const signed = await createSignedUpload('submissions', originalName);
      res.json(signed);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not prepare upload.',
      });
    }
  });

  app.post('/api/submissions', optionalSubmissionMulter, async (req, res) => {
    const file = req.file;
    const uploadedMeta = req.body?.uploadedFile as UploadedFileMetadata | undefined;
    const participant = await getAuthenticatedParticipant(req);

    if (!participant) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(401).json({ error: 'Please sign in to submit an investigation report.' });
      return;
    }
    if (!participant.teamId) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(400).json({ error: 'Create or join a team before submitting a report.' });
      return;
    }
    if (!file && !uploadedMeta) {
      res.status(400).json({ error: 'Please attach an investigation report file.' });
      return;
    }

    const team = await findTeamById(participant.teamId);
    if (!team) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(404).json({ error: 'Your team record could not be found.' });
      return;
    }

    const caseId = String(req.body?.caseId ?? '').trim();
    const summary = String(req.body?.summary ?? '').trim();
    const methodology = String(req.body?.methodology ?? '').trim();

    if (!caseId || !summary) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(400).json({ error: 'Case Study and Findings Summary are required.' });
      return;
    }

    const caseItem = await findCaseById(caseId);
    if (!caseItem) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      res.status(404).json({ error: 'Selected case study does not exist.' });
      return;
    }

    await touchTeamLastActive(team.id);

    let fileInfo: UploadedFileMetadata;
    if (file) {
      const fileBuf = fs.readFileSync(file.path);
      fileInfo = {
        originalName: file.originalname,
        storedName: file.filename,
        extension: path.extname(file.originalname).toLowerCase() || '.bin',
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        sha256: sha256Buffer(fileBuf),
      };
    } else {
      fileInfo = uploadedMeta!;
    }

    const submission: Submission = {
      id: `sub-${crypto.randomUUID().slice(0, 8)}`,
      teamId: team.id,
      teamCode: team.teamCode,
      teamName: team.teamName,
      caseId: caseItem.id,
      caseCode: caseItem.code,
      caseTitle: caseItem.title,
      summary,
      methodology: methodology || 'Standard forensic triage',
      fileName: fileInfo.originalName,
      storedName: fileInfo.storedName,
      extension: fileInfo.extension,
      mimeType: fileInfo.mimeType,
      sizeBytes: fileInfo.sizeBytes,
      sha256: fileInfo.sha256,
      submittedAt: new Date().toISOString(),
      status: 'Submitted',
      score: null,
      judgeFeedback: '',
      evaluatedAt: null,
    };

    await createSubmissionRecord(submission);
    await appendActivity({
      type: 'REPORT_SUBMIT',
      teamCode: team.teamCode,
      teamName: team.teamName,
      caseCode: caseItem.code,
      fileName: submission.fileName,
      details: `${participant.name} submitted ${submission.fileName} (${submission.extension}) for ${caseItem.code}`,
    });

    res.status(201).json({ submission });
  });

  app.get('/api/submissions/:submissionId/download', async (req, res) => {
    const submission = await findSubmissionById(req.params.submissionId);
    if (!submission) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }

    const isAdmin = verifyAdminToken(extractBearer(req));
    const participant = await getAuthenticatedParticipant(req);
    const isTeamOwner = Boolean(participant && participant.teamId === submission.teamId);

    if (!isAdmin && !isTeamOwner) {
      res.status(403).json({ error: 'Access denied to this submission file.' });
      return;
    }

    if (isSupabaseMode()) {
      try {
        const signedUrl = await createSignedDownload(submission.storedName, submission.fileName);
        if (req.headers.accept?.includes('application/json') || req.query.mode === 'url') {
          res.json({ url: signedUrl, fileName: submission.fileName });
          return;
        }
        res.redirect(signedUrl);
        return;
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Unable to generate download URL.',
        });
        return;
      }
    }

    const fullPath = path.join(SUBMISSIONS_DIR, submission.storedName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Submission file missing on disk.' });
      return;
    }
    res.download(fullPath, submission.fileName);
  });

  // ---------------- ADMIN OPERATIONS ----------------

  app.post('/api/admin/storage/sign-uploads', requireAdmin, async (req, res) => {
    if (!isSupabaseMode()) {
      res.status(400).json({ error: 'Signed URLs only apply in Supabase storage mode.' });
      return;
    }
    const filesInput = Array.isArray(req.body?.files)
      ? (req.body.files as { originalName?: string }[])
      : [];
    if (filesInput.length === 0) {
      res.status(400).json({ error: 'Provide at least one file to sign.' });
      return;
    }
    try {
      const uploads = await Promise.all(
        filesInput.map(async (f) => {
          const originalName = String(f.originalName ?? 'evidence.bin').trim();
          const signed = await createSignedUpload('evidence', originalName);
          return { originalName, ...signed };
        })
      );
      res.json({ uploads });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to prepare uploads.',
      });
    }
  });

  app.post('/api/admin/cases', requireAdmin, optionalEvidenceMulter, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const uploadedMeta = Array.isArray(req.body?.uploadedFiles)
      ? (req.body.uploadedFiles as UploadedFileMetadata[])
      : [];

    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const title = String(req.body?.title ?? '').trim();
    const category = String(req.body?.category ?? 'Cyber Forensics').trim();
    const difficultyRaw = String(req.body?.difficulty ?? 'Intermediate').trim();
    const briefing = String(req.body?.briefing ?? '').trim();
    const objectivesRaw = String(req.body?.objectives ?? '').trim();
    const statusRaw = String(req.body?.status ?? 'published').trim().toLowerCase();

    if (!code || !title || !briefing) {
      for (const f of files) {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      }
      res.status(400).json({ error: 'Case Code, Title, and Briefing are required.' });
      return;
    }

    const difficulty: CaseDifficulty =
      difficultyRaw === 'Foundational' || difficultyRaw === 'Advanced'
        ? difficultyRaw
        : 'Intermediate';
    const status: CaseStatus = statusRaw === 'draft' ? 'draft' : 'published';

    const nowIso = new Date().toISOString();
    const evidenceFiles: EvidenceFile[] =
      files.length > 0
        ? files.map((file) => {
            const buf = fs.readFileSync(file.path);
            return {
              id: `file-${crypto.randomUUID().slice(0, 8)}`,
              originalName: file.originalname,
              storedName: file.filename,
              extension: path.extname(file.originalname).toLowerCase() || '.bin',
              mimeType: file.mimetype || 'application/octet-stream',
              sizeBytes: file.size,
              sha256: sha256Buffer(buf),
              uploadedAt: nowIso,
              downloadCount: 0,
            };
          })
        : uploadedMeta.map((meta) => ({
            id: `file-${crypto.randomUUID().slice(0, 8)}`,
            originalName: meta.originalName,
            storedName: meta.storedName,
            extension: meta.extension,
            mimeType: meta.mimeType,
            sizeBytes: meta.sizeBytes,
            sha256: meta.sha256,
            uploadedAt: nowIso,
            downloadCount: 0,
          }));

    const objectives = objectivesRaw
      ? objectivesRaw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      : ['Analyze attached artifacts and submit complete forensic findings'];

    const newCase: CaseStudy = {
      id: `case-${crypto.randomUUID().slice(0, 8)}`,
      code,
      title,
      category,
      difficulty,
      briefing,
      objectives,
      status,
      createdAt: nowIso,
      updatedAt: nowIso,
      files: evidenceFiles,
    };

    await createCaseRecord(newCase);
    await appendActivity({
      type: status === 'published' ? 'CASE_PUBLISHED' : 'EVIDENCE_UPLOADED',
      teamCode: 'ADMIN',
      teamName: 'Crimeathon Admin',
      caseCode: newCase.code,
      details: `Created ${newCase.code}: ${newCase.title} with ${evidenceFiles.length} evidence file(s) [${status}]`,
    });

    res.status(201).json({ caseStudy: newCase });
  });

  app.post(
    '/api/admin/cases/:caseId/files',
    requireAdmin,
    optionalEvidenceMulter,
    async (req, res) => {
      const caseItem = await findCaseById(req.params.caseId);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const uploadedMeta = Array.isArray(req.body?.uploadedFiles)
        ? (req.body.uploadedFiles as UploadedFileMetadata[])
        : [];

      if (!caseItem) {
        for (const f of files) {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        }
        res.status(404).json({ error: 'Case study not found.' });
        return;
      }

      if (files.length === 0 && uploadedMeta.length === 0) {
        res.status(400).json({ error: 'Select at least one file to upload.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const added: EvidenceFile[] =
        files.length > 0
          ? files.map((file) => {
              const buf = fs.readFileSync(file.path);
              return {
                id: `file-${crypto.randomUUID().slice(0, 8)}`,
                originalName: file.originalname,
                storedName: file.filename,
                extension: path.extname(file.originalname).toLowerCase() || '.bin',
                mimeType: file.mimetype || 'application/octet-stream',
                sizeBytes: file.size,
                sha256: sha256Buffer(buf),
                uploadedAt: nowIso,
                downloadCount: 0,
              };
            })
          : uploadedMeta.map((meta) => ({
              id: `file-${crypto.randomUUID().slice(0, 8)}`,
              originalName: meta.originalName,
              storedName: meta.storedName,
              extension: meta.extension,
              mimeType: meta.mimeType,
              sizeBytes: meta.sizeBytes,
              sha256: meta.sha256,
              uploadedAt: nowIso,
              downloadCount: 0,
            }));

      const updatedCase = await addEvidenceFilesToCase(caseItem.id, added);
      await appendActivity({
        type: 'EVIDENCE_UPLOADED',
        teamCode: 'ADMIN',
        teamName: 'Crimeathon Admin',
        caseCode: caseItem.code,
        fileName: added.map((f) => f.originalName).join(', '),
        details: `Uploaded ${added.length} evidence file(s) to ${caseItem.code}`,
      });

      res.status(201).json({ caseStudy: updatedCase ?? caseItem, addedFiles: added });
    }
  );

  app.patch('/api/admin/cases/:caseId', requireAdmin, async (req, res) => {
    const nextStatus = req.body?.status;
    const statusPatch: CaseStatus | undefined =
      nextStatus === 'published' || nextStatus === 'draft' ? nextStatus : undefined;
    const titlePatch =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim()
        : undefined;
    const briefingPatch =
      typeof req.body?.briefing === 'string' && req.body.briefing.trim()
        ? req.body.briefing.trim()
        : undefined;

    const updated = await updateCaseRecord(req.params.caseId, {
      status: statusPatch,
      title: titlePatch,
      briefing: briefingPatch,
    });
    if (!updated) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }

    await appendActivity({
      type: 'CASE_PUBLISHED',
      teamCode: 'ADMIN',
      teamName: 'Crimeathon Admin',
      caseCode: updated.code,
      details: `Updated ${updated.code} status to ${updated.status}`,
    });

    res.json({ caseStudy: updated });
  });

  app.delete('/api/admin/cases/:caseId/files/:fileId', requireAdmin, async (req, res) => {
    const updated = await deleteEvidenceFileFromCase(req.params.caseId, req.params.fileId);
    if (!updated) {
      res.status(404).json({ error: 'Case study or evidence file not found.' });
      return;
    }
    res.json({ ok: true, caseStudy: updated });
  });

  app.delete('/api/admin/cases/:caseId', requireAdmin, async (req, res) => {
    const deleted = await deleteCaseRecord(req.params.caseId);
    if (!deleted) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }
    res.json({ ok: true });
  });

  app.patch('/api/admin/submissions/:submissionId/evaluate', requireAdmin, async (req, res) => {
    const status = req.body?.status as SubmissionStatus | undefined;
    const validStatus =
      status === 'Submitted' || status === 'Under Review' || status === 'Evaluated'
        ? status
        : undefined;

    let scorePatch: number | null | undefined;
    if (req.body?.score !== undefined && req.body?.score !== null && req.body?.score !== '') {
      const parsed = Number(req.body.score);
      if (!Number.isNaN(parsed)) {
        scorePatch = Math.max(0, Math.min(100, Math.round(parsed)));
      }
    } else if (req.body?.score === null || req.body?.score === '') {
      scorePatch = null;
    }

    const feedbackPatch =
      typeof req.body?.judgeFeedback === 'string' ? req.body.judgeFeedback.trim() : undefined;

    const updated = await evaluateSubmissionRecord(req.params.submissionId, {
      status: validStatus,
      score: scorePatch,
      judgeFeedback: feedbackPatch,
    });
    if (!updated) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }

    await appendActivity({
      type: 'REPORT_EVALUATED',
      teamCode: updated.teamCode,
      teamName: updated.teamName,
      caseCode: updated.caseCode,
      fileName: updated.fileName,
      details: `Judges marked ${updated.teamName} (${updated.caseCode}) as ${updated.status}${
        updated.score !== null ? ` · Score: ${updated.score}/100` : ''
      }`,
    });

    res.json({ submission: updated });
  });

  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    const [stats, activities, teams] = await Promise.all([
      computeAdminStats(),
      listActivities(),
      listTeams(),
    ]);
    res.json({ stats, activities, teams });
  });

  return app;
}
