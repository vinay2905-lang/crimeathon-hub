import { CheckCircle2, ShieldAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { AdminLogin } from './components/AdminLogin.tsx';
import { BrandHeader } from './components/BrandHeader.tsx';
import { ParticipantPortal } from './components/ParticipantPortal.tsx';
import type {
  ActivityLog,
  AdminStats,
  CaseStudy,
  EvidenceFile,
  ParticipantUser,
  PendingInviteSummary,
  Submission,
  SubmissionStatus,
  Team,
} from './types.ts';

interface ToastState {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const ADMIN_TOKEN_KEY = 'crimeathon_admin_token';
const ADMIN_EMAIL_KEY = 'crimeathon_admin_email';
const PARTICIPANT_TOKEN_KEY = 'crimeathon_participant_token';

const EMPTY_STATS: AdminStats = {
  totalCases: 0,
  publishedCases: 0,
  totalEvidenceFiles: 0,
  totalTeams: 0,
  totalDownloads: 0,
  totalSubmissions: 0,
  pendingEvaluations: 0,
};

function checkIsAdminRoute(pathname: string, hash: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const normalizedHash = hash.replace(/\/+$/, '');
  return (
    normalized === '/admin' ||
    normalized.startsWith('/admin/') ||
    normalizedHash === '#/admin' ||
    normalizedHash.startsWith('#/admin/')
  );
}

function getInviteCodeFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  return (params.get('invite') ?? '').trim().toUpperCase();
}

export default function App() {
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);
  const [hash, setHash] = useState<string>(() => window.location.hash);
  const [initialInviteCode] = useState<string>(() =>
    getInviteCodeFromSearch(window.location.search)
  );
  const [initialAuthTab, setInitialAuthTab] = useState<'login' | 'register'>(() =>
    getInviteCodeFromSearch(window.location.search) ? 'register' : 'login'
  );

  const isAdminRoute = checkIsAdminRoute(pathname, hash);

  // Admin session state
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem(ADMIN_TOKEN_KEY)
  );
  const [adminEmail, setAdminEmail] = useState<string>(
    () => sessionStorage.getItem(ADMIN_EMAIL_KEY) ?? 'crimeathonadmin@gmail.com'
  );

  // Participant session state
  const [participantToken, setParticipantToken] = useState<string | null>(() =>
    localStorage.getItem(PARTICIPANT_TOKEN_KEY)
  );
  const [participant, setParticipant] = useState<ParticipantUser | null>(null);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteSummary[]>([]);

  // Shared & portal data
  const [cases, setCases] = useState<CaseStudy[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [teamSubmissions, setTeamSubmissions] = useState<Submission[]>([]);

  // Admin data
  const [adminStats, setAdminStats] = useState<AdminStats>(EMPTY_STATS);
  const [adminActivities, setAdminActivities] = useState<ActivityLog[]>([]);
  const [adminTeams, setAdminTeams] = useState<Team[]>([]);
  const [adminSubmissions, setAdminSubmissions] = useState<Submission[]>([]);
  const [refreshingAdmin, setRefreshingAdmin] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((kind: 'success' | 'error', message: string) => {
    const id = Date.now();
    setToast({ id, kind, message });
    setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4500);
  }, []);

  useEffect(() => {
    const syncLocation = () => {
      setPathname(window.location.pathname);
      setHash(window.location.hash);
    };
    window.addEventListener('popstate', syncLocation);
    window.addEventListener('hashchange', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('hashchange', syncLocation);
    };
  }, []);

  const navigateToPath = useCallback((targetPath: string) => {
    window.history.pushState({}, '', targetPath);
    setPathname(targetPath);
    setHash('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const fetchCases = useCallback(
    async (tokenOverride?: string | null) => {
      const tokenToUse = tokenOverride !== undefined ? tokenOverride : adminToken;
      try {
        const res = await fetch('/api/cases', {
          headers: tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : undefined,
        });
        if (res.ok) {
          const data = (await res.json()) as { cases: CaseStudy[] };
          setCases(data.cases);
        }
      } catch {
        // Keep existing state on transient error
      } finally {
        setLoadingCases(false);
      }
    },
    [adminToken]
  );

  const fetchTeamSubmissions = useCallback(
    async (token: string | null) => {
      if (!token) {
        setTeamSubmissions([]);
        return;
      }
      try {
        const res = await fetch('/api/submissions', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { submissions: Submission[] };
          setTeamSubmissions(data.submissions);
        }
      } catch {
        // Ignore transient error
      }
    },
    []
  );

  const fetchParticipantSession = useCallback(
    async (token: string | null) => {
      if (!token) {
        setParticipant(null);
        setActiveTeam(null);
        setPendingInvites([]);
        setTeamSubmissions([]);
        return;
      }
      try {
        const res = await fetch('/api/participants/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          localStorage.removeItem(PARTICIPANT_TOKEN_KEY);
          setParticipantToken(null);
          setParticipant(null);
          setActiveTeam(null);
          setPendingInvites([]);
          return;
        }
        const data = (await res.json()) as {
          user: ParticipantUser;
          team: Team | null;
          invites: PendingInviteSummary[];
        };
        setParticipant(data.user);
        setActiveTeam(data.team);
        setPendingInvites(data.invites);
        if (data.team) {
          fetchTeamSubmissions(token);
        } else {
          setTeamSubmissions([]);
        }
      } catch {
        // Keep existing state on transient error
      }
    },
    [fetchTeamSubmissions]
  );

  const fetchAdminData = useCallback(
    async (tokenOverride?: string | null) => {
      const tokenToUse = tokenOverride !== undefined ? tokenOverride : adminToken;
      if (!tokenToUse) return;
      setRefreshingAdmin(true);
      try {
        const headers = { Authorization: `Bearer ${tokenToUse}` };
        const [overviewRes, subsRes, casesRes] = await Promise.all([
          fetch('/api/admin/overview', { headers }),
          fetch('/api/submissions', { headers }),
          fetch('/api/cases', { headers }),
        ]);

        if (overviewRes.status === 401) {
          sessionStorage.removeItem(ADMIN_TOKEN_KEY);
          sessionStorage.removeItem(ADMIN_EMAIL_KEY);
          setAdminToken(null);
          notify('error', 'Admin session expired. Please sign in again.');
          return;
        }

        if (overviewRes.ok) {
          const ov = (await overviewRes.json()) as {
            stats: AdminStats;
            activities: ActivityLog[];
            teams: Team[];
          };
          setAdminStats(ov.stats);
          setAdminActivities(ov.activities);
          setAdminTeams(ov.teams);
        }
        if (subsRes.ok) {
          const subData = (await subsRes.json()) as { submissions: Submission[] };
          setAdminSubmissions(subData.submissions);
        }
        if (casesRes.ok) {
          const caseData = (await casesRes.json()) as { cases: CaseStudy[] };
          setCases(caseData.cases);
        }
      } catch {
        notify('error', 'Failed to refresh admin console data.');
      } finally {
        setRefreshingAdmin(false);
      }
    },
    [adminToken, notify]
  );

  useEffect(() => {
    fetchCases(isAdminRoute ? adminToken : null);
  }, [fetchCases, isAdminRoute, adminToken]);

  useEffect(() => {
    if (!isAdminRoute) {
      fetchParticipantSession(participantToken);
    }
  }, [isAdminRoute, participantToken, fetchParticipantSession]);

  useEffect(() => {
    if (!isAdminRoute || !adminToken) return;
    let cancelled = false;
    fetch('/api/admin/session', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((res) => res.json() as Promise<{ authenticated?: boolean }>)
      .then((data) => {
        if (cancelled) return;
        if (!data.authenticated) {
          sessionStorage.removeItem(ADMIN_TOKEN_KEY);
          sessionStorage.removeItem(ADMIN_EMAIL_KEY);
          setAdminToken(null);
        } else {
          fetchAdminData(adminToken);
        }
      })
      .catch(() => {
        // Keep current state on transient network failure
      });
    return () => {
      cancelled = true;
    };
  }, [isAdminRoute, adminToken, fetchAdminData]);

  const handleJumpToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------------- PARTICIPANT HANDLERS ----------------

  const handleParticipantRegister = async (payload: {
    name: string;
    email: string;
    password: string;
  }): Promise<boolean> => {
    try {
      const res = await fetch('/api/participants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        token?: string;
        user?: ParticipantUser;
        team?: Team | null;
        invites?: PendingInviteSummary[];
        error?: string;
      };
      if (!res.ok || !data.token || !data.user) {
        notify('error', data.error ?? 'Registration failed.');
        return false;
      }
      localStorage.setItem(PARTICIPANT_TOKEN_KEY, data.token);
      setParticipantToken(data.token);
      setParticipant(data.user);
      setActiveTeam(data.team ?? null);
      setPendingInvites(data.invites ?? []);
      notify('success', `Account created! Next, create a team or join with an invite code.`);
      return true;
    } catch {
      notify('error', 'Network error during registration.');
      return false;
    }
  };

  const handleParticipantLogin = async (payload: {
    email: string;
    password: string;
  }): Promise<boolean> => {
    try {
      const res = await fetch('/api/participants/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        token?: string;
        user?: ParticipantUser;
        team?: Team | null;
        invites?: PendingInviteSummary[];
        error?: string;
      };
      if (!res.ok || !data.token || !data.user) {
        notify('error', data.error ?? 'Sign in failed. Check email and password.');
        return false;
      }
      localStorage.setItem(PARTICIPANT_TOKEN_KEY, data.token);
      setParticipantToken(data.token);
      setParticipant(data.user);
      setActiveTeam(data.team ?? null);
      setPendingInvites(data.invites ?? []);
      if (data.team) {
        fetchTeamSubmissions(data.token);
      }
      notify('success', `Signed in as ${data.user.name}.`);
      return true;
    } catch {
      notify('error', 'Network error during sign in.');
      return false;
    }
  };

  const handleParticipantLogout = () => {
    localStorage.removeItem(PARTICIPANT_TOKEN_KEY);
    setParticipantToken(null);
    setParticipant(null);
    setActiveTeam(null);
    setPendingInvites([]);
    setTeamSubmissions([]);
    notify('success', 'Signed out from participant portal.');
  };

  const handleUpdateProfile = async (payload: {
    name: string;
  }): Promise<boolean> => {
    if (!participantToken) return false;
    try {
      const res = await fetch('/api/participants/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { user?: ParticipantUser; error?: string };
      if (!res.ok || !data.user) {
        notify('error', data.error ?? 'Could not update profile.');
        return false;
      }
      setParticipant(data.user);
      await fetchParticipantSession(participantToken);
      notify('success', 'Profile details updated.');
      return true;
    } catch {
      notify('error', 'Network error updating profile.');
      return false;
    }
  };

  const handleChangePassword = async (payload: {
    currentPassword: string;
    newPassword: string;
  }): Promise<boolean> => {
    if (!participantToken) return false;
    try {
      const res = await fetch('/api/participants/password', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        notify('error', data.error ?? 'Failed to change password.');
        return false;
      }
      notify('success', 'Password changed successfully. Use your new password on next sign in.');
      return true;
    } catch {
      notify('error', 'Network error changing password.');
      return false;
    }
  };

  const handleCreateTeam = async (payload: {
    teamName: string;
    teamCode: string;
  }): Promise<boolean> => {
    if (!participantToken) return false;
    try {
      const res = await fetch('/api/teams/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        team?: Team;
        user?: ParticipantUser;
        error?: string;
      };
      if (!res.ok || !data.team) {
        notify('error', data.error ?? 'Could not create team.');
        return false;
      }
      setActiveTeam(data.team);
      if (data.user) setParticipant(data.user);
      setPendingInvites([]);
      fetchTeamSubmissions(participantToken);
      notify('success', `Created team ${data.team.teamName} (${data.team.teamCode}).`);
      return true;
    } catch {
      notify('error', 'Network error creating team.');
      return false;
    }
  };

  const handleJoinTeam = async (code: string): Promise<boolean> => {
    if (!participantToken) return false;
    try {
      const res = await fetch('/api/teams/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json()) as {
        team?: Team;
        user?: ParticipantUser;
        error?: string;
      };
      if (!res.ok || !data.team) {
        notify('error', data.error ?? 'Could not join team.');
        return false;
      }
      setActiveTeam(data.team);
      if (data.user) setParticipant(data.user);
      setPendingInvites([]);
      fetchTeamSubmissions(participantToken);
      notify('success', `Joined team ${data.team.teamName} (${data.team.teamCode}).`);
      return true;
    } catch {
      notify('error', 'Network error joining team.');
      return false;
    }
  };

  const handleInviteTeammate = async (email: string): Promise<boolean> => {
    if (!participantToken) return false;
    try {
      const res = await fetch('/api/teams/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${participantToken}`,
        },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { team?: Team; error?: string };
      if (!res.ok || !data.team) {
        notify('error', data.error ?? 'Could not send invitation.');
        return false;
      }
      setActiveTeam(data.team);
      notify('success', `Invitation recorded for ${email}.`);
      return true;
    } catch {
      notify('error', 'Network error sending invitation.');
      return false;
    }
  };

  // ---------------- FILE DOWNLOADS & SUBMISSIONS ----------------

  const triggerBlobDownload = async (url: string, filename: string, token?: string | null) => {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? 'Download failed');
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleDownloadEvidence = async (
    caseItem: CaseStudy,
    fileItem: EvidenceFile,
    asAdmin = false
  ) => {
    try {
      const tokenToUse = asAdmin ? adminToken : participantToken;
      await triggerBlobDownload(
        `/api/cases/${caseItem.id}/files/${fileItem.id}/download`,
        fileItem.originalName,
        tokenToUse
      );
      notify('success', `Downloaded ${fileItem.originalName}.`);
      fetchCases(asAdmin ? adminToken : null);
      if (asAdmin && adminToken) {
        fetchAdminData(adminToken);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Unable to download evidence file.');
    }
  };

  const handleSubmitReport = async (formData: FormData): Promise<boolean> => {
    if (!participantToken) return false;
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${participantToken}` },
        body: formData,
      });
      const data = (await res.json()) as { submission?: Submission; error?: string };
      if (!res.ok || !data.submission) {
        notify('error', data.error ?? 'Failed to upload investigation report.');
        return false;
      }

      await fetchTeamSubmissions(participantToken);
      notify(
        'success',
        `Report "${data.submission.fileName}" submitted for ${data.submission.caseCode}.`
      );
      return true;
    } catch {
      notify('error', 'Upload failed. Check file size and network connection.');
      return false;
    }
  };

  const handleDownloadSubmission = async (submission: Submission, asAdmin = false) => {
    try {
      await triggerBlobDownload(
        `/api/submissions/${submission.id}/download`,
        submission.fileName,
        asAdmin ? adminToken : participantToken
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Unable to download report.');
    }
  };

  // ---------------- ADMIN HANDLERS ----------------

  const handleAdminLoginSuccess = (token: string, email: string) => {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    sessionStorage.setItem(ADMIN_EMAIL_KEY, email);
    setAdminToken(token);
    setAdminEmail(email);
    notify('success', 'Signed in to Crimeathon Admin Console.');
    fetchAdminData(token);
  };

  const handleAdminLogout = () => {
    fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_EMAIL_KEY);
    setAdminToken(null);
    fetchCases(null);
    notify('success', 'Signed out from Admin Console.');
  };

  const handleCreateCase = async (formData: FormData): Promise<boolean> => {
    if (!adminToken) return false;
    try {
      const res = await fetch('/api/admin/cases', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      });
      const data = (await res.json()) as { caseStudy?: CaseStudy; error?: string };
      if (!res.ok || !data.caseStudy) {
        notify('error', data.error ?? 'Failed to create case study.');
        return false;
      }
      notify('success', `Uploaded ${data.caseStudy.code}: ${data.caseStudy.title}.`);
      await fetchAdminData(adminToken);
      return true;
    } catch {
      notify('error', 'Error uploading case study files.');
      return false;
    }
  };

  const handleAttachFiles = async (caseId: string, formData: FormData): Promise<boolean> => {
    if (!adminToken) return false;
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: formData,
      });
      const data = (await res.json()) as { addedFiles?: EvidenceFile[]; error?: string };
      if (!res.ok) {
        notify('error', data.error ?? 'Could not attach files.');
        return false;
      }
      notify(
        'success',
        `Attached ${data.addedFiles?.length ?? 1} additional evidence file(s).`
      );
      await fetchAdminData(adminToken);
      return true;
    } catch {
      notify('error', 'Error attaching evidence files.');
      return false;
    }
  };

  const handleToggleCaseStatus = async (caseItem: CaseStudy) => {
    if (!adminToken) return;
    const nextStatus = caseItem.status === 'published' ? 'draft' : 'published';
    try {
      const res = await fetch(`/api/admin/cases/${caseItem.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        notify(
          'success',
          `${caseItem.code} is now ${nextStatus === 'published' ? 'Published' : 'Draft'}.`
        );
        await fetchAdminData(adminToken);
      }
    } catch {
      notify('error', 'Failed to update case status.');
    }
  };

  const handleDeleteFile = async (caseId: string, fileId: string) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        notify('success', 'Removed evidence file.');
        await fetchAdminData(adminToken);
      }
    } catch {
      notify('error', 'Could not delete evidence file.');
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`/api/admin/cases/${caseId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.ok) {
        notify('success', 'Deleted case study and attached artifacts.');
        await fetchAdminData(adminToken);
      }
    } catch {
      notify('error', 'Could not delete case study.');
    }
  };

  const handleEvaluateSubmission = async (
    submissionId: string,
    payload: { status: SubmissionStatus; score: number | null; judgeFeedback: string }
  ): Promise<boolean> => {
    if (!adminToken) return false;
    try {
      const res = await fetch(`/api/admin/submissions/${submissionId}/evaluate`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        notify('error', 'Failed to save judge evaluation.');
        return false;
      }
      notify('success', 'Saved judge evaluation & feedback.');
      await fetchAdminData(adminToken);
      return true;
    } catch {
      notify('error', 'Network error saving evaluation.');
      return false;
    }
  };

  const publishedCases = cases.filter((c) => c.status === 'published');

  return (
    <div className="min-h-screen flex flex-col noir-grid-bg text-[#F4F1EF]">
      <BrandHeader
        isAdminRoute={isAdminRoute}
        isParticipantLoggedIn={Boolean(participant)}
        onExitAdminRoute={() => navigateToPath('/')}
        onJumpToSection={handleJumpToSection}
        onParticipantLogout={handleParticipantLogout}
        onOpenAuthTab={(tab) => setInitialAuthTab(tab)}
      />

      {/* Toast Feedback */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm">
          <div
            role="status"
            className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-xs shadow-lg ${
              toast.kind === 'success'
                ? 'border-emerald-500/30 bg-[#141A16] text-emerald-200'
                : 'border-[#C94146]/40 bg-[#1F1214] text-[#F5B7B9]'
            }`}
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : (
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#E05358]" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="text-white/60 hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1">
        {!isAdminRoute ? (
          <ParticipantPortal
            cases={publishedCases}
            loadingCases={loadingCases}
            participant={participant}
            activeTeam={activeTeam}
            pendingInvites={pendingInvites}
            teamSubmissions={teamSubmissions}
            initialAuthTab={initialAuthTab}
            initialInviteCode={initialInviteCode}
            onRegister={handleParticipantRegister}
            onLogin={handleParticipantLogin}
            onUpdateProfile={handleUpdateProfile}
            onChangePassword={handleChangePassword}
            onCreateTeam={handleCreateTeam}
            onJoinTeam={handleJoinTeam}
            onInviteTeammate={handleInviteTeammate}
            onDownloadEvidence={(c, f) => handleDownloadEvidence(c, f, false)}
            onSubmitReport={handleSubmitReport}
            onDownloadSubmission={(sub) => handleDownloadSubmission(sub, false)}
          />
        ) : adminToken ? (
          <AdminDashboard
            adminEmail={adminEmail}
            cases={cases}
            stats={adminStats}
            activities={adminActivities}
            teams={adminTeams}
            submissions={adminSubmissions}
            refreshing={refreshingAdmin}
            onRefresh={() => fetchAdminData(adminToken)}
            onLogout={handleAdminLogout}
            onCreateCase={handleCreateCase}
            onAttachFiles={handleAttachFiles}
            onToggleCaseStatus={handleToggleCaseStatus}
            onDeleteFile={handleDeleteFile}
            onDeleteCase={handleDeleteCase}
            onDownloadEvidence={(c, f) => handleDownloadEvidence(c, f, true)}
            onDownloadSubmission={(sub) => handleDownloadSubmission(sub, true)}
            onEvaluateSubmission={handleEvaluateSubmission}
          />
        ) : (
          <AdminLogin
            onLoginSuccess={handleAdminLoginSuccess}
            onCancel={() => navigateToPath('/')}
          />
        )}
      </div>

      {/* Quiet Institutional Footer (zero Admin Console exposure) */}
      <footer className="mt-12 border-t border-white/10 bg-[#0A0708]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="text-xs text-[#9E9592]">
            <span className="font-semibold text-white">Crimeathon Hub</span>
            <span aria-hidden="true"> · </span>
            <span>Sentrix Cyber Club, SIMATS Engineering</span>
          </div>
          <div className="text-xs text-[#9E9592]">
            Cyber Crime Investigation &amp; Forensics Hackathon
          </div>
        </div>
      </footer>
    </div>
  );
}
