import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import type {
  ActivityLog,
  AdminStats,
  CaseDifficulty,
  CaseStatus,
  CaseStudy,
  EvidenceFile,
  ParticipantUser,
  PendingInviteSummary,
  Submission,
  SubmissionStatus,
  Team,
} from './src/types.ts';

interface StoredUser extends ParticipantUser {
  passwordHash: string;
}

interface DatabaseSchema {
  cases: CaseStudy[];
  users: StoredUser[];
  teams: Team[];
  submissions: Submission[];
  activities: ActivityLog[];
}

const PORT = 3000;
const ADMIN_EMAIL = 'crimeathonadmin@gmail.com';
const ADMIN_PASS = 'crimeathonadmin@12345';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const SECRET_PATH = path.join(DATA_DIR, 'secret.key');
const EVIDENCE_DIR = path.join(DATA_DIR, 'uploads', 'evidence');
const SUBMISSIONS_DIR = path.join(DATA_DIR, 'uploads', 'submissions');

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });

function getSigningSecret(): string {
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret, 'utf8');
  return secret;
}

const SIGNING_SECRET = getSigningSecret();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function signPayload(data: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SIGNING_SECRET)
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
    .createHmac('sha256', SIGNING_SECRET)
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

function verifyParticipantToken(token: string | undefined): { userId: string; email: string } | null {
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
  const token = extractBearer(req);
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized. Valid administrator credentials required.' });
    return;
  }
  next();
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

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function writeSeedEvidenceFile(storedName: string, content: string): { sizeBytes: number; sha256: string } {
  const fullPath = path.join(EVIDENCE_DIR, storedName);
  const buf = Buffer.from(content, 'utf8');
  fs.writeFileSync(fullPath, buf);
  return { sizeBytes: buf.byteLength, sha256: sha256Buffer(buf) };
}

function writeSeedSubmissionFile(storedName: string, content: string): { sizeBytes: number; sha256: string } {
  const fullPath = path.join(SUBMISSIONS_DIR, storedName);
  const buf = Buffer.from(content, 'utf8');
  fs.writeFileSync(fullPath, buf);
  return { sizeBytes: buf.byteLength, sha256: sha256Buffer(buf) };
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

function syncTeamMembersString(team: Team): void {
  if (team.membersList.length > 0) {
    team.members = team.membersList.map((m) => m.name).join(', ');
  }
}

function getPendingInvitesForEmail(dbRef: DatabaseSchema, email: string): PendingInviteSummary[] {
  const normalized = email.trim().toLowerCase();
  const list: PendingInviteSummary[] = [];
  for (const team of dbRef.teams) {
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

function normalizeExistingDatabase(rawDb: Partial<DatabaseSchema>): DatabaseSchema {
  const nowIso = new Date().toISOString();
  const users: StoredUser[] = Array.isArray(rawDb.users) ? rawDb.users : [];
  const teams: Team[] = Array.isArray(rawDb.teams)
    ? rawDb.teams.map((t) => {
        const inviteCode = t.inviteCode || `INV-${t.teamCode.replace(/[^A-Z0-9]/g, '')}`;
        const membersList = Array.isArray(t.membersList) ? t.membersList : [];
        const pendingInvites = Array.isArray(t.pendingInvites) ? t.pendingInvites : [];
        return {
          ...t,
          inviteCode,
          leaderId: t.leaderId || 'user-seed',
          membersList,
          pendingInvites,
        };
      })
    : [];

  // Ensure seeded leader accounts exist if migrating an older db.json
  if (users.length === 0) {
    const team101 = teams.find((t) => t.teamCode === 'TEAM-101');
    const team102 = teams.find((t) => t.teamCode === 'TEAM-102');
    if (team101) {
      const u1: StoredUser = {
        id: 'user-101',
        name: 'Kavya R',
        email: 'kavya.r@simats.edu.in',
        collegeId: 'SIMATS-CS-101',
        teamId: team101.id,
        createdAt: team101.createdAt || nowIso,
        passwordHash: hashPassword('Cipher@123'),
      };
      users.push(u1);
      team101.leaderId = u1.id;
      if (team101.membersList.length === 0) {
        team101.membersList = [
          {
            userId: u1.id,
            name: u1.name,
            email: u1.email,
            role: 'Leader',
            joinedAt: team101.createdAt || nowIso,
          },
        ];
      }
    }
    if (team102) {
      const u2: StoredUser = {
        id: 'user-102',
        name: 'Aditya K',
        email: 'aditya.k@simats.edu.in',
        collegeId: 'SIMATS-CS-102',
        teamId: team102.id,
        createdAt: team102.createdAt || nowIso,
        passwordHash: hashPassword('Packet@123'),
      };
      users.push(u2);
      team102.leaderId = u2.id;
      if (team102.membersList.length === 0) {
        team102.membersList = [
          {
            userId: u2.id,
            name: u2.name,
            email: u2.email,
            role: 'Leader',
            joinedAt: team102.createdAt || nowIso,
          },
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

function initializeDatabase(): DatabaseSchema {
  if (fs.existsSync(DB_PATH)) {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
      const normalized = normalizeExistingDatabase(parsed);
      saveDatabase(normalized);
      return normalized;
    } catch {
      // Fall through to re-initialize if corrupt
    }
  }

  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  const f1a = writeSeedEvidenceFile(
    'seed_case01_briefing.txt',
    `CRIMEATHON INVESTIGATION DOSSIER — CASE-01: OPERATION SILENT LEDGER
Issued by: Sentrix Cyber Club · SIMATS Engineering
Classification: Hackathon Case Study Pack

1. INCIDENT SUMMARY
At 02:14 UTC, automated SIEM sensors in the FinOps Staging Cluster flagged anomalous outbound SFTP transfers followed by encrypted volume shadow deletion on host FIN-SRV-04 (10.42.8.19).

2. INVESTIGATIVE OBJECTIVES
- Identify the initial access vector and compromised service account from the auth logs.
- Trace the external C2 / exfiltration IP address and approximate byte volume.
- Correlate the suspicious treasury transfer IDs in the ledger CSV with the attack window.
- Recommend 3 immediate containment and hardening actions in your report.

3. SUBMISSION DELIVERABLE
Upload your full investigation report (PDF, DOCX, PPTX, or ZIP with artifacts) via the Crimeathon Hub Submission Desk.
`
  );

  const f1b = writeSeedEvidenceFile(
    'seed_case01_auth.log',
    `2026-11-17T01:48:11Z FIN-SRV-04 sshd[4821]: Failed password for invalid user deploy_bot from 185.220.101.44 port 51204 ssh2
2026-11-17T01:49:02Z FIN-SRV-04 sshd[4825]: Failed password for svc_treasury from 185.220.101.44 port 51299 ssh2
2026-11-17T01:51:40Z FIN-SRV-04 sshd[4840]: Accepted publickey for svc_treasury from 91.214.124.88 port 44812 ssh2: RSA SHA256:k9vT+x82LmQp
2026-11-17T01:54:12Z FIN-SRV-04 sudo[4902]: svc_treasury : TTY=pts/1 ; PWD=/var/finops ; USER=root ; COMMAND=/usr/bin/tar -czf /tmp/.cache_dump.tar.gz /var/finops/ledger_backups
2026-11-17T02:03:55Z FIN-SRV-04 sftp-server[4950]: session opened for local user svc_treasury from [91.214.124.88]
2026-11-17T02:11:19Z FIN-SRV-04 auditd[5011]: EXECVE cmd="vssadmin_sim --purge-snapshots --quiet" uid=0
2026-11-17T02:14:04Z FIN-SRV-04 siem-agent[5033]: ALERT high_entropy_write /var/finops/ledger_backups/2026_q4.db.locked
`
  );

  const f1c = writeSeedEvidenceFile(
    'seed_case01_ledger.csv',
    `tx_id,timestamp_utc,source_acct,dest_wallet_or_iban,amount_usd,initiator_user,flag_note
TX-90811,2026-11-17T01:30:10Z,ACC-4001,IBAN-IN91-0021,4200.00,arjun_fin,scheduled_vendor
TX-90812,2026-11-17T01:58:44Z,ACC-9900,bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,84500.00,svc_treasury,unapproved_offhours_sweep
TX-90813,2026-11-17T02:01:12Z,ACC-9900,bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,62000.00,svc_treasury,split_structuring
TX-90814,2026-11-17T02:15:00Z,ACC-4002,IBAN-IN91-0088,1850.00,priya_ops,payroll_batch
`
  );

  const f2a = writeSeedEvidenceFile(
    'seed_case02_overview.md',
    `# CASE-02: Phantom Payload Dispatch

**Domain:** Email Threat Forensics & Identity Compromise  
**Host Club:** Sentrix Cyber Club · SIMATS Engineering

## Scenario
Three department coordinators reported receiving an urgent "Accreditation Audit Schedule" attachment. Within 25 minutes, unauthorized inbox forwarding rules began siphoning internal correspondence to an external lookalike domain.

## Evidence Attached
- \`CASE02_Mail_Gateway_Trace.json\` — Parsed SPF/DKIM/DMARC headers, reply-to anomalies, and OAuth token grants.

## Questions Your Report Must Answer
1. Which authentication check failed on the inbound spoofed message?
2. What OAuth application ID was granted \`Mail.ReadWrite\` scope?
3. Construct an exact timeline from delivery to inbox rule creation.
`
  );

  const f2b = writeSeedEvidenceFile(
    'seed_case02_mail_trace.json',
    JSON.stringify(
      {
        incidentId: 'INC-2026-441',
        gateway: 'mx01.simats-edu.example',
        messages: [
          {
            messageId: '<88291-audit@simats-verify-portal.org>',
            from: 'Accreditation Office <audit@simats-verify-portal.org>',
            replyTo: 'audit-desk@proton-relay.invalid',
            recipient: 'coordinator.cs@simats.edu.example',
            spf: 'FAIL (sender IP 45.134.26.91 not permitted)',
            dkim: 'NONE',
            dmarc: 'FAIL',
            attachment: 'Audit_Schedule_2026.html',
            receivedAt: '2026-11-17T04:12:09Z',
          },
        ],
        identityEvents: [
          {
            timestamp: '2026-11-17T04:19:41Z',
            user: 'coordinator.cs@simats.edu.example',
            action: 'OAuthConsentGranted',
            appName: 'DocViewer Cloud Sync',
            appId: 'app-9f21c8e4-77a0',
            scopes: ['Mail.ReadWrite', 'MailboxSettings.ReadWrite'],
            sourceIp: '45.134.26.91',
          },
          {
            timestamp: '2026-11-17T04:21:05Z',
            user: 'coordinator.cs@simats.edu.example',
            action: 'NewInboxRule',
            ruleName: 'Archive_Notice',
            forwardTo: 'exfil-drop@simats-verify-portal.org',
          },
        ],
      },
      null,
      2
    )
  );

  const f3a = writeSeedEvidenceFile(
    'seed_case03_dns_sample.csv',
    `timestamp,src_ip,query_domain,record_type,bytes_out
2026-11-17T05:01:02Z,10.20.4.55,7a69702d6b65792d3031.tunnel.shadow-dns.net,TXT,412
2026-11-17T05:01:04Z,10.20.4.55,7061796c6f61642d6368756e6b32.tunnel.shadow-dns.net,TXT,428
`
  );

  const s1 = writeSeedSubmissionFile(
    'seed_submission_cipher_wardens.txt',
    `CRIMEATHON INVESTIGATION REPORT — TEAM CIPHER WARDENS (TEAM-101)
Case: CASE-01 Operation Silent Ledger

Executive Summary:
Compromise occurred via unauthorized SSH publickey authentication for svc_treasury from 91.214.124.88 at 01:51:40Z, following brute-force probes from a Tor exit node (185.220.101.44).

Key Findings:
1. Total unauthorized BTC sweep: $146,500 across TX-90812 and TX-90813 to bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh.
2. Staging archive /tmp/.cache_dump.tar.gz exfiltrated over SFTP at 02:03:55Z.
3. Snapshot purge executed at 02:11:19Z prior to file encryption.
`
  );

  const u101: StoredUser = {
    id: 'user-101',
    name: 'Kavya R',
    email: 'kavya.r@simats.edu.in',
    collegeId: 'SIMATS-CS-101',
    teamId: 'team-101',
    createdAt: iso(-1000 * 60 * 150),
    passwordHash: hashPassword('Cipher@123'),
  };

  const u102: StoredUser = {
    id: 'user-102',
    name: 'Aditya K',
    email: 'aditya.k@simats.edu.in',
    collegeId: 'SIMATS-CS-102',
    teamId: 'team-102',
    createdAt: iso(-1000 * 60 * 110),
    passwordHash: hashPassword('Packet@123'),
  };

  const db: DatabaseSchema = {
    cases: [
      {
        id: 'case-01',
        code: 'CASE-01',
        title: 'Operation Silent Ledger',
        category: 'Incident Response',
        difficulty: 'Intermediate',
        briefing:
          'Investigate an overnight ransomware and treasury exfiltration incident inside a simulated financial cluster. Correlate SSH authentication logs with unauthorized blockchain ledger sweeps.',
        objectives: [
          'Pinpoint initial access method and attacker source IP',
          'Quantify exfiltrated funds across split ledger transactions',
          'Document containment & key-rotation remediation steps',
        ],
        status: 'published',
        createdAt: iso(-1000 * 60 * 180),
        updatedAt: iso(-1000 * 60 * 180),
        files: [
          {
            id: 'file-01a',
            originalName: 'CASE01_Incident_Briefing.txt',
            storedName: 'seed_case01_briefing.txt',
            extension: '.txt',
            mimeType: 'text/plain',
            sizeBytes: f1a.sizeBytes,
            sha256: f1a.sha256,
            uploadedAt: iso(-1000 * 60 * 180),
            downloadCount: 14,
          },
          {
            id: 'file-01b',
            originalName: 'CASE01_Auth_Access_Logs.log',
            storedName: 'seed_case01_auth.log',
            extension: '.log',
            mimeType: 'text/plain',
            sizeBytes: f1b.sizeBytes,
            sha256: f1b.sha256,
            uploadedAt: iso(-1000 * 60 * 180),
            downloadCount: 12,
          },
          {
            id: 'file-01c',
            originalName: 'CASE01_Ledger_Transactions.csv',
            storedName: 'seed_case01_ledger.csv',
            extension: '.csv',
            mimeType: 'text/csv',
            sizeBytes: f1c.sizeBytes,
            sha256: f1c.sha256,
            uploadedAt: iso(-1000 * 60 * 180),
            downloadCount: 11,
          },
        ],
      },
      {
        id: 'case-02',
        code: 'CASE-02',
        title: 'Phantom Payload Dispatch',
        category: 'Threat Forensics',
        difficulty: 'Foundational',
        briefing:
          'Trace a targeted spear-phishing campaign against university coordinators that abused illicit OAuth app consent to establish hidden mailbox forwarding rules.',
        objectives: [
          'Verify SPF/DKIM/DMARC authentication failures',
          'Extract malicious OAuth application identifier and scopes',
          'Map the end-to-end attack timeline for judges',
        ],
        status: 'published',
        createdAt: iso(-1000 * 60 * 120),
        updatedAt: iso(-1000 * 60 * 120),
        files: [
          {
            id: 'file-02a',
            originalName: 'CASE02_Case_Overview.md',
            storedName: 'seed_case02_overview.md',
            extension: '.md',
            mimeType: 'text/markdown',
            sizeBytes: f2a.sizeBytes,
            sha256: f2a.sha256,
            uploadedAt: iso(-1000 * 60 * 120),
            downloadCount: 9,
          },
          {
            id: 'file-02b',
            originalName: 'CASE02_Mail_Gateway_Trace.json',
            storedName: 'seed_case02_mail_trace.json',
            extension: '.json',
            mimeType: 'application/json',
            sizeBytes: f2b.sizeBytes,
            sha256: f2b.sha256,
            uploadedAt: iso(-1000 * 60 * 120),
            downloadCount: 8,
          },
        ],
      },
      {
        id: 'case-03',
        code: 'CASE-03',
        title: 'Ghost Signal Exfiltration',
        category: 'Network Forensics',
        difficulty: 'Advanced',
        briefing:
          'Decode hex-encoded DNS TXT tunneling beacons originating from an isolated research workstation and reconstruct the stolen payload headers.',
        objectives: [
          'Decode hex subdomain labels from DNS telemetry',
          'Identify command-and-control authoritative domain',
        ],
        status: 'draft',
        createdAt: iso(-1000 * 60 * 45),
        updatedAt: iso(-1000 * 60 * 45),
        files: [
          {
            id: 'file-03a',
            originalName: 'CASE03_DNS_Query_Sample.csv',
            storedName: 'seed_case03_dns_sample.csv',
            extension: '.csv',
            mimeType: 'text/csv',
            sizeBytes: f3a.sizeBytes,
            sha256: f3a.sha256,
            uploadedAt: iso(-1000 * 60 * 45),
            downloadCount: 0,
          },
        ],
      },
    ],
    users: [u101, u102],
    teams: [
      {
        id: 'team-101',
        teamCode: 'TEAM-101',
        teamName: 'Cipher Wardens',
        inviteCode: 'INV-CW101',
        leaderId: u101.id,
        leaderEmail: u101.email,
        members: 'Kavya R',
        membersList: [
          {
            userId: u101.id,
            name: u101.name,
            email: u101.email,
            role: 'Leader',
            joinedAt: iso(-1000 * 60 * 150),
          },
        ],
        pendingInvites: [],
        createdAt: iso(-1000 * 60 * 150),
        lastActiveAt: iso(-1000 * 60 * 25),
      },
      {
        id: 'team-102',
        teamCode: 'TEAM-102',
        teamName: 'Packet Trace',
        inviteCode: 'INV-PT102',
        leaderId: u102.id,
        leaderEmail: u102.email,
        members: 'Aditya K',
        membersList: [
          {
            userId: u102.id,
            name: u102.name,
            email: u102.email,
            role: 'Leader',
            joinedAt: iso(-1000 * 60 * 110),
          },
        ],
        pendingInvites: [],
        createdAt: iso(-1000 * 60 * 110),
        lastActiveAt: iso(-1000 * 60 * 40),
      },
    ],
    submissions: [
      {
        id: 'sub-101',
        teamId: 'team-101',
        teamCode: 'TEAM-101',
        teamName: 'Cipher Wardens',
        caseId: 'case-01',
        caseCode: 'CASE-01',
        caseTitle: 'Operation Silent Ledger',
        summary:
          'Identified initial SSH key compromise on svc_treasury from 91.214.124.88, $146,500 split BTC sweep across TX-90812/TX-90813, and shadow snapshot purge.',
        methodology:
          'Cross-referenced SSH daemon timestamps against auditd process execution and treasury ledger CSV export.',
        fileName: 'CipherWardens_CASE01_Report.txt',
        storedName: 'seed_submission_cipher_wardens.txt',
        extension: '.txt',
        mimeType: 'text/plain',
        sizeBytes: s1.sizeBytes,
        sha256: s1.sha256,
        submittedAt: iso(-1000 * 60 * 25),
        status: 'Submitted',
        score: null,
        judgeFeedback: '',
        evaluatedAt: null,
      },
    ],
    activities: [
      {
        id: 'act-4',
        type: 'REPORT_SUBMIT',
        teamCode: 'TEAM-101',
        teamName: 'Cipher Wardens',
        caseCode: 'CASE-01',
        fileName: 'CipherWardens_CASE01_Report.txt',
        details: 'Submitted investigation report for CASE-01 (.txt)',
        timestamp: iso(-1000 * 60 * 25),
      },
      {
        id: 'act-3',
        type: 'FILE_DOWNLOAD',
        teamCode: 'TEAM-102',
        teamName: 'Packet Trace',
        caseCode: 'CASE-02',
        fileName: 'CASE02_Mail_Gateway_Trace.json',
        details: 'Downloaded evidence file CASE02_Mail_Gateway_Trace.json',
        timestamp: iso(-1000 * 60 * 40),
      },
      {
        id: 'act-2',
        type: 'FILE_DOWNLOAD',
        teamCode: 'TEAM-101',
        teamName: 'Cipher Wardens',
        caseCode: 'CASE-01',
        fileName: 'CASE01_Auth_Access_Logs.log',
        details: 'Downloaded evidence file CASE01_Auth_Access_Logs.log',
        timestamp: iso(-1000 * 60 * 95),
      },
      {
        id: 'act-1',
        type: 'TEAM_CREATED',
        teamCode: 'TEAM-101',
        teamName: 'Cipher Wardens',
        details: 'Created team Cipher Wardens (Leader: Kavya R)',
        timestamp: iso(-1000 * 60 * 150),
      },
    ],
  };

  saveDatabase(db);
  return db;
}

function saveDatabase(dbRef: DatabaseSchema): void {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dbRef, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

let db: DatabaseSchema = initializeDatabase();

function appendActivity(entry: Omit<ActivityLog, 'id' | 'timestamp'>): ActivityLog {
  const activity: ActivityLog = {
    id: `act-${crypto.randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  db.activities.unshift(activity);
  if (db.activities.length > 500) {
    db.activities = db.activities.slice(0, 500);
  }
  saveDatabase(db);
  return activity;
}

function getAuthenticatedParticipant(req: Request): StoredUser | null {
  const parsed = verifyParticipantToken(extractBearer(req));
  if (!parsed) return null;
  return db.users.find((u) => u.id === parsed.userId) ?? null;
}

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

function computeStats(): AdminStats {
  const totalEvidenceFiles = db.cases.reduce((acc, item) => acc + item.files.length, 0);
  const totalDownloads = db.cases.reduce(
    (acc, item) => acc + item.files.reduce((sum, f) => sum + f.downloadCount, 0),
    0
  );
  const pendingEvaluations = db.submissions.filter((s) => s.status !== 'Evaluated').length;

  return {
    totalCases: db.cases.length,
    publishedCases: db.cases.filter((c) => c.status === 'published').length,
    totalEvidenceFiles,
    totalTeams: db.teams.length,
    totalDownloads,
    totalSubmissions: db.submissions.length,
    pendingEvaluations,
  };
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'Crimeathon Hub' });
  });

  // ---------------- PARTICIPANT AUTH & PROFILE ----------------

  app.post('/api/participants/register', (req, res) => {
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
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
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
    db.users.push(newUser);
    appendActivity({
      type: 'PARTICIPANT_REGISTER',
      teamCode: 'UNASSIGNED',
      teamName: newUser.name,
      details: `Participant ${newUser.name} (${newUser.email}) created an account`,
    });

    const token = createParticipantToken(newUser.id, newUser.email);
    const invites = getPendingInvitesForEmail(db, newUser.email);
    res.status(201).json({
      token,
      user: sanitizeUser(newUser),
      team: null,
      invites,
    });
  });

  app.post('/api/participants/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid participant email or password.' });
      return;
    }

    const team = user.teamId ? db.teams.find((t) => t.id === user.teamId) ?? null : null;
    if (team) {
      team.lastActiveAt = new Date().toISOString();
    }

    appendActivity({
      type: 'PARTICIPANT_LOGIN',
      teamCode: team?.teamCode ?? 'UNASSIGNED',
      teamName: team?.teamName ?? user.name,
      details: `${user.name} (${user.email}) signed into the participant portal`,
    });

    const token = createParticipantToken(user.id, user.email);
    const invites = getPendingInvitesForEmail(db, user.email);
    res.json({
      token,
      user: sanitizeUser(user),
      team,
      invites,
    });
  });

  app.get('/api/participants/me', (req, res) => {
    const user = getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Participant session required.' });
      return;
    }
    const team = user.teamId ? db.teams.find((t) => t.id === user.teamId) ?? null : null;
    const invites = getPendingInvitesForEmail(db, user.email);
    res.json({ user: sanitizeUser(user), team, invites });
  });

  app.patch('/api/participants/profile', (req, res) => {
    const user = getAuthenticatedParticipant(req);
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
    user.name = name;
    if (collegeId) user.collegeId = collegeId;

    if (user.teamId) {
      const team = db.teams.find((t) => t.id === user.teamId);
      if (team) {
        const member = team.membersList.find((m) => m.userId === user.id);
        if (member) {
          member.name = user.name;
          syncTeamMembersString(team);
        }
      }
    }
    saveDatabase(db);
    res.json({ user: sanitizeUser(user) });
  });

  app.patch('/api/participants/password', (req, res) => {
    const user = getAuthenticatedParticipant(req);
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

    user.passwordHash = hashPassword(newPassword);
    saveDatabase(db);
    res.json({ ok: true });
  });

  // ---------------- TEAM CREATION, INVITE & JOIN ----------------

  app.post('/api/teams/create', (req, res) => {
    const user = getAuthenticatedParticipant(req);
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

    const teamCode = requestedCode || generateTeamCode(db.teams);
    if (db.teams.some((t) => t.teamCode === teamCode)) {
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

    db.teams.push(newTeam);
    user.teamId = newTeam.id;

    appendActivity({
      type: 'TEAM_CREATED',
      teamCode: newTeam.teamCode,
      teamName: newTeam.teamName,
      details: `${user.name} created team ${newTeam.teamName} (${newTeam.teamCode})`,
    });

    res.status(201).json({ team: newTeam, user: sanitizeUser(user) });
  });

  app.post('/api/teams/join', (req, res) => {
    const user = getAuthenticatedParticipant(req);
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

    const team = db.teams.find(
      (t) => t.teamCode.toUpperCase() === code || t.inviteCode.toUpperCase() === code
    );
    if (!team) {
      res.status(404).json({ error: 'No team found matching that Team Code or Invite Code.' });
      return;
    }

    if (!team.membersList.some((m) => m.userId === user.id)) {
      team.membersList.push({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: 'Member',
        joinedAt: new Date().toISOString(),
      });
    }
    syncTeamMembersString(team);
    team.lastActiveAt = new Date().toISOString();
    team.pendingInvites = team.pendingInvites.filter(
      (inv) => inv.email.toLowerCase() !== user.email.toLowerCase()
    );
    user.teamId = team.id;

    appendActivity({
      type: 'TEAM_JOINED',
      teamCode: team.teamCode,
      teamName: team.teamName,
      details: `${user.name} joined team ${team.teamName} (${team.teamCode})`,
    });

    res.json({ team, user: sanitizeUser(user) });
  });

  app.post('/api/teams/invite', (req, res) => {
    const user = getAuthenticatedParticipant(req);
    if (!user) {
      res.status(401).json({ error: 'Participant session required.' });
      return;
    }
    if (!user.teamId) {
      res.status(400).json({ error: 'Create or join a team before sending invitations.' });
      return;
    }

    const team = db.teams.find((t) => t.id === user.teamId);
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

    team.pendingInvites.push({
      id: `inv-${crypto.randomUUID().slice(0, 8)}`,
      email: inviteEmail,
      invitedBy: user.name,
      createdAt: new Date().toISOString(),
    });
    team.lastActiveAt = new Date().toISOString();

    appendActivity({
      type: 'TEAM_INVITE_SENT',
      teamCode: team.teamCode,
      teamName: team.teamName,
      details: `${user.name} invited ${inviteEmail} to join ${team.teamName}`,
    });

    res.json({ team });
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

  app.get('/api/cases', (req, res) => {
    const isAdmin = verifyAdminToken(extractBearer(req));
    const cases = isAdmin ? db.cases : db.cases.filter((c) => c.status === 'published');
    res.json({ cases });
  });

  app.get('/api/cases/:caseId/files/:fileId/download', (req, res) => {
    const caseItem = db.cases.find((c) => c.id === req.params.caseId);
    if (!caseItem) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }
    const isAdmin = verifyAdminToken(extractBearer(req));
    const participant = getAuthenticatedParticipant(req);

    if (caseItem.status !== 'published' && !isAdmin) {
      res.status(403).json({ error: 'Case study is not published yet.' });
      return;
    }

    if (!isAdmin && !participant) {
      res.status(401).json({ error: 'Please sign in as a registered participant to download case files.' });
      return;
    }

    const fileItem = caseItem.files.find((f) => f.id === req.params.fileId);
    if (!fileItem) {
      res.status(404).json({ error: 'Evidence file not found.' });
      return;
    }

    const fullPath = path.join(EVIDENCE_DIR, fileItem.storedName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'File missing on storage volume.' });
      return;
    }

    fileItem.downloadCount += 1;

    if (!isAdmin && participant) {
      const matchedTeam = participant.teamId
        ? db.teams.find((t) => t.id === participant.teamId)
        : undefined;
      if (matchedTeam) {
        matchedTeam.lastActiveAt = new Date().toISOString();
      }
      appendActivity({
        type: 'FILE_DOWNLOAD',
        teamCode: matchedTeam?.teamCode ?? 'INDIVIDUAL',
        teamName: matchedTeam?.teamName ?? participant.name,
        caseCode: caseItem.code,
        fileName: fileItem.originalName,
        details: `${participant.name} downloaded ${fileItem.originalName} from ${caseItem.code}`,
      });
    } else {
      saveDatabase(db);
    }

    res.download(fullPath, fileItem.originalName);
  });

  // ---------------- SUBMISSIONS ----------------

  app.get('/api/submissions', (req, res) => {
    const isAdmin = verifyAdminToken(extractBearer(req));
    if (isAdmin) {
      res.json({ submissions: db.submissions });
      return;
    }

    const participant = getAuthenticatedParticipant(req);
    if (!participant || !participant.teamId) {
      res.json({ submissions: [] });
      return;
    }
    const filtered = db.submissions.filter((s) => s.teamId === participant.teamId);
    res.json({ submissions: filtered });
  });

  app.post('/api/submissions', submissionUpload.single('reportFile'), (req, res) => {
    const file = req.file;
    const participant = getAuthenticatedParticipant(req);

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
    if (!file) {
      res.status(400).json({ error: 'Please attach an investigation report file.' });
      return;
    }

    const team = db.teams.find((t) => t.id === participant.teamId);
    if (!team) {
      fs.unlinkSync(file.path);
      res.status(404).json({ error: 'Your team record could not be found.' });
      return;
    }

    const caseId = String(req.body?.caseId ?? '').trim();
    const summary = String(req.body?.summary ?? '').trim();
    const methodology = String(req.body?.methodology ?? '').trim();

    if (!caseId || !summary) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: 'Case Study and Findings Summary are required.' });
      return;
    }

    const caseItem = db.cases.find((c) => c.id === caseId);
    if (!caseItem) {
      fs.unlinkSync(file.path);
      res.status(404).json({ error: 'Selected case study does not exist.' });
      return;
    }

    team.lastActiveAt = new Date().toISOString();
    const fileBuf = fs.readFileSync(file.path);
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';

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
      fileName: file.originalname,
      storedName: file.filename,
      extension: ext,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
      sha256: sha256Buffer(fileBuf),
      submittedAt: new Date().toISOString(),
      status: 'Submitted',
      score: null,
      judgeFeedback: '',
      evaluatedAt: null,
    };

    db.submissions.unshift(submission);
    appendActivity({
      type: 'REPORT_SUBMIT',
      teamCode: team.teamCode,
      teamName: team.teamName,
      caseCode: caseItem.code,
      fileName: submission.fileName,
      details: `${participant.name} submitted ${submission.fileName} (${ext}) for ${caseItem.code}`,
    });

    res.status(201).json({ submission });
  });

  app.get('/api/submissions/:submissionId/download', (req, res) => {
    const submission = db.submissions.find((s) => s.id === req.params.submissionId);
    if (!submission) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }

    const isAdmin = verifyAdminToken(extractBearer(req));
    const participant = getAuthenticatedParticipant(req);
    const isTeamOwner = Boolean(participant && participant.teamId === submission.teamId);

    if (!isAdmin && !isTeamOwner) {
      res.status(403).json({ error: 'Access denied to this submission file.' });
      return;
    }

    const fullPath = path.join(SUBMISSIONS_DIR, submission.storedName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Submission file missing on disk.' });
      return;
    }

    res.download(fullPath, submission.fileName);
  });

  // ---------------- ADMIN OPERATIONS ----------------

  app.post('/api/admin/cases', requireAdmin, evidenceUpload.array('files', 15), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
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

    const evidenceFiles: EvidenceFile[] = files.map((file) => {
      const buf = fs.readFileSync(file.path);
      return {
        id: `file-${crypto.randomUUID().slice(0, 8)}`,
        originalName: file.originalname,
        storedName: file.filename,
        extension: path.extname(file.originalname).toLowerCase() || '.bin',
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        sha256: sha256Buffer(buf),
        uploadedAt: new Date().toISOString(),
        downloadCount: 0,
      };
    });

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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: evidenceFiles,
    };

    db.cases.unshift(newCase);
    appendActivity({
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
    evidenceUpload.array('files', 15),
    (req, res) => {
      const caseItem = db.cases.find((c) => c.id === req.params.caseId);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (!caseItem) {
        for (const f of files) {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        }
        res.status(404).json({ error: 'Case study not found.' });
        return;
      }

      if (files.length === 0) {
        res.status(400).json({ error: 'Select at least one file to upload.' });
        return;
      }

      const added: EvidenceFile[] = files.map((file) => {
        const buf = fs.readFileSync(file.path);
        return {
          id: `file-${crypto.randomUUID().slice(0, 8)}`,
          originalName: file.originalname,
          storedName: file.filename,
          extension: path.extname(file.originalname).toLowerCase() || '.bin',
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          sha256: sha256Buffer(buf),
          uploadedAt: new Date().toISOString(),
          downloadCount: 0,
        };
      });

      caseItem.files.push(...added);
      caseItem.updatedAt = new Date().toISOString();

      appendActivity({
        type: 'EVIDENCE_UPLOADED',
        teamCode: 'ADMIN',
        teamName: 'Crimeathon Admin',
        caseCode: caseItem.code,
        fileName: added.map((f) => f.originalName).join(', '),
        details: `Uploaded ${added.length} evidence file(s) to ${caseItem.code}`,
      });

      res.status(201).json({ caseStudy: caseItem, addedFiles: added });
    }
  );

  app.patch('/api/admin/cases/:caseId', requireAdmin, (req, res) => {
    const caseItem = db.cases.find((c) => c.id === req.params.caseId);
    if (!caseItem) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }

    const nextStatus = req.body?.status;
    if (nextStatus === 'published' || nextStatus === 'draft') {
      caseItem.status = nextStatus;
    }
    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      caseItem.title = req.body.title.trim();
    }
    if (typeof req.body?.briefing === 'string' && req.body.briefing.trim()) {
      caseItem.briefing = req.body.briefing.trim();
    }
    caseItem.updatedAt = new Date().toISOString();

    appendActivity({
      type: 'CASE_PUBLISHED',
      teamCode: 'ADMIN',
      teamName: 'Crimeathon Admin',
      caseCode: caseItem.code,
      details: `Updated ${caseItem.code} status to ${caseItem.status}`,
    });

    res.json({ caseStudy: caseItem });
  });

  app.delete('/api/admin/cases/:caseId/files/:fileId', requireAdmin, (req, res) => {
    const caseItem = db.cases.find((c) => c.id === req.params.caseId);
    if (!caseItem) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }

    const idx = caseItem.files.findIndex((f) => f.id === req.params.fileId);
    if (idx === -1) {
      res.status(404).json({ error: 'Evidence file not found.' });
      return;
    }

    const [removed] = caseItem.files.splice(idx, 1);
    const fullPath = path.join(EVIDENCE_DIR, removed.storedName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    caseItem.updatedAt = new Date().toISOString();
    saveDatabase(db);
    res.json({ ok: true, caseStudy: caseItem });
  });

  app.delete('/api/admin/cases/:caseId', requireAdmin, (req, res) => {
    const idx = db.cases.findIndex((c) => c.id === req.params.caseId);
    if (idx === -1) {
      res.status(404).json({ error: 'Case study not found.' });
      return;
    }
    const [removed] = db.cases.splice(idx, 1);
    for (const f of removed.files) {
      const fullPath = path.join(EVIDENCE_DIR, f.storedName);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
    saveDatabase(db);
    res.json({ ok: true });
  });

  app.patch('/api/admin/submissions/:submissionId/evaluate', requireAdmin, (req, res) => {
    const submission = db.submissions.find((s) => s.id === req.params.submissionId);
    if (!submission) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }

    const status = req.body?.status as SubmissionStatus | undefined;
    if (status === 'Submitted' || status === 'Under Review' || status === 'Evaluated') {
      submission.status = status;
    }
    if (req.body?.score !== undefined && req.body?.score !== null && req.body?.score !== '') {
      const parsed = Number(req.body.score);
      if (!Number.isNaN(parsed)) {
        submission.score = Math.max(0, Math.min(100, Math.round(parsed)));
      }
    } else if (req.body?.score === null || req.body?.score === '') {
      submission.score = null;
    }
    if (typeof req.body?.judgeFeedback === 'string') {
      submission.judgeFeedback = req.body.judgeFeedback.trim();
    }
    submission.evaluatedAt = new Date().toISOString();

    appendActivity({
      type: 'REPORT_EVALUATED',
      teamCode: submission.teamCode,
      teamName: submission.teamName,
      caseCode: submission.caseCode,
      fileName: submission.fileName,
      details: `Judges marked ${submission.teamName} (${submission.caseCode}) as ${submission.status}${
        submission.score !== null ? ` · Score: ${submission.score}/100` : ''
      }`,
    });

    res.json({ submission });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res) => {
    res.json({
      stats: computeStats(),
      activities: db.activities,
      teams: db.teams,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Crimeathon Hub running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Crimeathon Hub server:', err);
  process.exit(1);
});
