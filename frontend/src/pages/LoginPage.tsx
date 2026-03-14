export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background-light text-slate-900 dark:bg-background-dark dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle,#258cf4_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-slate-950/15 to-slate-950/55 dark:via-background-dark/50 dark:to-background-dark" />
      <main className="relative z-10 flex min-h-screen items-center justify-center p-4" aria-labelledby="login-screen-title">
        <h1 id="login-screen-title" className="sr-only">
          Login
        </h1>
      </main>
    </div>
  );
}
