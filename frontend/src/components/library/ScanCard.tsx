import { Link } from 'react-router-dom';
import type { ScanRecord } from '../../services/scanService';

type ScanCardProps = {
  scan: ScanRecord;
  actionBusy?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: (scan: ScanRecord) => void;
  onDelete?: (scan: ScanRecord) => void;
  onSync?: (scan: ScanRecord) => void;
};

function StatusBadge({ status, progress }: { status: string; progress: number }) {
  if (status === 'processed') {
    return (
      <div className="absolute right-2 top-2 rounded border border-green-500/30 bg-green-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-green-500 backdrop-blur-md">
        Processed
      </div>
    );
  }

  if (status === 'exporting') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
        <div className="flex flex-col items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-3xl text-primary">sync</span>
          <span className="text-[10px] font-bold uppercase text-primary">Exporting {progress}%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-2 top-2 rounded border border-slate-500/30 bg-slate-500/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 backdrop-blur-md">
      Draft
    </div>
  );
}

function SyncBadge({ syncState }: { syncState: string }) {
  if (syncState === 'synced') {
    return (
      <div className="absolute left-2 top-2 rounded border border-primary/30 bg-primary/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary backdrop-blur-md">
        Cloud Synced
      </div>
    );
  }

  if (syncState === 'syncing') {
    return (
      <div className="absolute left-2 top-2 rounded border border-amber-300/40 bg-amber-400/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 backdrop-blur-md">
        Syncing...
      </div>
    );
  }

  return (
    <div className="absolute left-2 top-2 rounded border border-slate-600/40 bg-slate-900/55 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-200 backdrop-blur-md">
      Device Only
    </div>
  );
}

export default function ScanCard({
  scan,
  actionBusy = false,
  selectable = false,
  selected = false,
  onSelectToggle,
  onDelete,
  onSync,
}: ScanCardProps) {
  const isDevice = scan.source === 'device';
  const selectionDisabled = !selectable || actionBusy;

  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-100 p-3 transition-colors hover:border-primary/40 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent" />
        <img
          className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"
          src={scan.thumbnail}
          alt={scan.title}
        />
        <SyncBadge syncState={scan.syncState} />
        <StatusBadge status={scan.status} progress={scan.progress} />
        <button
          type="button"
          aria-label={selected ? `Deselect ${scan.title}` : `Select ${scan.title}`}
          aria-pressed={selected}
          onClick={() => onSelectToggle?.(scan)}
          disabled={selectionDisabled}
          className={`absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full border backdrop-blur-md transition-colors ${
            selected
              ? 'border-primary bg-primary text-white'
              : 'border-slate-300/70 bg-white/85 text-slate-700 dark:border-slate-600 dark:bg-slate-900/75 dark:text-slate-200'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span className="material-symbols-outlined text-[18px]">{selected ? 'check' : 'radio_button_unchecked'}</span>
        </button>
      </div>

      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{scan.title}</h3>
          <span className="material-symbols-outlined cursor-pointer text-slate-400">more_vert</span>
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="material-symbols-outlined text-[14px]">calendar_today</span>
          <span>{scan.capturedAt}</span>
          <span className="mx-1 opacity-30">•</span>
          <span className="material-symbols-outlined text-[14px]">database</span>
          <span>{scan.sizeLabel}</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link
          to={`/viewer/${scan.id}`}
          className="rounded-lg border border-slate-300/90 bg-white/85 px-2 py-2 text-center text-xs font-semibold text-slate-700 transition-colors hover:border-primary/50 hover:text-primary dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
        >
          View
        </Link>
        <Link
          to={`/viewer/${scan.id}?mode=edit`}
          className="rounded-lg border border-slate-300/90 bg-white/85 px-2 py-2 text-center text-xs font-semibold text-slate-700 transition-colors hover:border-primary/50 hover:text-primary dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={() => onDelete?.(scan)}
          disabled={!isDevice || actionBusy}
          className="rounded-lg border border-rose-300/60 bg-rose-500/10 px-2 py-2 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-65 dark:border-rose-400/40"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => onSync?.(scan)}
          disabled={!isDevice || actionBusy || scan.syncState === 'syncing'}
          className="rounded-lg border border-primary/40 bg-primary/10 px-2 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-65"
        >
          {actionBusy || scan.syncState === 'syncing' ? 'Syncing' : scan.syncState === 'synced' ? 'Resync' : 'Sync'}
        </button>
      </div>
    </div>
  );
}
