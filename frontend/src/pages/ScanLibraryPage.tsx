import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ScanCard from '../components/library/ScanCard';
import BottomNav from '../components/navigation/BottomNav';
import { useScanLibrary } from '../hooks/useScanLibrary';
import { deleteCapturedScan, syncCapturedScan, type ScanRecord } from '../services/scanService';

const tabs = [
  { key: 'all', label: 'All Projects' },
  { key: 'recent', label: 'Recent' },
  { key: 'cloud', label: 'Cloud Sync' },
] as const;

export default function ScanLibraryPage() {
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['key']>('all');
  const [query, setQuery] = useState('');
  const [actionById, setActionById] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { scans, loading, error, refetch, removeScans } = useScanLibrary({
    tab: activeTab,
    query,
  });
  const deviceScans = useMemo(() => scans.filter((scan) => scan.source === 'device'), [scans]);
  const selectedDeviceScans = useMemo(
    () => deviceScans.filter((scan) => selectedIds.includes(scan.id)),
    [deviceScans, selectedIds],
  );
  const allDeviceSelected = deviceScans.length > 0 && selectedDeviceScans.length === deviceScans.length;
  const bulkBusy = selectedDeviceScans.some((scan) => Boolean(actionById[scan.id]));

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => scans.some((scan) => scan.id === id)));
  }, [scans]);

  const setBusy = (scanId: string, busy: boolean) => {
    setActionById((current) => ({
      ...current,
      [scanId]: busy,
    }));
  };

  const toggleSelected = (scan: ScanRecord) => {
    if (scan.source !== 'device' || actionById[scan.id]) {
      return;
    }

    setSelectedIds((current) =>
      current.includes(scan.id) ? current.filter((id) => id !== scan.id) : [...current, scan.id],
    );
  };

  const handleSelectAll = () => {
    if (allDeviceSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(deviceScans.map((scan) => scan.id));
  };

  const handleDeleteScan = async (scan: ScanRecord) => {
    if (scan.source !== 'device') {
      return;
    }

    const confirmed = window.confirm(`Delete "${scan.title}" from this device?`);

    if (!confirmed) {
      return;
    }

    setBusy(scan.id, true);

    try {
      const deleted = await deleteCapturedScan(scan.id);

      if (deleted) {
        removeScans([scan.id, scan.remoteId || '']);
      }
    } finally {
      setBusy(scan.id, false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedDeviceScans.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedDeviceScans.length} selected scan${selectedDeviceScans.length === 1 ? '' : 's'} from this device?`,
    );

    if (!confirmed) {
      return;
    }

    const selectedSet = new Set(selectedDeviceScans.map((scan) => scan.id));

    setActionById((current) => {
      const next = { ...current };

      for (const scan of selectedDeviceScans) {
        next[scan.id] = true;
      }

      return next;
    });

    try {
      const results = await Promise.allSettled(selectedDeviceScans.map((scan) => deleteCapturedScan(scan.id)));
      const deletedIds = selectedDeviceScans
        .filter((scan, index) => results[index]?.status === 'fulfilled' && results[index].value)
        .flatMap((scan) => [scan.id, scan.remoteId || ''])
        .filter(Boolean);

      setSelectedIds((current) => current.filter((id) => !selectedSet.has(id)));

      if (deletedIds.length) {
        removeScans(deletedIds);
      }
    } finally {
      setActionById((current) => {
        const next = { ...current };

        for (const scan of selectedDeviceScans) {
          next[scan.id] = false;
        }

        return next;
      });
    }
  };

  const handleSyncScan = async (scan: ScanRecord) => {
    if (scan.source !== 'device') {
      return;
    }

    setBusy(scan.id, true);

    try {
      const syncPromise = syncCapturedScan(scan.id);
      await refetch();
      await syncPromise;
      await refetch();
    } finally {
      setBusy(scan.id, false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background-light text-slate-900 dark:bg-background-dark dark:text-slate-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-background-light/80 p-4 backdrop-blur-md dark:border-slate-800 dark:bg-background-dark/80">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl text-primary">view_in_ar</span>
          <div>
            <h2 className="text-lg font-bold leading-tight tracking-tight">ScanLibrary</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {user?.fullName || user?.email || 'Signed in'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-10 items-center justify-center rounded-full px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={signOut}
          >
            Logout
          </button>
          <div className="flex size-10 items-center justify-center rounded-full border border-primary/30 bg-primary/20">
            <span className="text-sm font-semibold text-primary">
              {(user?.fullName || user?.email || 'U').trim().charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-28" aria-labelledby="library-screen-title">
        <h1 id="library-screen-title" className="sr-only">
          Scan Library
        </h1>

        <div className="px-4 py-4">
          <label className="group relative flex w-full flex-col">
            <div className="flex h-12 w-full items-stretch rounded-xl border border-transparent bg-slate-200/50 transition-all focus-within:border-primary/50 dark:bg-slate-800/50">
              <div className="flex items-center justify-center pl-4 text-slate-500 dark:text-slate-400">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                className="min-w-0 flex-1 border-none bg-transparent px-3 text-base font-normal text-slate-900 placeholder:text-slate-500 focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-400"
                placeholder="Search project scans..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </label>
        </div>

        <div className="mb-4 px-4">
          <div className="flex gap-6 border-b border-slate-200 dark:border-slate-800">
            {tabs.map((tab) => {
              const active = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex flex-col items-center justify-center border-b-2 px-1 pb-3 pt-2 transition-colors ${
                    active
                      ? 'border-primary text-primary'
                      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <span className="text-sm font-semibold">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {!loading && !error && deviceScans.length > 0 ? (
          <div className="px-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-100/70 p-3 dark:border-slate-800 dark:bg-slate-800/30">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {selectedDeviceScans.length > 0
                  ? `${selectedDeviceScans.length} selected`
                  : `${deviceScans.length} device scan${deviceScans.length === 1 ? '' : 's'} available`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={bulkBusy}
                  className="rounded-lg border border-slate-300/90 bg-white/85 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
                >
                  {allDeviceSelected ? 'Clear Selection' : 'Select All'}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={selectedDeviceScans.length === 0 || bulkBusy}
                  className="rounded-lg border border-rose-300/60 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-400/40"
                >
                  Delete Selected
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <div className="col-span-full rounded-xl border border-slate-200 bg-slate-100/50 p-6 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-800/20 dark:text-slate-400">
              Loading scans...
            </div>
          ) : null}

          {!loading && error ? (
            <div className="col-span-full rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="mt-3 rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10"
              >
                Retry
              </button>
            </div>
          ) : null}

          {!loading && !error && scans.length === 0 ? (
            <div className="col-span-full rounded-xl border border-slate-200 bg-slate-100/50 p-6 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-800/20 dark:text-slate-400">
              No scans found for your search.
            </div>
          ) : null}

          {!loading && !error
            ? scans.map((scan) => (
                <ScanCard
                  key={scan.id}
                  scan={scan}
                  selectable={scan.source === 'device'}
                  selected={selectedIds.includes(scan.id)}
                  onSelectToggle={toggleSelected}
                  onDelete={handleDeleteScan}
                  onSync={handleSyncScan}
                  actionBusy={Boolean(actionById[scan.id])}
                />
              ))
            : null}

          <Link
            to="/scan"
            className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-100/50 p-3 transition-all hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-800/10 dark:hover:bg-slate-800/20 sm:aspect-auto"
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <span className="material-symbols-outlined text-3xl text-primary">add</span>
            </div>
            <p className="font-medium text-slate-500 dark:text-slate-400">Create New Scan</p>
          </Link>
        </div>
      </main>

      <Link
        to="/scan"
        className="fixed bottom-28 right-6 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/40 transition-transform hover:scale-110 active:scale-95"
      >
        <span className="material-symbols-outlined text-3xl">add_a_photo</span>
      </Link>

      <BottomNav fixed />
    </div>
  );
}
