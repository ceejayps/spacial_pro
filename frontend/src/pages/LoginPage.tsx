import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Record<'email' | 'password', string>;

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<FieldErrors>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  function validate() {
    const nextErrors: Partial<FieldErrors> = {};

    if (!email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!EMAIL_PATTERN.test(email)) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Password is required.';
    } else if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.';
    }

    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();

    setErrors(nextErrors);
    setSubmitError('');

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      setIsSubmitting(true);
      await signIn({
        email: email.trim(),
        password,
      });
      navigate('/library');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to sign in right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="bg-background-light dark:bg-background-dark font-display text-slate-900 dark:text-slate-100 min-h-screen flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none point-cloud-bg" />
      <div className="fixed inset-0 pointer-events-none bg-gradient-to-b from-transparent via-background-dark/50 to-background-dark" />

      <div className="relative z-10 w-full max-w-[440px]">
        <div className="mb-10 flex flex-col items-center">
          <div className="relative mb-6 flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-primary/30 bg-primary/20">
            <div className="absolute inset-0 animate-pulse bg-primary/10" />
            <span className="material-symbols-outlined relative z-10 text-5xl text-primary">view_in_ar</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Welcome Back</h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Sign in to manage your LiDAR scans</p>
        </div>

        <form className="space-y-6" noValidate onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="ml-1 text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="email">
              Email Address
            </label>
            <div
              className={`glow-border relative rounded-lg border bg-white/50 backdrop-blur-sm transition-all duration-300 dark:bg-slate-900/50 ${
                errors.email ? 'border-red-500/70' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <span className="material-symbols-outlined text-xl text-slate-400">mail</span>
              </div>
              <input
                id="email"
                autoComplete="email"
                className="w-full rounded-lg border-none bg-transparent py-4 pl-11 pr-4 text-slate-900 placeholder:text-slate-400 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-600"
                placeholder="name@company.com"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (errors.email) {
                    setErrors((current) => ({ ...current, email: '' }));
                  }
                }}
              />
            </div>
            {errors.email ? <p className="ml-1 text-xs text-red-400">{errors.email}</p> : null}
          </div>

          <div className="space-y-2">
            <div className="ml-1 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">
                Password
              </label>
              <a className="text-xs font-semibold text-primary transition-colors hover:text-primary/80" href="#">
                Forgot Password?
              </a>
            </div>
            <div
              className={`glow-border relative rounded-lg border bg-white/50 backdrop-blur-sm transition-all duration-300 dark:bg-slate-900/50 ${
                errors.password ? 'border-red-500/70' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <span className="material-symbols-outlined text-xl text-slate-400">lock</span>
              </div>
              <input
                id="password"
                autoComplete="current-password"
                className="w-full rounded-lg border-none bg-transparent py-4 pl-11 pr-12 text-slate-900 placeholder:text-slate-400 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-600"
                placeholder="••••••••"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (errors.password) {
                    setErrors((current) => ({ ...current, password: '' }));
                  }
                }}
              />
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400 hover:text-slate-200"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
              >
                <span className="material-symbols-outlined text-xl">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            {errors.password ? <p className="ml-1 text-xs text-red-400">{errors.password}</p> : null}
          </div>

          <button
            className="electric-glow group flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-4 font-bold text-white transition-all duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            <span>{isSubmitting ? 'Signing In...' : 'Login to Dashboard'}</span>
            <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
          </button>

          {submitError ? <p className="text-center text-xs text-red-400">{submitError}</p> : null}

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background-light px-2 text-slate-500 dark:bg-background-dark dark:text-slate-500">
                Or continue with
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-3 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800"
              type="button"
            >
              <img
                alt="Google"
                className="h-4 w-4"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuAhgX3I0ZfjnoeC_R3_5wdkEZ5D667b3lOIJKrGXN5Zi4dKJt_FKgasI9We4Q6rG2RPZbGcTsBGiSRdyg_A8VVOd1q-lOb2LjDDS7NWHdQOfDs9el-mdnJqGGKmufbiDLKtaEwpxiFecM343RTdo1T23g3K1ecusgaZYNWg5KEPPLvwZ7e9hyTOlRan878CswMVKIA-YXiMhOR6oXUlU5OQIn5jUXVGUMkvxykgtXOX0YnU12CnremByepkx1_TN7W1RDuaALPFvQ"
              />
              <span className="text-sm font-medium">Google</span>
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-3 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800"
              type="button"
            >
              <span className="material-symbols-outlined text-xl">ios</span>
              <span className="text-sm font-medium">Apple</span>
            </button>
          </div>
        </form>

        <p className="mt-10 text-center text-slate-500 dark:text-slate-400">
          Don&apos;t have an account?{' '}
          <Link className="font-bold text-primary hover:underline" to="/signup">
            Sign up for free
          </Link>
        </p>
      </div>

      <div className="fixed bottom-8 left-8 hidden lg:block">
        <div className="flex items-center gap-3 text-primary/40">
          <span className="material-symbols-outlined animate-pulse">sensors</span>
          <span className="text-xs font-mono uppercase tracking-widest">System Status: Ready</span>
        </div>
      </div>

      <div className="fixed right-8 top-8 hidden lg:block">
        <div className="flex items-center gap-3 text-primary/40">
          <span className="text-xs font-mono uppercase tracking-widest">v4.2.0-PRO</span>
          <span className="material-symbols-outlined">memory</span>
        </div>
      </div>
    </div>
  );
}
