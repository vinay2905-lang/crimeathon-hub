export type CaseStatus = 'published' | 'draft';
export type CaseDifficulty = 'Foundational' | 'Intermediate' | 'Advanced';
export type SubmissionStatus = 'Submitted' | 'Under Review' | 'Evaluated';
export type ActivityType =
  | 'PARTICIPANT_REGISTER'
  | 'PARTICIPANT_LOGIN'
  | 'TEAM_REGISTER'
  | 'TEAM_LOGIN'
  | 'TEAM_CREATED'
  | 'TEAM_JOINED'
  | 'TEAM_INVITE_SENT'
  | 'FILE_DOWNLOAD'
  | 'REPORT_SUBMIT'
  | 'REPORT_EVALUATED'
  | 'CASE_PUBLISHED'
  | 'EVIDENCE_UPLOADED';

export interface EvidenceFile {
  id: string;
  originalName: string;
  storedName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  downloadCount: number;
}

export interface CaseStudy {
  id: string;
  code: string;
  title: string;
  category: string;
  difficulty: CaseDifficulty;
  briefing: string;
  objectives: string[];
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  files: EvidenceFile[];
}

export interface ParticipantUser {
  id: string;
  name: string;
  email: string;
  collegeId: string;
  teamId: string | null;
  createdAt: string;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: 'Leader' | 'Member';
  joinedAt: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  invitedBy: string;
  createdAt: string;
}

export interface PendingInviteSummary {
  teamId: string;
  teamCode: string;
  teamName: string;
  inviteCode: string;
  invitedBy: string;
  createdAt: string;
}

export interface Team {
  id: string;
  teamCode: string;
  teamName: string;
  inviteCode: string;
  leaderId: string;
  leaderEmail: string;
  members: string;
  membersList: TeamMember[];
  pendingInvites: TeamInvite[];
  createdAt: string;
  lastActiveAt: string;
}

export interface Submission {
  id: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  caseId: string;
  caseCode: string;
  caseTitle: string;
  summary: string;
  methodology: string;
  fileName: string;
  storedName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  submittedAt: string;
  status: SubmissionStatus;
  score: number | null;
  judgeFeedback: string;
  evaluatedAt: string | null;
}

export interface ActivityLog {
  id: string;
  type: ActivityType;
  teamCode: string;
  teamName: string;
  caseCode?: string;
  fileName?: string;
  details: string;
  timestamp: string;
}

export interface AdminStats {
  totalCases: number;
  publishedCases: number;
  totalEvidenceFiles: number;
  totalTeams: number;
  totalDownloads: number;
  totalSubmissions: number;
  pendingEvaluations: number;
}
