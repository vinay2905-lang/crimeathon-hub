import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  FileCheck2,
  FilePlus2,
  FolderPlus,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type {
  ActivityLog,
  AdminStats,
  CaseDifficulty,
  CaseStatus,
  CaseStudy,
  EvidenceFile,
  Submission,
  SubmissionStatus,
  Team,
} from '../types.ts';
import { formatBytes, formatFullDate, formatTimestamp } from '../utils/format.ts';

type AdminTab = 'overview' | 'cases' | 'activities' | 'evaluations';

interface AdminDashboardProps {
  adminEmail: string;
  cases: CaseStudy[];
  stats: AdminStats;
  activities: ActivityLog[];
  teams: Team[];
  submissions: Submission[];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onCreateCase: (formData: FormData) => Promise<boolean>;
  onAttachFiles: (caseId: string, formData: FormData) => Promise<boolean>;
  onToggleCaseStatus: (caseItem: CaseStudy) => Promise<void>;
  onDeleteFile: (caseId: string, fileId: string) => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
  onDownloadEvidence: (caseItem: CaseStudy, fileItem: EvidenceFile) => void;
  onDownloadSubmission: (submission: Submission) => void;
  onEvaluateSubmission: (
    submissionId: string,
    payload: { status: SubmissionStatus; score: number | null; judgeFeedback: string }
  ) => Promise<boolean>;
}

export function AdminDashboard({
  adminEmail,
  cases,
  stats,
  activities,
  teams,
  submissions,
  refreshing,
  onRefresh,
  onLogout,
  onCreateCase,
  onAttachFiles,
  onToggleCaseStatus,
  onDeleteFile,
  onDeleteCase,
  onDownloadEvidence,
  onDownloadSubmission,
  onEvaluateSubmission,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Create Case Form State
  const [caseCode, setCaseCode] = useState('');
  const [caseTitle, setCaseTitle] = useState('');
  const [caseCategory, setCaseCategory] = useState('Incident Response');
  const [caseDifficulty, setCaseDifficulty] = useState<CaseDifficulty>('Intermediate');
  const [caseStatus, setCaseStatus] = useState<CaseStatus>('published');
  const [caseBriefing, setCaseBriefing] = useState('');
  const [caseObjectives, setCaseObjectives] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [draggingNew, setDraggingNew] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const newCaseFileRef = useRef<HTMLInputElement | null>(null);

  // Attach additional files to existing case
  const [attachingCaseId, setAttachingCaseId] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  // Activity Filter State
  const [activityFilter, setActivityFilter] = useState<'ALL' | 'DOWNLOAD' | 'SUBMISSION' | 'TEAM'>(
    'ALL'
  );
  const [activitySearch, setActivitySearch] = useState('');

  // Evaluation Filter & Inline Editor State
  const [evalFilter, setEvalFilter] = useState<'ALL' | SubmissionStatus>('ALL');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [evalStatus, setEvalStatus] = useState<SubmissionStatus>('Evaluated');
  const [evalScore, setEvalScore] = useState<string>('');
  const [evalFeedback, setEvalFeedback] = useState<string>('');
  const [savingEval, setSavingEval] = useState(false);

  const filteredActivities = useMemo(() => {
    return activities.filter((act) => {
      const matchesType =
        activityFilter === 'ALL' ||
        (activityFilter === 'DOWNLOAD' && act.type === 'FILE_DOWNLOAD') ||
        (activityFilter === 'SUBMISSION' &&
          (act.type === 'REPORT_SUBMIT' || act.type === 'REPORT_EVALUATED')) ||
        (activityFilter === 'TEAM' &&
          (act.type === 'TEAM_REGISTER' || act.type === 'TEAM_LOGIN'));

      if (!matchesType) return false;
      const q = activitySearch.trim().toLowerCase();
      if (!q) return true;
      return (
        act.teamName.toLowerCase().includes(q) ||
        act.teamCode.toLowerCase().includes(q) ||
        act.details.toLowerCase().includes(q) ||
        (act.fileName?.toLowerCase().includes(q) ?? false) ||
        (act.caseCode?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [activities, activityFilter, activitySearch]);

  const filteredSubmissions = useMemo(() => {
    if (evalFilter === 'ALL') return submissions;
    return submissions.filter((s) => s.status === evalFilter);
  }, [submissions, evalFilter]);

  const handleQueueFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    setQueuedFiles((prev) => [...prev, ...incoming].slice(0, 15));
  };

  const handleNewCaseDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingNew(false);
    handleQueueFiles(e.dataTransfer.files);
  };

  const handleCreateCaseSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('code', caseCode.trim().toUpperCase());
    formData.append('title', caseTitle.trim());
    formData.append('category', caseCategory);
    formData.append('difficulty', caseDifficulty);
    formData.append('status', caseStatus);
    formData.append('briefing', caseBriefing.trim());
    formData.append('objectives', caseObjectives.trim());
    for (const file of queuedFiles) {
      formData.append('files', file);
    }

    setCreatingCase(true);
    const ok = await onCreateCase(formData);
    setCreatingCase(false);
    if (ok) {
      setCaseCode('');
      setCaseTitle('');
      setCaseBriefing('');
      setCaseObjectives('');
      setQueuedFiles([]);
      if (newCaseFileRef.current) newCaseFileRef.current.value = '';
    }
  };

  const handleTriggerAttach = (caseId: string) => {
    setAttachingCaseId(caseId);
    attachInputRef.current?.click();
  };

  const handleAttachInputChange = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !attachingCaseId) return;
    const formData = new FormData();
    for (const file of Array.from(fileList)) {
      formData.append('files', file);
    }
    await onAttachFiles(attachingCaseId, formData);
    setAttachingCaseId(null);
    if (attachInputRef.current) attachInputRef.current.value = '';
  };

  const openEvaluationEditor = (sub: Submission) => {
    setEditingSubId(sub.id);
    setEvalStatus(sub.status === 'Submitted' ? 'Evaluated' : sub.status);
    setEvalScore(sub.score !== null ? String(sub.score) : '');
    setEvalFeedback(sub.judgeFeedback);
  };

  const handleSaveEvaluation = async (subId: string) => {
    setSavingEval(true);
    const numericScore = evalScore.trim() === '' ? null : Number(evalScore);
    const ok = await onEvaluateSubmission(subId, {
      status: evalStatus,
      score: numericScore !== null && !Number.isNaN(numericScore) ? numericScore : null,
      judgeFeedback: evalFeedback,
    });
    setSavingEval(false);
    if (ok) {
      setEditingSubId(null);
    }
  };

  const navItems: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'cases', label: 'Cases & Upload', icon: FolderPlus },
    { id: 'activities', label: 'Participant Activity', icon: Activity },
    { id: 'evaluations', label: 'Submissions & Judging', icon: FileCheck2 },
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
      <input
        ref={attachInputRef}
        type="file"
        multiple
        onChange={(e) => handleAttachInputChange(e.target.files)}
        className="hidden"
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Sidebar Navigation (240px on desktop, responsive tabs on mobile) */}
        <aside className="lg:w-64 lg:shrink-0 rounded-xl border border-white/10 bg-[#140F11] p-4 space-y-5">
          <div className="space-y-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5">
              <img
                src="/assets/aistudio/saveetha_logo_for_report_998094ef.jpg"
                alt="SIMATS Engineering"
                referrerPolicy="no-referrer"
                className="h-6 w-auto object-contain"
              />
              <img
                src="/assets/aistudio/senrtric_log_d0085b60.jpeg"
                alt="Sentrix Cyber Club"
                referrerPolicy="no-referrer"
                className="h-6 w-auto object-contain ml-auto"
              />
            </div>
            <div>
              <p className="font-display text-sm font-bold text-white">Admin Command Desk</p>
              <p className="truncate text-xs text-[#9E9592]">{adminEmail}</p>
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[#C94146] text-white'
                      : 'text-[#B8B0AD] hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/10 pt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => onRefresh()}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-xs font-medium text-[#D4CCC9] hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Live Data
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#1B1416] px-3 py-2 text-xs font-medium text-[#F5B7B9] hover:bg-[#C94146] hover:text-white transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out Admin
            </button>
          </div>
        </aside>

        {/* Main Workspace Viewport */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Top Context Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
            <div>
              <p className="text-xs text-[#9E9592]">
                Crimeathon Hub / Admin Console /{' '}
                <span className="text-[#E05358]">
                  {navItems.find((n) => n.id === activeTab)?.label}
                </span>
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold text-white">
                {activeTab === 'overview' && 'Hackathon Operations Overview'}
                {activeTab === 'cases' && 'Case Studies & Evidence Upload'}
                {activeTab === 'activities' && 'Participant Activities & Team Directory'}
                {activeTab === 'evaluations' && 'Investigation Submissions & Judge Queue'}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('cases')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#C94146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D94B50] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Upload Case Study
            </button>
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <p className="text-xs text-[#9E9592]">Published / Total Cases</p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-white tabular-nums">
                    {stats.publishedCases} / {stats.totalCases}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <p className="text-xs text-[#9E9592]">Evidence Files Hosted</p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-white tabular-nums">
                    {stats.totalEvidenceFiles}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <p className="text-xs text-[#9E9592]">Registered Teams</p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-white tabular-nums">
                    {stats.totalTeams}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <p className="text-xs text-[#9E9592]">Total Evidence Downloads</p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-[#38BDF8] tabular-nums">
                    {stats.totalDownloads}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <p className="text-xs text-[#9E9592]">Reports Submitted</p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-white tabular-nums">
                    {stats.totalSubmissions}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <p className="text-xs text-[#9E9592]">Pending Judge Evaluations</p>
                  <p className="mt-1.5 font-display text-2xl font-bold text-[#E05358] tabular-nums">
                    {stats.pendingEvaluations}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Recent Participant Activity */}
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-white">
                      Latest Participant Activity
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('activities')}
                      className="text-xs font-medium text-[#38BDF8] hover:text-white cursor-pointer"
                    >
                      View All
                    </button>
                  </div>
                  <div className="divide-y divide-white/[0.06]">
                    {activities.slice(0, 6).map((act) => (
                      <div key={act.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-white">
                            {act.teamName}{' '}
                            <span className="font-mono text-[#E05358]">({act.teamCode})</span>
                          </span>
                          <span className="font-mono text-[#8E8582] tabular-nums">
                            {formatTimestamp(act.timestamp)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-[#A39A97]">{act.details}</p>
                      </div>
                    ))}
                    {activities.length === 0 && (
                      <p className="py-6 text-center text-xs text-[#8E8582]">
                        No activity recorded yet.
                      </p>
                    )}
                  </div>
                </div>

                {/* Recent Submissions Queue */}
                <div className="rounded-xl border border-white/10 bg-[#140F11] p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-display text-base font-semibold text-white">
                      Recent Report Submissions
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('evaluations')}
                      className="text-xs font-medium text-[#38BDF8] hover:text-white cursor-pointer"
                    >
                      Open Judging Desk
                    </button>
                  </div>
                  <div className="divide-y divide-white/[0.06]">
                    {submissions.slice(0, 5).map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-white">
                            {sub.teamName} · <span className="font-mono text-[#E05358]">{sub.caseCode}</span>
                          </p>
                          <p className="truncate font-mono text-xs text-[#8E8582]">
                            {sub.fileName} ({formatBytes(sub.sizeBytes)})
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('evaluations');
                            openEvaluationEditor(sub);
                          }}
                          className="rounded-md border border-white/15 bg-[#1B1416] px-2.5 py-1 text-xs font-medium text-white hover:border-[#C94146] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {sub.status === 'Evaluated' ? `Score: ${sub.score ?? '-'}` : 'Evaluate'}
                        </button>
                      </div>
                    ))}
                    {submissions.length === 0 && (
                      <p className="py-6 text-center text-xs text-[#8E8582]">
                        No investigation reports submitted yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CASE STUDIES & EVIDENCE UPLOAD */}
          {activeTab === 'cases' && (
            <div className="space-y-8">
              {/* Upload New Case Study Form */}
              <form
                onSubmit={handleCreateCaseSubmit}
                className="rounded-xl border border-white/10 bg-[#140F11] p-6 space-y-5"
              >
                <div>
                  <h2 className="font-display text-lg font-bold text-white">
                    Publish New Case Study &amp; Evidence Pack
                  </h2>
                  <p className="mt-1 text-xs text-[#A39A97]">
                    Upload problem statements, network captures (.pcap), server logs (.log), CSV
                    ledgers, ZIP bundles, or PDFs. Participants can download published files
                    immediately.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Case Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={caseCode}
                      onChange={(e) => setCaseCode(e.target.value)}
                      placeholder="CASE-04"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Case Study Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={caseTitle}
                      onChange={(e) => setCaseTitle(e.target.value)}
                      placeholder="Midnight API Token Breach"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Visibility
                    </label>
                    <select
                      value={caseStatus}
                      onChange={(e) => setCaseStatus(e.target.value as CaseStatus)}
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                    >
                      <option value="published">Published (Visible to Teams)</option>
                      <option value="draft">Draft (Admin Only)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Investigation Category
                    </label>
                    <select
                      value={caseCategory}
                      onChange={(e) => setCaseCategory(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                    >
                      <option value="Incident Response">Incident Response</option>
                      <option value="Network Forensics">Network Forensics</option>
                      <option value="Threat Forensics">Threat Forensics</option>
                      <option value="OSINT & Financial">OSINT &amp; Financial</option>
                      <option value="Malware Analysis">Malware Analysis</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Difficulty Level
                    </label>
                    <select
                      value={caseDifficulty}
                      onChange={(e) => setCaseDifficulty(e.target.value as CaseDifficulty)}
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                    >
                      <option value="Foundational">Foundational</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Advanced">Advanced</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Case Briefing / Problem Statement *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={caseBriefing}
                      onChange={(e) => setCaseBriefing(e.target.value)}
                      placeholder="Describe the cyber crime scenario, compromised assets, and investigation context..."
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                      Investigative Objectives (one per line)
                    </label>
                    <textarea
                      rows={4}
                      value={caseObjectives}
                      onChange={(e) => setCaseObjectives(e.target.value)}
                      placeholder="Identify attacker IP and entry vector&#10;Reconstruct exfiltration timeline&#10;Recommend remediation controls"
                      className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Multi-File Evidence Uploader */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[#D4CCC9]">
                    Attach Case Study &amp; Evidence Files (Multiple formats supported)
                  </label>
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDraggingNew(true);
                    }}
                    onDragLeave={() => setDraggingNew(false)}
                    onDrop={handleNewCaseDrop}
                    onClick={() => newCaseFileRef.current?.click()}
                    className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors cursor-pointer ${
                      draggingNew
                        ? 'border-[#C94146] bg-[#C94146]/10'
                        : 'border-white/15 bg-[#0C090A] hover:border-white/30'
                    }`}
                  >
                    <UploadCloud className="h-6 w-6 text-[#E05358]" />
                    <p className="mt-2 text-xs font-medium text-white">
                      Drop evidence files here or click to select multiple files
                    </p>
                    <p className="mt-0.5 text-xs text-[#8E8582]">
                      PDF, ZIP, PCAP, LOG, CSV, JSON, TXT, DOCX, PNG, EVTX (up to 50 MB each)
                    </p>
                    <input
                      ref={newCaseFileRef}
                      type="file"
                      multiple
                      onChange={(e) => handleQueueFiles(e.target.files)}
                      className="hidden"
                    />
                  </div>

                  {queuedFiles.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      {queuedFiles.map((file, idx) => (
                        <div
                          key={`${file.name}-${idx}`}
                          className="flex items-center justify-between rounded-lg border border-white/10 bg-[#191315] px-3 py-1.5 text-xs"
                        >
                          <span className="truncate font-medium text-white">
                            {file.name}{' '}
                            <span className="font-mono text-[#9E9592] tabular-nums">
                              ({formatBytes(file.size)})
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-[#A39A97] hover:text-white cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={creatingCase}
                    className="rounded-lg bg-[#C94146] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 transition-colors cursor-pointer"
                  >
                    {creatingCase ? 'Uploading Case & Files...' : 'Save & Upload Case Study'}
                  </button>
                </div>
              </form>

              {/* Existing Case Studies Management */}
              <div className="space-y-4">
                <h2 className="font-display text-lg font-bold text-white">
                  Managed Case Studies ({cases.length})
                </h2>

                {cases.map((caseItem) => (
                  <div
                    key={caseItem.id}
                    className="rounded-xl border border-white/10 bg-[#140F11] p-5 space-y-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#A39A97]">
                          <span className="font-mono font-semibold text-[#E05358]">
                            {caseItem.code}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{caseItem.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{caseItem.difficulty}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              caseItem.status === 'published'
                                ? 'font-semibold text-emerald-400'
                                : 'font-semibold text-amber-400'
                            }
                          >
                            {caseItem.status === 'published' ? 'Published' : 'Draft'}
                          </span>
                        </div>
                        <h3 className="mt-1 font-display text-lg font-bold text-white">
                          {caseItem.title}
                        </h3>
                        <p className="mt-1 text-xs text-[#B8B0AD]">{caseItem.briefing}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTriggerAttach(caseItem.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1B1416] px-3 py-1.5 text-xs font-medium text-white hover:border-[#38BDF8] cursor-pointer"
                        >
                          <FilePlus2 className="h-3.5 w-3.5 text-[#38BDF8]" />
                          Add Files
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleCaseStatus(caseItem)}
                          className="rounded-lg border border-white/15 bg-[#1B1416] px-3 py-1.5 text-xs font-medium text-white hover:border-[#C94146] cursor-pointer"
                        >
                          {caseItem.status === 'published' ? 'Move to Draft' : 'Publish Live'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteCase(caseItem.id)}
                          aria-label={`Delete ${caseItem.code}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#C94146]/30 px-2.5 py-1.5 text-xs font-medium text-[#F5B7B9] hover:bg-[#C94146] hover:text-white cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {caseItem.files.length > 0 && (
                      <div className="divide-y divide-white/[0.06] border-t border-white/10 pt-3">
                        {caseItem.files.map((file) => (
                          <div
                            key={file.id}
                            className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-white truncate">
                                {file.originalName}
                              </span>
                              <span className="font-mono text-[#8E8582] tabular-nums">
                                {formatBytes(file.sizeBytes)}
                              </span>
                              <span className="text-[#8E8582] tabular-nums">
                                · {file.downloadCount} downloads
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onDownloadEvidence(caseItem, file)}
                                className="inline-flex items-center gap-1 text-xs text-[#38BDF8] hover:text-white cursor-pointer"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteFile(caseItem.id, file.id)}
                                className="text-xs text-[#E05358] hover:text-white cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: PARTICIPANT ACTIVITIES & TEAMS */}
          {activeTab === 'activities' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#140F11] p-1">
                  {(
                    [
                      { id: 'ALL', label: 'All Events' },
                      { id: 'DOWNLOAD', label: 'File Downloads' },
                      { id: 'SUBMISSION', label: 'Report Submissions' },
                      { id: 'TEAM', label: 'Team Sign-Ins' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActivityFilter(tab.id)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        activityFilter === tab.id
                          ? 'bg-[#C94146] text-white'
                          : 'text-[#B8B0AD] hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7D7471]" />
                  <input
                    type="search"
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Filter by team, case, or file..."
                    className="w-full sm:w-64 rounded-lg border border-white/10 bg-[#140F11] py-2 pl-9 pr-3 text-sm text-white placeholder-[#7D7471] focus:border-[#C94146] focus:outline-none"
                  />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#140F11]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#8E8582]">
                      <th className="px-4 py-3 font-medium">Timestamp</th>
                      <th className="px-4 py-3 font-medium">Team</th>
                      <th className="px-4 py-3 font-medium">Event</th>
                      <th className="px-4 py-3 font-medium">Case</th>
                      <th className="px-4 py-3 font-medium">Activity Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredActivities.map((act) => (
                      <tr key={act.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-mono text-[#9E9592] tabular-nums whitespace-nowrap">
                          {formatFullDate(act.timestamp)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-semibold text-white">{act.teamName}</span>{' '}
                          <span className="font-mono text-[#E05358]">({act.teamCode})</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[#38BDF8] whitespace-nowrap">
                          {act.type}
                        </td>
                        <td className="px-4 py-3 font-mono text-[#D4CCC9] whitespace-nowrap">
                          {act.caseCode ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-[#C2B9B6]">{act.details}</td>
                      </tr>
                    ))}
                    {filteredActivities.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-[#8E8582]">
                          No participant activity matches this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Registered Teams Directory */}
              <div className="rounded-xl border border-white/10 bg-[#140F11] p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-[#38BDF8]" />
                  <h2 className="font-display text-base font-bold text-white">
                    Registered Participant Teams ({teams.length})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[#8E8582]">
                        <th className="py-2.5 pr-4 font-medium">Team Code</th>
                        <th className="py-2.5 px-3 font-medium">Team Name</th>
                        <th className="py-2.5 px-3 font-medium">Leader Email</th>
                        <th className="py-2.5 px-3 font-medium">Members</th>
                        <th className="py-2.5 pl-3 font-medium text-right">Last Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {teams.map((team) => (
                        <tr key={team.id}>
                          <td className="py-2.5 pr-4 font-mono font-semibold text-[#E05358]">
                            {team.teamCode}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-white">{team.teamName}</td>
                          <td className="py-2.5 px-3 text-[#B8B0AD]">{team.leaderEmail}</td>
                          <td className="py-2.5 px-3 text-[#9E9592]">{team.members}</td>
                          <td className="py-2.5 pl-3 text-right font-mono text-[#8E8582] tabular-nums">
                            {formatTimestamp(team.lastActiveAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SUBMISSIONS & JUDGE EVALUATION */}
          {activeTab === 'evaluations' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#140F11] p-1 w-fit">
                {(['ALL', 'Submitted', 'Under Review', 'Evaluated'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setEvalFilter(status)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      evalFilter === status
                        ? 'bg-[#C94146] text-white'
                        : 'text-[#B8B0AD] hover:text-white'
                    }`}
                  >
                    {status === 'ALL' ? 'All Reports' : status}
                  </button>
                ))}
              </div>

              {filteredSubmissions.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-[#140F11] px-6 py-10 text-center text-sm text-[#8E8582]">
                  No investigation report submissions match this status filter.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredSubmissions.map((sub) => (
                    <div
                      key={sub.id}
                      className="rounded-xl border border-white/10 bg-[#140F11] p-5 space-y-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#A39A97]">
                            <span className="font-mono font-semibold text-[#E05358]">
                              {sub.caseCode}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-white">{sub.teamName}</span>
                            <span className="font-mono text-[#8E8582]">({sub.teamCode})</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatFullDate(sub.submittedAt)}
                            </span>
                          </div>
                          <h3 className="mt-1 font-display text-base font-bold text-white">
                            {sub.caseTitle}
                          </h3>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          {sub.status === 'Evaluated' && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Evaluated{sub.score !== null ? ` · ${sub.score}/100` : ''}
                            </span>
                          )}
                          {sub.status === 'Under Review' && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400">
                              <Clock className="h-3.5 w-3.5" />
                              Under Review
                            </span>
                          )}
                          {sub.status === 'Submitted' && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#38BDF8]">
                              <FileCheck2 className="h-3.5 w-3.5" />
                              Submitted
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => onDownloadSubmission(sub)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#1B1416] px-3 py-1.5 text-xs font-medium text-white hover:border-[#38BDF8] cursor-pointer"
                          >
                            <Download className="h-3.5 w-3.5 text-[#38BDF8]" />
                            Download Report
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              editingSubId === sub.id
                                ? setEditingSubId(null)
                                : openEvaluationEditor(sub)
                            }
                            className="rounded-lg bg-[#C94146] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#D94B50] cursor-pointer"
                          >
                            {editingSubId === sub.id ? 'Close Judge Panel' : 'Score & Evaluate'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 border-t border-white/10 pt-3 text-xs sm:grid-cols-2">
                        <div>
                          <p className="font-semibold text-[#D4CCC9]">Findings Summary</p>
                          <p className="mt-1 text-[#A39A97] leading-relaxed">{sub.summary}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-[#D4CCC9]">
                            Methodology &amp; Uploaded Artifact
                          </p>
                          <p className="mt-1 text-[#A39A97]">{sub.methodology}</p>
                          <p className="mt-1.5 font-mono text-[#8E8582]">
                            File: {sub.fileName} · {formatBytes(sub.sizeBytes)} · SHA-256:{' '}
                            {sub.sha256.slice(0, 10)}...
                          </p>
                        </div>
                      </div>

                      {sub.judgeFeedback && editingSubId !== sub.id && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2 text-xs text-emerald-200">
                          <span className="font-semibold text-emerald-300">Judge Feedback: </span>
                          {sub.judgeFeedback}
                        </div>
                      )}

                      {editingSubId === sub.id && (
                        <div className="rounded-lg border border-white/10 bg-[#0C090A] p-4 space-y-3">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs text-[#D4CCC9]">
                                Evaluation Status
                              </label>
                              <select
                                value={evalStatus}
                                onChange={(e) => setEvalStatus(e.target.value as SubmissionStatus)}
                                className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white focus:border-[#C94146] focus:outline-none"
                              >
                                <option value="Submitted">Submitted</option>
                                <option value="Under Review">Under Review</option>
                                <option value="Evaluated">Evaluated</option>
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-[#D4CCC9]">
                                Judges&apos; Score (0–100)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={evalScore}
                                onChange={(e) => setEvalScore(e.target.value)}
                                placeholder="e.g., 88"
                                className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-[#D4CCC9]">
                              Evaluation Feedback for Team
                            </label>
                            <textarea
                              rows={2}
                              value={evalFeedback}
                              onChange={(e) => setEvalFeedback(e.target.value)}
                              placeholder="Strong correlation of SSH logs and ledger sweeps..."
                              className="w-full rounded-lg border border-white/10 bg-[#140F11] px-3 py-2 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingSubId(null)}
                              className="rounded-lg border border-white/10 px-3.5 py-1.5 text-xs font-medium text-[#B8B0AD] hover:text-white cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={savingEval}
                              onClick={() => handleSaveEvaluation(sub.id)}
                              className="rounded-lg bg-[#C94146] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 cursor-pointer"
                            >
                              {savingEval ? 'Saving...' : 'Save Evaluation'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
