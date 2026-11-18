import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileCheck2,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  KeyRound,
  MailPlus,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type {
  CaseStudy,
  EvidenceFile,
  ParticipantUser,
  PendingInviteSummary,
  Submission,
  Team,
} from '../types.ts';
import { formatBytes, formatTimestamp } from '../utils/format.ts';

interface ParticipantPortalProps {
  cases: CaseStudy[];
  loadingCases: boolean;
  participant: ParticipantUser | null;
  activeTeam: Team | null;
  pendingInvites: PendingInviteSummary[];
  teamSubmissions: Submission[];
  initialAuthTab: 'login' | 'register';
  initialInviteCode: string;
  onRegister: (payload: {
    name: string;
    email: string;
    password: string;
  }) => Promise<boolean>;
  onLogin: (payload: { email: string; password: string }) => Promise<boolean>;
  onUpdateProfile: (payload: { name: string }) => Promise<boolean>;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<boolean>;
  onCreateTeam: (payload: { teamName: string; teamCode: string }) => Promise<boolean>;
  onJoinTeam: (code: string) => Promise<boolean>;
  onInviteTeammate: (email: string) => Promise<boolean>;
  onDownloadEvidence: (caseItem: CaseStudy, fileItem: EvidenceFile) => void;
  onSubmitReport: (formData: FormData) => Promise<boolean>;
  onDownloadSubmission: (submission: Submission) => void;
}

function getFileIcon(extension: string) {
  const ext = extension.toLowerCase();
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
    return <FileArchive className="h-4 w-4 text-[#D94B50]" />;
  }
  if (['.csv', '.xlsx', '.xls'].includes(ext)) {
    return <FileSpreadsheet className="h-4 w-4 text-[#38BDF8]" />;
  }
  if (['.json', '.log', '.pcap', '.pcapng', '.md'].includes(ext)) {
    return <FileCode2 className="h-4 w-4 text-[#38BDF8]" />;
  }
  return <FileText className="h-4 w-4 text-[#D4CCC9]" />;
}

function renderStatusLabel(status: Submission['status']) {
  if (status === 'Evaluated') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Evaluated
      </span>
    );
  }
  if (status === 'Under Review') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
        <Clock className="h-3.5 w-3.5" />
        Under Review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#38BDF8]">
      <FileCheck2 className="h-3.5 w-3.5" />
      Submitted
    </span>
  );
}

export function ParticipantPortal({
  cases,
  loadingCases,
  participant,
  activeTeam,
  pendingInvites,
  teamSubmissions,
  initialAuthTab,
  initialInviteCode,
  onRegister,
  onLogin,
  onUpdateProfile,
  onChangePassword,
  onCreateTeam,
  onJoinTeam,
  onInviteTeammate,
  onDownloadEvidence,
  onSubmitReport,
  onDownloadSubmission,
}: ParticipantPortalProps) {
  // Auth state
  const [authTab, setAuthTab] = useState<'login' | 'register'>(initialAuthTab);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // Team & Profile Workspace state
  const [hubTab, setHubTab] = useState<'team' | 'profile'>('team');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamCode, setNewTeamCode] = useState('');
  const [joinCode, setJoinCode] = useState(initialInviteCode);
  const [inviteEmail, setInviteEmail] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);

  // Profile & Password change state
  const [profileName, setProfileName] = useState(participant?.name ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // Case Vault Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Report Submission state
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [summary, setSummary] = useState('');
  const [methodology, setMethodology] = useState('');
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setAuthTab(initialAuthTab);
  }, [initialAuthTab]);

  useEffect(() => {
    if (initialInviteCode) {
      setJoinCode(initialInviteCode);
    }
  }, [initialInviteCode]);

  useEffect(() => {
    if (participant) {
      setProfileName(participant.name);
    }
  }, [participant]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(cases.map((c) => c.category)));
    return ['All', ...unique];
  }, [cases]);

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      const matchesCat = selectedCategory === 'All' || c.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return matchesCat;
      const inFiles = c.files.some((f) => f.originalName.toLowerCase().includes(q));
      return (
        matchesCat &&
        (c.title.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.briefing.toLowerCase().includes(q) ||
          inFiles)
      );
    });
  }, [cases, searchQuery, selectedCategory]);

  const totalEvidenceFiles = useMemo(
    () => cases.reduce((sum, c) => sum + c.files.length, 0),
    [cases]
  );

  const effectiveCaseId = selectedCaseId || (cases[0]?.id ?? '');

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    const ok = await onLogin({ email: loginEmail.trim(), password: loginPassword });
    setAuthBusy(false);
    if (ok) {
      setLoginPassword('');
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (regPassword.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }
    if (regPassword !== regConfirm) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthBusy(true);
    const ok = await onRegister({
      name: regName.trim(),
      email: regEmail.trim(),
      password: regPassword,
    });
    setAuthBusy(false);
    if (ok) {
      setRegPassword('');
      setRegConfirm('');
    }
  };

  const handleCreateTeamSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTeamBusy(true);
    const ok = await onCreateTeam({
      teamName: newTeamName.trim(),
      teamCode: newTeamCode.trim(),
    });
    setTeamBusy(false);
    if (ok) {
      setNewTeamName('');
      setNewTeamCode('');
    }
  };

  const handleJoinTeamSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setTeamBusy(true);
    const ok = await onJoinTeam(joinCode.trim());
    setTeamBusy(false);
    if (ok) {
      setJoinCode('');
    }
  };

  const handleInviteSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setTeamBusy(true);
    const ok = await onInviteTeammate(inviteEmail.trim());
    setTeamBusy(false);
    if (ok) {
      setInviteEmail('');
    }
  };

  const handleCopyInviteLink = async () => {
    if (!activeTeam) return;
    const url = `${window.location.origin}/?invite=${encodeURIComponent(activeTeam.inviteCode)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const handleProfileSave = async (e: FormEvent) => {
    e.preventDefault();
    setProfileBusy(true);
    await onUpdateProfile({
      name: profileName.trim(),
    });
    setProfileBusy(false);
  };

  const handlePasswordChangeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    const ok = await onChangePassword({
      currentPassword,
      newPassword,
    });
    setPwBusy(false);
    if (ok) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setReportFile(dropped);
    }
  };

  const handleSelectForSubmission = (caseId: string) => {
    setSelectedCaseId(caseId);
    document.getElementById('submit-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleReportFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reportFile || !effectiveCaseId || !activeTeam) return;

    const formData = new FormData();
    formData.append('caseId', effectiveCaseId);
    formData.append('summary', summary.trim());
    formData.append('methodology', methodology.trim());
    formData.append('reportFile', reportFile);

    setSubmittingReport(true);
    const ok = await onSubmitReport(formData);
    setSubmittingReport(false);
    if (ok) {
      setSummary('');
      setMethodology('');
      setReportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10 space-y-12">
      {/* Hero Banner & Branding Split */}
      <section id="event-overview" className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
          {/* Left Hero Column */}
          <div className="lg:col-span-7 flex flex-col justify-between rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-8">
            <div className="space-y-6">
              {/* Institutional & Club Branding Lockup */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-1.5">
                  <img
                    src="/assets/aistudio/saveetha_logo_for_report_998094ef.jpg"
                    alt="SIMATS Engineering"
                    referrerPolicy="no-referrer"
                    className="h-9 w-auto object-contain"
                  />
                </div>
                <div className="flex items-center gap-2.5 rounded-lg bg-white px-3 py-1.5">
                  <img
                    src="/assets/aistudio/senrtric_log_d0085b60.jpeg"
                    alt="Sentrix Cyber Club"
                    referrerPolicy="no-referrer"
                    className="h-9 w-auto object-contain"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium tracking-wide text-[#38BDF8]">
                  Sentrix Cyber Club · SIMATS Engineering
                </p>
                <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[2.65rem] lg:leading-[1.12] [text-wrap:balance]">
                  Cyber Crime Investigation &amp; Forensics Hackathon
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-[#C2B9B6] sm:text-base">
                  Register your participant account, form or join your investigation team, download
                  case study dossiers and raw evidence packs, and submit your forensic report for
                  judge evaluation.
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {participant ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      document.getElementById('case-vault')?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="rounded-lg bg-[#C94146] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Browse Case Vault
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('team-profile-hub')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="rounded-lg border border-white/15 bg-[#1B1416] px-5 py-2.5 text-sm font-semibold text-[#F4F1EF] hover:bg-[#251C1F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Manage Team &amp; Profile
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('register');
                      document
                        .getElementById('participant-auth')
                        ?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="rounded-lg bg-[#C94146] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Register First Time
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      document
                        .getElementById('participant-auth')
                        ?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="rounded-lg border border-white/15 bg-[#1B1416] px-5 py-2.5 text-sm font-semibold text-[#F4F1EF] hover:bg-[#251C1F] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Participant Sign In
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right Hero Column: Signature Crimeathon Event Logo */}
          <div className="lg:col-span-5 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#12090A]">
            <div className="relative flex-1 min-h-[220px] bg-[#12090A] flex items-center justify-center p-4">
              <img
                src="/assets/aistudio/crimelog_242617f8.jpeg"
                alt="Crimeathon by Sentrix Cyber Club Event Logo"
                referrerPolicy="no-referrer"
                className="h-full max-h-[280px] w-full object-contain rounded-lg"
              />
            </div>
            <div className="border-t border-white/10 bg-[#171012] px-5 py-3.5 flex items-center justify-between gap-4 text-xs text-[#B8B0AD]">
              <span>Participant Investigation Portal</span>
              <span className="font-mono text-[#E05358]">Case Files &amp; Report Desk</span>
            </div>
          </div>
        </div>

        {/* Full-Width Operational Summary Strip */}
        <div className="grid grid-cols-1 divide-y divide-white/10 rounded-xl border border-white/10 bg-[#140F11] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-6 py-4">
            <p className="text-xs text-[#9E9592]">Published Case Studies</p>
            <p className="mt-1 font-display text-2xl font-bold text-white tabular-nums">
              {cases.length}
            </p>
          </div>
          <div className="px-6 py-4">
            <p className="text-xs text-[#9E9592]">Evidence Artifacts Ready</p>
            <p className="mt-1 font-display text-2xl font-bold text-white tabular-nums">
              {totalEvidenceFiles}
            </p>
          </div>
          <div className="px-6 py-4">
            <p className="text-xs text-[#9E9592]">Accepted Report Formats</p>
            <p className="mt-1 font-mono text-sm font-medium text-[#E05358]">
              PDF · DOCX · PPTX · ZIP · TXT · CSV · JSON · PNG
            </p>
          </div>
        </div>
      </section>

      {/* NOT SIGNED IN: Participant Registration & Login Gate */}
      {!participant ? (
        <section
          id="participant-auth"
          className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start"
        >
          <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">
                  {authTab === 'login' ? 'Participant Sign In' : 'First-Time Registration'}
                </h2>
                <p className="mt-1 text-xs text-[#A39A97]">
                  {authTab === 'login'
                    ? 'Sign in with your registered email and password to view your team, download evidence, and submit reports.'
                    : 'Create your participant account first, then create a new team or join an existing team via invite code.'}
                </p>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0C090A] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('login');
                    setAuthError(null);
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    authTab === 'login'
                      ? 'bg-[#C94146] text-white'
                      : 'text-[#B8B0AD] hover:text-white'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('register');
                    setAuthError(null);
                  }}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    authTab === 'register'
                      ? 'bg-[#C94146] text-white'
                      : 'text-[#B8B0AD] hover:text-white'
                  }`}
                >
                  Register
                </button>
              </div>
            </div>

            {initialInviteCode && (
              <div className="mb-5 rounded-lg border border-[#38BDF8]/30 bg-[#38BDF8]/10 px-4 py-2.5 text-xs text-[#BAE6FD]">
                Invite code <span className="font-mono font-semibold">{initialInviteCode}</span>{' '}
                detected. Sign in or register to join that team automatically in the next step.
              </div>
            )}

            {authError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-[#C94146]/40 bg-[#C94146]/10 px-3.5 py-2.5 text-xs text-[#F5B7B9]"
              >
                {authError}
              </div>
            )}

            {authTab === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                    Registered Email *
                  </label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="you@simats.edu.in"
                    className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showLoginPw ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 pr-10 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPw((prev) => !prev)}
                      aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-[#8E8582] hover:text-white cursor-pointer"
                    >
                      {showLoginPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-lg bg-[#C94146] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {authBusy ? 'Signing In...' : 'Sign In to Dashboard'}
                </button>

                <div className="border-t border-white/10 pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#9E9592]">
                  <span>Sample returning account: kavya.r@simats.edu.in</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginEmail('kavya.r@simats.edu.in');
                      setLoginPassword('Cipher@123');
                    }}
                    className="font-medium text-[#38BDF8] hover:text-white cursor-pointer"
                  >
                    Fill Demo Credentials
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Priya Nair"
                    className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="priya.n@simats.edu.in"
                    className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Create Password *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full rounded-lg bg-[#C94146] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {authBusy ? 'Creating Account...' : 'Create Account & Continue'}
                </button>
              </form>
            )}
          </div>

          {/* Published Case Overview Preview */}
          <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-8 space-y-5">
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Active Hackathon Case Studies
              </h2>
              <p className="mt-1 text-xs text-[#A39A97]">
                Sign in or register on the left to unlock evidence file downloads and report
                submission for your team.
              </p>
            </div>

            {loadingCases ? (
              <div className="h-36 animate-pulse rounded-lg border border-white/10 bg-[#0C090A]" />
            ) : cases.length === 0 ? (
              <p className="text-sm text-[#8E8582]">
                Case studies will appear here once released by the organizers.
              </p>
            ) : (
              <div className="divide-y divide-white/10">
                {cases.map((c) => (
                  <div key={c.id} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-[#A39A97]">
                      <span className="font-mono font-semibold text-[#E05358]">{c.code}</span>
                      <span aria-hidden="true">·</span>
                      <span>{c.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{c.difficulty}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{c.files.length} files</span>
                    </div>
                    <h3 className="font-display text-base font-semibold text-white">{c.title}</h3>
                    <p className="text-xs leading-relaxed text-[#B8B0AD]">{c.briefing}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* SIGNED IN: TEAM DETAILS, INVITES, PROFILE & PASSWORD DASHBOARD HUB */}
          <section
            id="team-profile-hub"
            className="rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-7 space-y-6"
          >
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#38BDF8]/10 text-[#38BDF8]">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-white">
                    Welcome, {participant.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-[#A39A97]">
                    <span>{participant.email}</span>
                    {activeTeam && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-semibold text-white">{activeTeam.teamName}</span>
                        <span className="font-mono text-[#E05358]"> ({activeTeam.teamCode})</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0C090A] p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setHubTab('team')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    hubTab === 'team'
                      ? 'bg-[#C94146] text-white'
                      : 'text-[#B8B0AD] hover:text-white'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  Team Details &amp; Invites
                </button>
                <button
                  type="button"
                  onClick={() => setHubTab('profile')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    hubTab === 'profile'
                      ? 'bg-[#C94146] text-white'
                      : 'text-[#B8B0AD] hover:text-white'
                  }`}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Profile &amp; Password
                </button>
              </div>
            </div>

            {hubTab === 'team' ? (
              !activeTeam ? (
                <div className="space-y-6">
                  {/* Pending email invitations for this user */}
                  {pendingInvites.length > 0 && (
                    <div className="rounded-lg border border-[#38BDF8]/30 bg-[#38BDF8]/10 p-4 space-y-3">
                      <p className="text-xs font-semibold text-white">
                        You have {pendingInvites.length} pending team{' '}
                        {pendingInvites.length === 1 ? 'invitation' : 'invitations'}
                      </p>
                      <div className="space-y-2">
                        {pendingInvites.map((inv) => (
                          <div
                            key={`${inv.teamId}-${inv.inviteCode}`}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-xs"
                          >
                            <div>
                              <span className="font-semibold text-white">{inv.teamName}</span>{' '}
                              <span className="font-mono text-[#E05358]">({inv.teamCode})</span>
                              <span className="text-[#9E9592]">
                                {' '}
                                · Invited by {inv.invitedBy}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={teamBusy}
                              onClick={() => onJoinTeam(inv.inviteCode)}
                              className="rounded-md bg-[#C94146] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#D94B50] cursor-pointer"
                            >
                              Accept &amp; Join Team
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Create Team OR Join Existing Team */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Create Team */}
                    <form
                      onSubmit={handleCreateTeamSubmit}
                      className="rounded-lg border border-white/10 bg-[#0C090A] p-5 space-y-4"
                    >
                      <div className="flex items-center gap-2">
                        <UserPlus className="h-4 w-4 text-[#E05358]" />
                        <h3 className="font-display text-base font-bold text-white">
                          Create a New Team
                        </h3>
                      </div>
                      <p className="text-xs text-[#9E9592]">
                        Start a team as Team Leader. Once created, you will get an invite code and
                        shareable link to invite your teammates.
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-[#D4CCC9]">Team Name *</label>
                          <input
                            type="text"
                            required
                            value={newTeamName}
                            onChange={(e) => setNewTeamName(e.target.value)}
                            placeholder="Shadow Analysts"
                            className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[#D4CCC9]">
                            Custom Team Code (optional)
                          </label>
                          <input
                            type="text"
                            value={newTeamCode}
                            onChange={(e) => setNewTeamCode(e.target.value)}
                            placeholder="Auto (e.g. TEAM-103)"
                            className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={teamBusy}
                        className="rounded-lg bg-[#C94146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {teamBusy ? 'Creating Team...' : 'Create Team'}
                      </button>
                    </form>

                    {/* Join Existing Team */}
                    <form
                      onSubmit={handleJoinTeamSubmit}
                      className="rounded-lg border border-white/10 bg-[#0C090A] p-5 space-y-4"
                    >
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-[#38BDF8]" />
                        <h3 className="font-display text-base font-bold text-white">
                          Join an Existing Team
                        </h3>
                      </div>
                      <p className="text-xs text-[#9E9592]">
                        Enter the Team Code (e.g. <span className="font-mono">TEAM-101</span>) or
                        Invite Code (e.g. <span className="font-mono">INV-CW101</span>) shared by
                        your team leader.
                      </p>
                      <div>
                        <label className="mb-1 block text-xs text-[#D4CCC9]">
                          Team Code or Invite Code *
                        </label>
                        <input
                          type="text"
                          required
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value)}
                          placeholder="INV-XXXXXX or TEAM-101"
                          className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={teamBusy}
                        className="rounded-lg border border-white/15 bg-[#1B1416] px-4 py-2 text-xs font-semibold text-white hover:border-[#38BDF8] hover:bg-[#241B1E] disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {teamBusy ? 'Joining...' : 'Join Team'}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                /* Active Team Details, Roster & Invite Controls */
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  {/* Team Metadata & Roster */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="grid grid-cols-1 gap-4 rounded-lg border border-white/10 bg-[#0C090A] p-4 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-[#8E8582]">Team Name</p>
                        <p className="mt-1 font-display text-base font-bold text-white">
                          {activeTeam.teamName}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#8E8582]">Team Code</p>
                        <p className="mt-1 font-mono text-sm font-semibold text-[#E05358]">
                          {activeTeam.teamCode}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#8E8582]">Invite Code</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-[#38BDF8]">
                            {activeTeam.inviteCode}
                          </span>
                          <button
                            type="button"
                            onClick={handleCopyInviteLink}
                            className="inline-flex items-center gap-1 rounded border border-white/15 bg-[#191315] px-2 py-0.5 text-xs text-white hover:border-[#38BDF8] cursor-pointer"
                          >
                            {copiedLink ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                Copy Link
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-[#0C090A] p-4">
                      <p className="mb-3 text-xs font-semibold text-[#D4CCC9]">
                        Team Members ({activeTeam.membersList.length})
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-white/10 text-[#8E8582]">
                              <th className="py-2 pr-3 font-medium">Name</th>
                              <th className="py-2 px-3 font-medium">Email</th>
                              <th className="py-2 px-3 font-medium">Role</th>
                              <th className="py-2 pl-3 font-medium text-right">Joined</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.06]">
                            {activeTeam.membersList.map((member) => (
                              <tr key={member.userId}>
                                <td className="py-2.5 pr-3 font-medium text-white">
                                  {member.name}
                                </td>
                                <td className="py-2.5 px-3 text-[#B8B0AD]">{member.email}</td>
                                <td className="py-2.5 px-3 font-mono text-[#38BDF8]">
                                  {member.role}
                                </td>
                                <td className="py-2.5 pl-3 text-right font-mono text-[#8E8582] tabular-nums">
                                  {formatTimestamp(member.joinedAt)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Invite Teammates Panel */}
                  <div className="lg:col-span-5 rounded-lg border border-white/10 bg-[#0C090A] p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <MailPlus className="h-4 w-4 text-[#E05358]" />
                      <h3 className="font-display text-base font-bold text-white">
                        Invite Teammates
                      </h3>
                    </div>
                    <p className="text-xs text-[#9E9592]">
                      Send an invite to a teammate&apos;s email so they see an instant join prompt
                      when they log in, or share your invite code{' '}
                      <span className="font-mono text-[#38BDF8]">{activeTeam.inviteCode}</span>.
                    </p>

                    <form onSubmit={handleInviteSubmit} className="flex gap-2">
                      <input
                        type="email"
                        required
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="teammate@simats.edu.in"
                        className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={teamBusy}
                        className="rounded-lg bg-[#C94146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Send Invite
                      </button>
                    </form>

                    <div className="border-t border-white/10 pt-3">
                      <p className="text-xs font-semibold text-[#D4CCC9]">
                        Pending Invitations ({activeTeam.pendingInvites.length})
                      </p>
                      {activeTeam.pendingInvites.length === 0 ? (
                        <p className="mt-1.5 text-xs text-[#8E8582]">
                          No pending email invitations.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {activeTeam.pendingInvites.map((inv) => (
                            <li
                              key={inv.id}
                              className="flex items-center justify-between gap-2 text-xs text-[#B8B0AD]"
                            >
                              <span className="truncate">{inv.email}</span>
                              <span className="font-mono text-[#8E8582] tabular-nums shrink-0">
                                {formatTimestamp(inv.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* Profile & Change Password Tab */
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <form
                  onSubmit={handleProfileSave}
                  className="rounded-lg border border-white/10 bg-[#0C090A] p-5 space-y-4"
                >
                  <h3 className="font-display text-base font-bold text-white">
                    Participant Profile
                  </h3>
                  <div>
                    <label className="mb-1 block text-xs text-[#D4CCC9]">Email Address</label>
                    <input
                      type="email"
                      disabled
                      value={participant.email}
                      className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-[#8E8582]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#D4CCC9]">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={profileBusy}
                    className="rounded-lg bg-[#C94146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 cursor-pointer"
                  >
                    {profileBusy ? 'Saving...' : 'Save Profile'}
                  </button>
                </form>

                <form
                  onSubmit={handlePasswordChangeSubmit}
                  className="rounded-lg border border-white/10 bg-[#0C090A] p-5 space-y-4"
                >
                  <h3 className="font-display text-base font-bold text-white">
                    Change Password
                  </h3>
                  {pwError && (
                    <p className="rounded border border-[#C94146]/40 bg-[#C94146]/10 px-3 py-2 text-xs text-[#F5B7B9]">
                      {pwError}
                    </p>
                  )}
                  <div>
                    <label className="mb-1 block text-xs text-[#D4CCC9]">
                      Current Password *
                    </label>
                    <input
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-[#D4CCC9]">New Password *</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[#D4CCC9]">
                        Confirm New Password *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={pwBusy}
                    className="rounded-lg border border-white/15 bg-[#1B1416] px-4 py-2 text-xs font-semibold text-white hover:border-[#C94146] hover:bg-[#C94146] disabled:opacity-60 transition-colors cursor-pointer"
                  >
                    {pwBusy ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              </div>
            )}
          </section>

          {/* Case Studies & Evidence Vault */}
          <section id="case-vault" className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">
                  Case Studies &amp; Evidence Vault
                </h2>
                <p className="mt-1 text-sm text-[#A39A97]">
                  Download problem statements, logs, captures, and financial trails released by the
                  Crimeathon organizing team.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7D7471]" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search case or filename..."
                    className="w-full sm:w-64 rounded-lg border border-white/10 bg-[#140F11] py-2 pl-9 pr-3 text-sm text-white placeholder-[#7D7471] focus:border-[#C94146] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#140F11] p-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedCategory === cat
                          ? 'bg-[#C94146] text-white'
                          : 'text-[#B8B0AD] hover:text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loadingCases ? (
              <div className="grid grid-cols-1 gap-5">
                {[1, 2].map((n) => (
                  <div
                    key={n}
                    className="h-52 animate-pulse rounded-xl border border-white/10 bg-[#140F11]"
                  />
                ))}
              </div>
            ) : filteredCases.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#140F11] px-6 py-12 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-[#7D7471]" />
                <h3 className="mt-3 font-display text-base font-semibold text-white">
                  No matching case studies published
                </h3>
                <p className="mt-1 text-sm text-[#9E9592]">
                  Adjust your search filter or check back once new cases are released.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredCases.map((caseItem) => (
                  <article
                    key={caseItem.id}
                    className="rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-7"
                  >
                    <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#A39A97]">
                          <span className="font-mono font-semibold text-[#E05358]">
                            {caseItem.code}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{caseItem.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{caseItem.difficulty}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {caseItem.files.length} evidence{' '}
                            {caseItem.files.length === 1 ? 'file' : 'files'}
                          </span>
                        </div>
                        <h3 className="font-display text-xl font-bold text-white">
                          {caseItem.title}
                        </h3>
                        <p className="max-w-3xl text-sm leading-relaxed text-[#C2B9B6]">
                          {caseItem.briefing}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectForSubmission(caseItem.id)}
                        className="rounded-lg border border-[#C94146]/50 bg-[#C94146]/10 px-4 py-2 text-xs font-semibold text-[#F5B7B9] hover:bg-[#C94146] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Submit Report for {caseItem.code}
                      </button>
                    </div>

                    {caseItem.objectives.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-semibold text-[#D4CCC9]">
                          Investigative Objectives
                        </p>
                        <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {caseItem.objectives.map((obj, idx) => (
                            <li
                              key={idx}
                              className="text-xs leading-relaxed text-[#A39A97] flex items-start gap-2"
                            >
                              <span className="font-mono text-[#E05358]">0{idx + 1}.</span>
                              <span>{obj}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-5 overflow-x-auto">
                      {caseItem.files.length === 0 ? (
                        <p className="text-xs text-[#8E8582]">
                          No downloadable evidence files attached yet.
                        </p>
                      ) : (
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-white/10 text-xs text-[#8E8582]">
                              <th className="py-2.5 pr-4 font-medium">Evidence / Challenge File</th>
                              <th className="py-2.5 px-3 font-medium">Format</th>
                              <th className="py-2.5 px-3 font-medium">Size</th>
                              <th className="py-2.5 px-3 font-medium hidden md:table-cell">
                                SHA-256 Digest
                              </th>
                              <th className="py-2.5 px-3 font-medium text-right">Downloads</th>
                              <th className="py-2.5 pl-3 font-medium text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.06]">
                            {caseItem.files.map((file) => (
                              <tr key={file.id} className="hover:bg-white/[0.02]">
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2.5">
                                    {getFileIcon(file.extension)}
                                    <span className="font-medium text-white break-all">
                                      {file.originalName}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-mono text-xs uppercase text-[#A39A97]">
                                  {file.extension.replace('.', '')}
                                </td>
                                <td className="py-3 px-3 font-mono text-xs text-[#C2B9B6] tabular-nums whitespace-nowrap">
                                  {formatBytes(file.sizeBytes)}
                                </td>
                                <td className="py-3 px-3 font-mono text-xs text-[#8E8582] hidden md:table-cell">
                                  {file.sha256.slice(0, 12)}...
                                </td>
                                <td className="py-3 px-3 font-mono text-xs text-[#A39A97] text-right tabular-nums">
                                  {file.downloadCount}
                                </td>
                                <td className="py-3 pl-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => onDownloadEvidence(caseItem, file)}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-[#1B1416] px-3 py-1.5 text-xs font-semibold text-white hover:border-[#C94146] hover:bg-[#C94146] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Investigation Report Submission Desk & Team History */}
          <section
            id="submit-report"
            className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start"
          >
            <div className="lg:col-span-6 rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-7">
              <div className="mb-6">
                <h2 className="font-display text-2xl font-bold text-white">
                  Investigation Report Submission Desk
                </h2>
                <p className="mt-1 text-sm text-[#A39A97]">
                  Upload your team&apos;s completed forensic report for review by the judging
                  panel. Supports PDF, DOCX, PPTX, ZIP, TXT, Markdown, CSV, JSON, spreadsheets, and
                  images up to 50 MB.
                </p>
              </div>

              {!activeTeam ? (
                <div className="rounded-lg border border-white/10 bg-[#0C090A] px-5 py-8 text-center space-y-3">
                  <p className="text-sm font-semibold text-white">
                    Create or join a team first to submit a report
                  </p>
                  <p className="text-xs text-[#9E9592]">
                    All investigation reports are linked to your team so teammates and judges track
                    a unified submission.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('team-profile-hub')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="rounded-lg bg-[#C94146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D94B50] cursor-pointer"
                  >
                    Go to Team Setup
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReportFormSubmit} className="space-y-4">
                  <div className="rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-xs text-[#B8B0AD]">
                    Submitting as{' '}
                    <span className="font-semibold text-white">{activeTeam.teamName}</span>{' '}
                    <span className="font-mono text-[#E05358]">({activeTeam.teamCode})</span>
                  </div>

                  <div>
                    <label
                      htmlFor="submission-case"
                      className="mb-1.5 block text-xs font-medium text-[#D4CCC9]"
                    >
                      Target Case Study *
                    </label>
                    <select
                      id="submission-case"
                      required
                      value={effectiveCaseId}
                      onChange={(e) => setSelectedCaseId(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white focus:border-[#C94146] focus:outline-none"
                    >
                      {cases.length === 0 ? (
                        <option value="">No published cases available</option>
                      ) : (
                        cases.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} — {c.title}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="report-summary"
                      className="mb-1.5 block text-xs font-medium text-[#D4CCC9]"
                    >
                      Executive Findings Summary *
                    </label>
                    <textarea
                      id="report-summary"
                      required
                      rows={3}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                      placeholder="Summarize root cause, compromised accounts/IPs, exfiltration indicators, and key conclusions..."
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="report-methodology"
                      className="mb-1.5 block text-xs font-medium text-[#D4CCC9]"
                    >
                      Tools &amp; Forensic Methodology
                    </label>
                    <input
                      id="report-methodology"
                      type="text"
                      value={methodology}
                      onChange={(e) => setMethodology(e.target.value)}
                      placeholder="e.g., Wireshark PCAP filtering, log correlation, timeline reconstruction"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Investigation Report File *
                    </label>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors cursor-pointer ${
                        isDragging
                          ? 'border-[#C94146] bg-[#C94146]/10'
                          : 'border-white/15 bg-[#0C090A] hover:border-white/30'
                      }`}
                    >
                      <UploadCloud className="h-7 w-7 text-[#E05358]" />
                      <p className="mt-2 text-sm font-medium text-white">
                        Drop your investigation report here, or click to browse
                      </p>
                      <p className="mt-1 text-xs text-[#8E8582]">
                        Accepts .pdf, .docx, .pptx, .zip, .txt, .md, .csv, .json, .xlsx, .png, .jpg
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,.zip,.rar,.7z,.txt,.md,.csv,.json,.xlsx,.xls,.png,.jpg,.jpeg"
                        onChange={(e) => setReportFile(e.target.files?.[0] ?? null)}
                        className="hidden"
                      />
                    </div>

                    {reportFile && (
                      <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#191315] px-3.5 py-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 shrink-0 text-[#38BDF8]" />
                          <span className="truncate font-medium text-white">{reportFile.name}</span>
                          <span className="font-mono text-[#9E9592] shrink-0 tabular-nums">
                            ({formatBytes(reportFile.size)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setReportFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          aria-label="Remove selected file"
                          className="text-[#A39A97] hover:text-white cursor-pointer"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={submittingReport || !reportFile || cases.length === 0}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C94146] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                    {submittingReport ? 'Uploading Investigation Report...' : 'Submit Report to Judges'}
                  </button>
                </form>
              )}
            </div>

            {/* Team Submissions & Judge Status */}
            <div
              id="my-submissions"
              className="lg:col-span-6 rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-7"
            >
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-white">
                    Team Submissions &amp; Judge Status
                  </h2>
                  <p className="mt-1 text-xs text-[#A39A97]">
                    {activeTeam
                      ? `Showing reports submitted by ${activeTeam.teamName} (${activeTeam.teamCode})`
                      : 'Create or join a team to track submitted reports and judge feedback.'}
                  </p>
                </div>
                <ShieldCheck className="h-5 w-5 shrink-0 text-[#38BDF8]" />
              </div>

              {!activeTeam ? (
                <div className="rounded-lg border border-white/10 bg-[#0C090A] px-5 py-10 text-center">
                  <p className="text-sm font-medium text-white">No team linked yet</p>
                  <p className="mt-1 text-xs text-[#8E8582]">
                    Create a new team or join an existing team in the Team Details section above.
                  </p>
                </div>
              ) : teamSubmissions.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-[#0C090A] px-5 py-10 text-center">
                  <p className="text-sm font-medium text-white">No reports submitted yet</p>
                  <p className="mt-1 text-xs text-[#8E8582]">
                    Once your team submits an investigation report on the left, it will appear here
                    with live evaluation status.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {teamSubmissions.map((sub) => (
                    <div key={sub.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-[#A39A97]">
                            <span className="font-mono font-semibold text-[#E05358]">
                              {sub.caseCode}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatTimestamp(sub.submittedAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-white">{sub.caseTitle}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {renderStatusLabel(sub.status)}
                          {sub.score !== null && (
                            <span className="font-mono text-xs font-semibold text-white tabular-nums">
                              {sub.score}/100
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-xs leading-relaxed text-[#B8B0AD]">{sub.summary}</p>

                      {sub.judgeFeedback && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
                          <span className="font-semibold text-emerald-300">Judges&apos; Note: </span>
                          {sub.judgeFeedback}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 pt-1 text-xs text-[#8E8582]">
                        <span className="font-mono truncate">
                          {sub.fileName} ({formatBytes(sub.sizeBytes)})
                        </span>
                        <button
                          type="button"
                          onClick={() => onDownloadSubmission(sub)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#38BDF8] hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
