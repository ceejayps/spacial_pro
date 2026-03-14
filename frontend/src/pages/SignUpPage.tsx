export default function SignUpPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#051526] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(37,140,244,0.18),transparent_55%),radial-gradient(circle_at_50%_80%,rgba(37,140,244,0.12),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle,#258cf4_1px,transparent_1px)] opacity-[0.08] [background-size:34px_34px]" />
      <main className="relative z-10 min-h-screen" aria-labelledby="signup-screen-title">
        <h1 id="signup-screen-title" className="sr-only">
          Sign Up
        </h1>
      </main>
    </div>
  );
}
