import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchScans, getCachedScans, type FetchScansInput, type ScanRecord } from '../services/scanService';

type UseScanLibraryResult = {
  scans: ScanRecord[];
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
  removeScans: (scanIds: string[]) => void;
};

export function useScanLibrary({ tab = 'all', query = '' }: FetchScansInput): UseScanLibraryResult {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scansRef = useRef<ScanRecord[]>([]);

  useEffect(() => {
    scansRef.current = scans;
  }, [scans]);

  const removeScans = useCallback((scanIds: string[]) => {
    const ids = new Set(scanIds.map((value) => String(value || '').trim()).filter(Boolean));

    if (!ids.size) {
      return;
    }

    setScans((current) => current.filter((scan) => !ids.has(scan.id) && !ids.has(scan.remoteId || '')));
  }, []);

  const loadScans = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const shouldBlockUi = !background || scansRef.current.length === 0;

    if (shouldBlockUi) {
      setLoading(true);
      setError('');
    }

    try {
      const result = await fetchScans({ tab, query });
      setScans(result);
      setError('');
    } catch {
      if (shouldBlockUi) {
        setError('Unable to load scans right now.');
      }
    } finally {
      if (shouldBlockUi) {
        setLoading(false);
      }
    }
  }, [query, tab]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setError('');
      let hydrated = false;

      try {
        const cached = await getCachedScans({ tab, query });

        if (!active) {
          return;
        }

        setScans(cached);
        hydrated = cached.length > 0;
      } catch {
        // Ignore cache hydrate failures and keep going with a full refresh.
      } finally {
        if (!active) {
          return;
        }

        if (hydrated) {
          setLoading(false);
        }
      }

      try {
        const result = await fetchScans({ tab, query });

        if (!active) {
          return;
        }

        setScans(result);
        setError('');
      } catch {
        if (!active) {
          return;
        }

        if (!hydrated) {
          setError('Unable to load scans right now.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [query, tab]);

  useEffect(() => {
    const reload = () => {
      void loadScans({ background: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reload();
      }
    };

    window.addEventListener('focus', reload);
    window.addEventListener('pageshow', reload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('pageshow', reload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadScans]);

  return {
    scans,
    loading,
    error,
    refetch: loadScans,
    removeScans,
  };
}
