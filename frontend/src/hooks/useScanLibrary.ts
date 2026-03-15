import { useCallback, useEffect, useState } from 'react';
import { fetchScans, type FetchScansInput, type ScanRecord } from '../services/scanService';

type UseScanLibraryResult = {
  scans: ScanRecord[];
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
};

export function useScanLibrary({ tab = 'all', query = '' }: FetchScansInput): UseScanLibraryResult {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadScans = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const result = await fetchScans({ tab, query });
      setScans(result);
    } catch {
      setError('Unable to load scans right now.');
    } finally {
      setLoading(false);
    }
  }, [query, tab]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);
      setError('');

      try {
        const result = await fetchScans({ tab, query });

        if (!active) {
          return;
        }

        setScans(result);
      } catch {
        if (!active) {
          return;
        }

        setError('Unable to load scans right now.');
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
      void loadScans();
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
  };
}
