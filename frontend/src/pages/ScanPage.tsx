export default function ScanPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background-dark text-slate-100">
      <div className="fixed inset-0 bg-slate-900" />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40" />
      <main className="relative z-10 flex h-full flex-col" aria-labelledby="scan-screen-title">
        <h1 id="scan-screen-title" className="sr-only">
          Scan
        </h1>
      </main>
    </div>
  );
}
