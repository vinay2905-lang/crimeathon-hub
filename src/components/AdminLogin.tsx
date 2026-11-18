import { ArrowLeft, Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface AdminLoginProps {
  onLoginSuccess: (token: string, email: string) => void;
  onCancel: () => void;
}

export function AdminLogin({ onLoginSuccess, onCancel }: AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json()) as { token?: string; email?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? 'Authentication failed. Check your admin email and password.');
        setLoading(false);
        return;
      }
      onLoginSuccess(data.token, data.email ?? email.trim());
    } catch {
      setError('Unable to reach authentication server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto max-w-[1440px] px-4 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-md rounded-xl border border-white/10 bg-[#140F11] p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C94146]/15 text-[#E05358]">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-white">
                Administrator Sign In
              </h1>
              <p className="text-xs text-[#A39A97]">
                Crimeathon Organizers &amp; Judges Desk
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B8B0AD] hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </div>

        <div className="mb-6 overflow-hidden rounded-lg border border-white/10 bg-[#0D0708]">
          <img
            src="/assets/aistudio/crimelog_242617f8.jpeg"
            alt="Crimeathon by Sentrix Cyber Club"
            referrerPolicy="no-referrer"
            className="h-28 w-full object-cover object-center"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-lg border border-[#C94146]/40 bg-[#C94146]/10 px-3.5 py-2.5 text-xs text-[#F5B7B9]"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#E05358]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-email"
              className="mb-1.5 block text-xs font-medium text-[#D4CCC9]"
            >
              Admin Email
            </label>
            <input
              id="admin-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="crimeathonadmin@gmail.com"
              className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="mb-1.5 block text-xs font-medium text-[#D4CCC9]"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter administrator password"
                className="w-full rounded-lg border border-white/10 bg-[#0C090A] px-3.5 py-2.5 pr-10 text-sm text-white placeholder-[#6B6360] focus:border-[#C94146] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[#8E8582] hover:text-white cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#C94146] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#D94B50] disabled:opacity-60 transition-colors cursor-pointer"
          >
            {loading ? 'Verifying Credentials...' : 'Sign In to Admin Console'}
          </button>
        </form>
      </div>
    </section>
  );
}
