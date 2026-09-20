import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Check, User, Wallet } from 'lucide-react';
import { CURRENCIES, type UserDto, type WorkspaceDto, type WorkspaceMode } from '@khata/shared';
import { cn } from '../../lib/cn';
import { Logo } from '../../components/brand/Logo';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { MoneyInput } from '../../components/ui/MoneyInput';
import { api, errorMessage } from '../../lib/api';
import { useAuthStore } from '../../stores/auth.store';

/**
 * First-run onboarding (§66).
 *
 * Three short steps, none of them optional configuration disguised as a wizard:
 * what to track, what currency, and one real account with a real balance — so the
 * very first thing after signing up is something the user can immediately act on,
 * not a settings form.
 */
type Step = 'mode' | 'currency' | 'account' | 'done';

export function OnboardingPage() {
  const navigate = useNavigate();
  const workspaces = useAuthStore((s) => s.workspaces);
  const setUser = useAuthStore((s) => s.setUser);
  const switchWorkspace = useAuthStore((s) => s.switchWorkspace);
  const setWorkspaces = useAuthStore((s) => s.setWorkspaces);

  const [step, setStep] = useState<Step>('mode');
  const [mode, setMode] = useState<WorkspaceMode>('personal');
  const [currency, setCurrency] = useState('INR');
  const [accountName, setAccountName] = useState('Cash');
  const [openingBalanceMinor, setOpeningBalanceMinor] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The registration flow already created one default workspace — onboarding's job
  // is to make sure it matches what the user actually wants, not to create a
  // second one behind their back.
  const defaultWorkspace = workspaces[0];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      if (defaultWorkspace && defaultWorkspace.currency !== currency && defaultWorkspace.mode === mode) {
        await api.patch(`/workspaces/${defaultWorkspace.id}`, { currency });
      }

      // Mode is immutable on an existing workspace by design (it is the hard data
      // boundary, §6), so a changed mode gets a fresh workspace instead of trying
      // to mutate the one registration already created.
      if (defaultWorkspace && defaultWorkspace.mode !== mode) {
        const created = await api.post<{ id: string }>('/workspaces', {
          name: mode === 'business' ? 'My Business' : 'Personal',
          mode,
          currency,
          seedCashAccount: false,
        });
        const refreshedWorkspaces = await api.get<WorkspaceDto[]>('/workspaces');
        setWorkspaces(refreshedWorkspaces);
        await switchWorkspace(created.id);
      }

      if (accountName.trim()) {
        // The registration flow already seeds a "Cash" account, so this only adds
        // a second one when the user actually changed the name or balance.
        await api
          .post('/accounts', {
            name: accountName.trim(),
            type: 'cash',
            openingBalanceMinor: openingBalanceMinor ?? 0,
          })
          .catch(() => undefined);
      }

      const user = await api.post<UserDto>('/users/me/onboarding/complete', {});
      setUser(user);
      setStep('done');
      setTimeout(() => navigate('/', { replace: true }), 900);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-5 pb-10 pt-safe">
      <div className="mb-10">
        <Logo />
      </div>

      <div className="w-full max-w-md">
        <StepIndicator step={step} />

        {step === 'mode' && (
          <div className="animate-rise-in">
            <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink">
              What do you want to track?
            </h1>
            <p className="mt-2 text-[14px] text-ink-muted">
              You can add more workspaces later and switch between them anytime.
            </p>

            <div className="mt-7 flex flex-col gap-3">
              <ModeOption
                icon={<User className="size-5" />}
                title="Personal Money"
                description="Everyday income, expenses, savings and who owes you what."
                active={mode === 'personal'}
                onClick={() => setMode('personal')}
              />
              <ModeOption
                icon={<Briefcase className="size-5" />}
                title="Business / Cash Book"
                description="Petty cash, daily closing, customers and suppliers."
                active={mode === 'business'}
                onClick={() => setMode('business')}
              />
            </div>

            <Button size="lg" fullWidth variant="gold" className="mt-8" onClick={() => setStep('currency')}>
              Continue
            </Button>
          </div>
        )}

        {step === 'currency' && (
          <div className="animate-rise-in">
            <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink">Choose your currency</h1>
            <p className="mt-2 text-[14px] text-ink-muted">Every amount you record will be shown in this currency.</p>

            <div className="mt-7">
              <Field label="Currency">
                {({ id }) => (
                  <Select id={id} value={currency} onChange={(event) => setCurrency(event.target.value)}>
                    {Object.values(CURRENCIES).map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.symbol} · {option.name} ({option.code})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="mt-8 flex gap-2.5">
              <Button variant="secondary" size="lg" onClick={() => setStep('mode')}>
                Back
              </Button>
              <Button size="lg" fullWidth variant="gold" onClick={() => setStep('account')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'account' && (
          <div className="animate-rise-in">
            <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink">
              Create your first account
            </h1>
            <p className="mt-2 text-[14px] text-ink-muted">
              Where does this money actually sit? Start with one — add the rest later.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-md border border-negative/25 bg-negative-soft px-3.5 py-3 text-[13px] leading-relaxed text-negative"
              >
                {error}
              </div>
            )}

            <div className="mt-7 flex flex-col gap-4">
              <Field label="Account name">
                {({ id }) => (
                  <Input
                    id={id}
                    value={accountName}
                    maxLength={60}
                    leftSlot={<Wallet aria-hidden className="size-4" />}
                    onChange={(event) => setAccountName(event.target.value)}
                  />
                )}
              </Field>
              <Field label="Current balance" hint="What's in it right now.">
                {({ id }) => (
                  <MoneyInput id={id} value={openingBalanceMinor} onChange={setOpeningBalanceMinor} />
                )}
              </Field>
            </div>

            <div className="mt-8 flex gap-2.5">
              <Button variant="secondary" size="lg" onClick={() => setStep('currency')} disabled={busy}>
                Back
              </Button>
              <Button size="lg" fullWidth variant="gold" loading={busy} onClick={() => void finish()}>
                You're ready
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="animate-rise-in flex flex-col items-center py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-positive-soft text-positive">
              <Check className="size-6" />
            </span>
            <h1 className="mt-5 text-xl font-semibold tracking-[-0.01em] text-ink">You're ready.</h1>
            <p className="mt-1.5 text-[13.5px] text-ink-muted">Taking you to your dashboard…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: Step[] = ['mode', 'currency', 'account'];
  if (step === 'done') return null;
  const index = steps.indexOf(step);

  return (
    <div className="mb-8 flex gap-1.5" aria-hidden>
      {steps.map((s, i) => (
        <span
          key={s}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors duration-300',
            i <= index ? 'bg-gold' : 'bg-line',
          )}
        />
      ))}
    </div>
  );
}

function ModeOption({
  icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3.5 rounded-lg border p-4 text-left transition-colors',
        active ? 'border-gold bg-gold-soft' : 'border-line bg-surface hover:bg-sunken',
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-gold text-white' : 'bg-sunken text-ink-secondary',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-muted">{description}</span>
      </span>
      {active && <Check aria-hidden className="ml-auto size-4 shrink-0 text-gold" />}
    </button>
  );
}
