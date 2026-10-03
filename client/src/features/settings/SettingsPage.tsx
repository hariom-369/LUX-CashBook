import { Routes, Route, NavLink } from 'react-router-dom';
import { Bell, Briefcase, Database, Palette, Shield, Store, Tags, User } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Card } from '../../components/ui/Card';
import { ProfileSettings } from './ProfileSettings';
import { PreferencesSettings } from './PreferencesSettings';
import { SecuritySettings } from './SecuritySettings';
import { WorkspaceSettings } from './WorkspaceSettings';
import { NotificationSettings } from './NotificationSettings';
import { DataSettings } from './DataSettings';
import { PayeesSettings } from './PayeesSettings';
import { OrganiseSettings } from './OrganiseSettings';
import { useT } from '../../i18n';

const TABS = [
  { to: '/settings', label: 'settings.tab.profile' as const, icon: User, end: true },
  { to: '/settings/preferences', label: 'settings.tab.preferences' as const, icon: Palette },
  { to: '/settings/payees', label: 'settings.tab.payees' as const, icon: Store },
  { to: '/settings/organise', label: 'settings.tab.organise' as const, icon: Tags },
  { to: '/settings/notifications', label: 'settings.tab.notifications' as const, icon: Bell },
  { to: '/settings/security', label: 'settings.tab.security' as const, icon: Shield },
  { to: '/settings/data', label: 'settings.tab.data' as const, icon: Database },
  { to: '/settings/workspaces', label: 'settings.tab.workspaces' as const, icon: Briefcase },
];

/**
 * Settings.
 *
 * A left-hand tab rail on desktop, a horizontal scroller on mobile — the same
 * pattern as everywhere else in the app, so settings doesn't feel like a different
 * product bolted on.
 */
export function SettingsPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">{t('settings.title')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">{t('settings.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav
          aria-label={t('settings.settingsSections')}
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
              {t(tab.label)}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <Card>
            <Routes>
              <Route index element={<ProfileSettings />} />
              <Route path="preferences" element={<PreferencesSettings />} />
              <Route path="payees" element={<PayeesSettings />} />
              <Route path="organise" element={<OrganiseSettings />} />
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
