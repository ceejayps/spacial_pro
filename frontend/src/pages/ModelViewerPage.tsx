export default function ModelViewerPage() {
  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-background-dark text-slate-100">
      <main className="relative flex-1 overflow-hidden bg-slate-900" aria-labelledby="viewer-screen-title">
        <h1 id="viewer-screen-title" className="sr-only">
          Model Viewer
        </h1>
      </main>
    </div>
  );
}
