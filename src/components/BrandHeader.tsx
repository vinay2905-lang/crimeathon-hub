import { Menu, X } from 'lucide-react';
import { useState } from 'react';

interface BrandHeaderProps {
  isAdminRoute: boolean;
  isParticipantLoggedIn: boolean;
  onExitAdminRoute: () => void;
  onJumpToSection: (sectionId: string) => void;
  onParticipantLogout: () => void;
  onOpenAuthTab: (tab: 'login' | 'register') => void;
}

export function BrandHeader({
  isAdminRoute,
  isParticipantLoggedIn,
  onExitAdminRoute,
  onJumpToSection,
  onParticipantLogout,
  onOpenAuthTab,
}: BrandHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavClick = (sectionId: string, authTab?: 'login' | 'register') => {
    setMobileOpen(false);
    if (authTab) {
      onOpenAuthTab(authTab);
    }
    onJumpToSection(sectionId);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0C090A]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-8">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => {
            if (isAdminRoute) {
              onExitAdminRoute();
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          className="font-display text-lg font-bold tracking-tight text-[#F7F4F2] whitespace-nowrap shrink-0 hover:text-[#D94B50] transition-colors cursor-pointer"
        >
          Crimeathon Hub
        </button>

        {/* Zone 2: Concise single-line navigation links (no Admin Console exposure on public site) */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#B8B0AD]">
          {isAdminRoute ? (
            <button
              type="button"
              onClick={onExitAdminRoute}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Return to Event Portal
            </button>
          ) : isParticipantLoggedIn ? (
            <>
              <button
                type="button"
                onClick={() => handleNavClick('team-profile-hub')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Team &amp; Profile
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('case-vault')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Case Vault
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('submit-report')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Submit Report
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('my-submissions')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                My Submissions
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleNavClick('event-overview')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Event Overview
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('participant-auth', 'login')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Participant Login
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('participant-auth', 'register')}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Register Account
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          {isAdminRoute ? (
            <button
              type="button"
              onClick={onExitAdminRoute}
              className="rounded-lg border border-white/15 bg-[#191315] px-4 py-2 text-xs font-semibold text-white hover:bg-[#241B1E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Participant Portal
            </button>
          ) : isParticipantLoggedIn ? (
            <button
              type="button"
              onClick={onParticipantLogout}
              className="rounded-lg border border-white/15 bg-[#191315] px-4 py-2 text-xs font-semibold text-white hover:border-[#C94146] hover:bg-[#C94146] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleNavClick('participant-auth', 'login')}
              className="rounded-lg bg-[#C94146] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D94B50] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Participant Sign In
            </button>
          )}

          {!isAdminRoute && (
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-[#D4CCC9] hover:text-white"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {mobileOpen && !isAdminRoute && (
        <div className="md:hidden border-t border-white/10 bg-[#120D0F] px-4 py-3 flex flex-col gap-2 text-sm font-medium text-[#D4CCC9]">
          {isParticipantLoggedIn ? (
            <>
              <button
                type="button"
                onClick={() => handleNavClick('team-profile-hub')}
                className="py-2 text-left hover:text-white"
              >
                Team &amp; Profile
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('case-vault')}
                className="py-2 text-left hover:text-white"
              >
                Case Vault
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('submit-report')}
                className="py-2 text-left hover:text-white"
              >
                Submit Report
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('my-submissions')}
                className="py-2 text-left hover:text-white"
              >
                My Submissions
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleNavClick('event-overview')}
                className="py-2 text-left hover:text-white"
              >
                Event Overview
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('participant-auth', 'login')}
                className="py-2 text-left hover:text-white"
              >
                Participant Login
              </button>
              <button
                type="button"
                onClick={() => handleNavClick('participant-auth', 'register')}
                className="py-2 text-left hover:text-white"
              >
                Register Account
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
}
