import { Routes, Route, NavLink } from 'react-router-dom';
import { Bell, Briefcase, Database, Palette, Shield, User } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { ProfileSettings } from './ProfileSettings';
import { PreferencesSettings } from './PreferencesSettings';
import { SecuritySettings } from './SecuritySettings';
import { WorkspaceSettings } from './WorkspaceSettings';
import { NotificationSettings } from './NotificationSettings';
import { DataSettings } from './DataSettings';

const TABS = [
  { to: '/settings', label: 'Profile', icon: User, end: true },
  { to: '/settings/preferences', label: 'Preferences', icon: Palette },
  { to: '/settings/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings/security', label: 'Security', icon: Shield },
  { to: '/settings/data', label: 'Data', icon: Database },
  { to: '/settings/workspaces', label: 'Workspaces', icon: Briefcase },
];

/**
 * Settings.
 *
 * A left-hand tab rail on desktop, a horizontal scroller on mobile — the same
 * pattern as everywhere else in the app, so settings doesn't feel like a different
 * product bolted on.
 */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Settings</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">Your profile, preferences, security and data.</p>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav
          aria-label="Settings sections"
          className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-[13px] font-medium transition-colors lg:shrink',
                  isActive
                    ? 'bg-sunken text-ink'
                    : 'text-ink-muted hover:bg-sunken/60 hover:text-ink-secondary',
                )
              }
            >
              <tab.icon aria-hidden className="size-4" />
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <Card>
            <Routes>
              <Route index element={<ProfileSettings />} />
              <Route path="preferences" element={<PreferencesSettings />} />
              <Route path="notifications" element={<NotificationSettings />} />
              <Route path="security" element={<SecuritySettings />} />
              <Route path="data" element={<DataSettings />} />
              <Route path="workspaces" element={<WorkspaceSettings />} />
            </Routes>
          </Card>
        </div>
      </div>
    </div>
  );
}
