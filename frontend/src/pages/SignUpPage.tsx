import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = Record<'fullName' | 'email' | 'password', string>;

export default function SignUpPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<FieldErrors>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  function validate() {
    const nextErrors: Partial<FieldErrors> = {};

    if (!fullName.trim()) {
      nextErrors.fullName = 'Full name is required.';
    } else if (fullName.trim().length < 3) {
      nextErrors.fullName = 'Enter your full name.';
    }

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
      await signUp({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
      });
      navigate('/library');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to create account right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#051526] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(37,140,244,0.18),transparent_55%),radial-gradient(circle_at_50%_80%,rgba(37,140,244,0.12),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle,#258cf4_1px,transparent_1px)] opacity-[0.08] [background-size:34px_34px]" />

      <main className="relative z-10 mx-auto w-full max-w-[440px] px-6 pb-14 pt-10">
        <header className="mb-12">
          <div className="mb-10 flex items-center gap-3 text-primary">
            <span className="material-symbols-outlined text-4xl">scan</span>
            <span className="text-4xl font-semibold leading-none tracking-wide">Spacial Pro</span>
          </div>

          <h1 className="text-6xl font-bold leading-[1.05] text-slate-100">Create Account</h1>
          <p className="mt-5 text-2xl text-slate-400">Join the future of 3D spatial scanning.</p>
        </header>

        <form className="space-y-8" noValidate onSubmit={handleSubmit}>
          <div className="space-y-3">
            <label className="text-xl font-medium text-slate-200" htmlFor="fullName">
              Full Name
            </label>
            <div
              className={`glow-border relative rounded-[22px] border bg-[#0c223a]/80 px-6 py-5 ${
                errors.fullName ? 'border-red-500/80' : 'border-[#0f4f8f]'
              }`}
            >
              <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-slate-400">
                person
              </span>
              <input
                id="fullName"
                autoComplete="name"
                className="w-full bg-transparent pl-12 pr-4 text-2xl placeholder:text-slate-500 focus:outline-none"
                placeholder="John Doe"
                type="text"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                  if (errors.fullName) {
                    setErrors((current) => ({ ...current, fullName: '' }));
                  }
                }}
              />
            </div>
            {errors.fullName ? <p className="ml-1 text-xs text-red-400">{errors.fullName}</p> : null}
          </div>

          <div className="space-y-3">
            <label className="text-xl font-medium text-slate-200" htmlFor="email">
              Email Address
            </label>
            <div
              className={`glow-border relative rounded-[22px] border bg-[#0c223a]/80 px-6 py-5 ${
                errors.email ? 'border-red-500/80' : 'border-[#0f4f8f]'
              }`}
            >
              <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-slate-400">
                mail
              </span>
              <input
                id="email"
                autoComplete="email"
                className="w-full bg-transparent pl-12 pr-4 text-2xl placeholder:text-slate-500 focus:outline-none"
                placeholder="name@example.com"
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

          <div className="space-y-3">
            <label className="text-xl font-medium text-slate-200" htmlFor="password">
              Password
            </label>
            <div
              className={`glow-border relative rounded-[22px] border bg-[#0c223a]/80 px-6 py-5 ${
                errors.password ? 'border-red-500/80' : 'border-[#0f4f8f]'
              }`}
            >
              <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-slate-400">
                lock
              </span>
              <input
                id="password"
                autoComplete="new-password"
                className="w-full bg-transparent pl-12 pr-16 text-2xl placeholder:text-slate-500 focus:outline-none"
                placeholder="Create a password"
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
                className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
              >
                <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
            {errors.password ? <p className="ml-1 text-xs text-red-400">{errors.password}</p> : null}
          </div>

          <button
            className="electric-glow mt-5 flex w-full items-center justify-center gap-3 rounded-[22px] bg-primary py-6 text-2xl font-bold text-white transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            <span>{isSubmitting ? 'Creating Account...' : 'Join Now'}</span>
            <span className="material-symbols-outlined text-3xl">arrow_forward</span>
          </button>

          {submitError ? <p className="text-center text-xs text-red-400">{submitError}</p> : null}

          <div className="pt-10">
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-x-0 h-px bg-[#0f3d6b]" />
              <span className="relative bg-[#051526] px-5 text-lg uppercase tracking-[0.28em] text-slate-400">
                Or continue with
              </span>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <button
                className="flex items-center justify-center gap-3 rounded-[18px] border border-[#0f4f8f] bg-[#0c223a]/70 py-4 text-lg font-semibold text-slate-100"
                type="button"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded bg-white text-xs font-bold text-slate-900">
                  G
                </span>
                <span>Google</span>
              </button>
              <button
                className="flex items-center justify-center gap-3 rounded-[18px] border border-[#0f4f8f] bg-[#0c223a]/70 py-4 text-lg font-semibold text-slate-100"
                type="button"
              >
                <span className="material-symbols-outlined">ios</span>
                <span>Apple</span>
              </button>
            </div>
          </div>
        </form>

        <p className="mt-12 text-center text-xl text-slate-400">
          Already have an account?{' '}
          <Link className="font-bold text-primary hover:text-primary/80" to="/login">
            Sign In
          </Link>
        </p>

        <div className="mx-auto mt-28 h-1 w-48 rounded-full bg-primary/30" />
      </main>
    </div>
  );
}
