import crypto from 'node:crypto';
import type { CaseStudy, EvidenceFile, Submission, Team } from '../src/types.ts';

export interface SeedUserRecord {
  id: string;
  name: string;
  email: string;
  collegeId: string;
  teamId: string | null;
  createdAt: string;
  passwordHash: string;
}

export interface SeedArtifact {
  folder: 'evidence' | 'submissions';
  storedName: string;
  content: string;
  sizeBytes: number;
  sha256: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeArtifact(
  folder: 'evidence' | 'submissions',
  storedName: string,
  content: string
): SeedArtifact {
  const buf = Buffer.from(content, 'utf8');
  return {
    folder,
    storedName,
    content,
    sizeBytes: buf.byteLength,
    sha256: sha256Buffer(buf),
  };
}

export function buildInitialSeedData(usePrefixedPaths: boolean) {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const pathFor = (folder: 'evidence' | 'submissions', name: string) =>
    usePrefixedPaths ? `${folder}/${name}` : name;

  const f1a = makeArtifact(
    'evidence',
    pathFor('evidence', 'seed_case01_briefing.txt'),
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

  const f1b = makeArtifact(
    'evidence',
    pathFor('evidence', 'seed_case01_auth.log'),
    `2026-11-17T01:48:11Z FIN-SRV-04 sshd[4821]: Failed password for invalid user deploy_bot from 185.220.101.44 port 51204 ssh2
2026-11-17T01:49:02Z FIN-SRV-04 sshd[4825]: Failed password for svc_treasury from 185.220.101.44 port 51299 ssh2
2026-11-17T01:51:40Z FIN-SRV-04 sshd[4840]: Accepted publickey for svc_treasury from 91.214.124.88 port 44812 ssh2: RSA SHA256:k9vT+x82LmQp
2026-11-17T01:54:12Z FIN-SRV-04 sudo[4902]: svc_treasury : TTY=pts/1 ; PWD=/var/finops ; USER=root ; COMMAND=/usr/bin/tar -czf /tmp/.cache_dump.tar.gz /var/finops/ledger_backups
2026-11-17T02:03:55Z FIN-SRV-04 sftp-server[4950]: session opened for local user svc_treasury from [91.214.124.88]
2026-11-17T02:11:19Z FIN-SRV-04 auditd[5011]: EXECVE cmd="vssadmin_sim --purge-snapshots --quiet" uid=0
2026-11-17T02:14:04Z FIN-SRV-04 siem-agent[5033]: ALERT high_entropy_write /var/finops/ledger_backups/2026_q4.db.locked
`
  );

  const f1c = makeArtifact(
    'evidence',
    pathFor('evidence', 'seed_case01_ledger.csv'),
    `tx_id,timestamp_utc,source_acct,dest_wallet_or_iban,amount_usd,initiator_user,flag_note
TX-90811,2026-11-17T01:30:10Z,ACC-4001,IBAN-IN91-0021,4200.00,arjun_fin,scheduled_vendor
TX-90812,2026-11-17T01:58:44Z,ACC-9900,bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,84500.00,svc_treasury,unapproved_offhours_sweep
TX-90813,2026-11-17T02:01:12Z,ACC-9900,bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,62000.00,svc_treasury,split_structuring
TX-90814,2026-11-17T02:15:00Z,ACC-4002,IBAN-IN91-0088,1850.00,priya_ops,payroll_batch
`
  );

  const f2a = makeArtifact(
    'evidence',
    pathFor('evidence', 'seed_case02_overview.md'),
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

  const f2b = makeArtifact(
    'evidence',
    pathFor('evidence', 'seed_case02_mail_trace.json'),
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

  const f3a = makeArtifact(
    'evidence',
    pathFor('evidence', 'seed_case03_dns_sample.csv'),
    `timestamp,src_ip,query_domain,record_type,bytes_out
2026-11-17T05:01:02Z,10.20.4.55,7a69702d6b65792d3031.tunnel.shadow-dns.net,TXT,412
2026-11-17T05:01:04Z,10.20.4.55,7061796c6f61642d6368756e6b32.tunnel.shadow-dns.net,TXT,428
`
  );

  const s1 = makeArtifact(
    'submissions',
    pathFor('submissions', 'seed_submission_cipher_wardens.txt'),
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

  const u101: SeedUserRecord = {
    id: 'user-101',
    name: 'Kavya R',
    email: 'kavya.r@simats.edu.in',
    collegeId: 'SIMATS',
    teamId: 'team-101',
    createdAt: iso(-1000 * 60 * 150),
    passwordHash: hashPassword('Cipher@123'),
  };

  const u102: SeedUserRecord = {
    id: 'user-102',
    name: 'Aditya K',
    email: 'aditya.k@simats.edu.in',
    collegeId: 'SIMATS',
    teamId: 'team-102',
    createdAt: iso(-1000 * 60 * 110),
    passwordHash: hashPassword('Packet@123'),
  };

  const mkEvidence = (
    id: string,
    originalName: string,
    art: SeedArtifact,
    extension: string,
    mimeType: string,
    uploadedAt: string,
    downloadCount: number
  ): EvidenceFile => ({
    id,
    originalName,
    storedName: art.storedName,
    extension,
    mimeType,
    sizeBytes: art.sizeBytes,
    sha256: art.sha256,
    uploadedAt,
    downloadCount,
  });

  const cases: CaseStudy[] = [
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
        mkEvidence('file-01a', 'CASE01_Incident_Briefing.txt', f1a, '.txt', 'text/plain', iso(-1000 * 60 * 180), 14),
        mkEvidence('file-01b', 'CASE01_Auth_Access_Logs.log', f1b, '.log', 'text/plain', iso(-1000 * 60 * 180), 12),
        mkEvidence('file-01c', 'CASE01_Ledger_Transactions.csv', f1c, '.csv', 'text/csv', iso(-1000 * 60 * 180), 11),
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
        mkEvidence('file-02a', 'CASE02_Case_Overview.md', f2a, '.md', 'text/markdown', iso(-1000 * 60 * 120), 9),
        mkEvidence('file-02b', 'CASE02_Mail_Gateway_Trace.json', f2b, '.json', 'application/json', iso(-1000 * 60 * 120), 8),
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
        mkEvidence('file-03a', 'CASE03_DNS_Query_Sample.csv', f3a, '.csv', 'text/csv', iso(-1000 * 60 * 45), 0),
      ],
    },
  ];

  const teams: Team[] = [
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
  ];

  const submissions: Submission[] = [
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
      storedName: s1.storedName,
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
  ];

  const activities = [
    {
      id: 'act-4',
      type: 'REPORT_SUBMIT' as const,
      teamCode: 'TEAM-101',
      teamName: 'Cipher Wardens',
      caseCode: 'CASE-01',
      fileName: 'CipherWardens_CASE01_Report.txt',
      details: 'Submitted investigation report for CASE-01 (.txt)',
      timestamp: iso(-1000 * 60 * 25),
    },
    {
      id: 'act-3',
      type: 'FILE_DOWNLOAD' as const,
      teamCode: 'TEAM-102',
      teamName: 'Packet Trace',
      caseCode: 'CASE-02',
      fileName: 'CASE02_Mail_Gateway_Trace.json',
      details: 'Downloaded evidence file CASE02_Mail_Gateway_Trace.json',
      timestamp: iso(-1000 * 60 * 40),
    },
    {
      id: 'act-2',
      type: 'FILE_DOWNLOAD' as const,
      teamCode: 'TEAM-101',
      teamName: 'Cipher Wardens',
      caseCode: 'CASE-01',
      fileName: 'CASE01_Auth_Access_Logs.log',
      details: 'Downloaded evidence file CASE01_Auth_Access_Logs.log',
      timestamp: iso(-1000 * 60 * 95),
    },
    {
      id: 'act-1',
      type: 'TEAM_CREATED' as const,
      teamCode: 'TEAM-101',
      teamName: 'Cipher Wardens',
      details: 'Created team Cipher Wardens (Leader: Kavya R)',
      timestamp: iso(-1000 * 60 * 150),
    },
  ];

  return {
    artifacts: [f1a, f1b, f1c, f2a, f2b, f3a, s1],
    cases,
    users: [u101, u102],
    teams,
    submissions,
    activities,
  };
}
