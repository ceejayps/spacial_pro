export default function ScanPreviewPage() {
  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background-light text-slate-900 dark:bg-background-dark dark:text-slate-100">
      <main className="relative flex-1 p-4" aria-labelledby="preview-screen-title">
        <h1 id="preview-screen-title" className="sr-only">
          Scan Preview
        </h1>
      </main>
    </div>
  );
}
