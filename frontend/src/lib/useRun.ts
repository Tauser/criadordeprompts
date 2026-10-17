import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import type {Run} from '../api/types';
import {TERMINAL} from './labels';

// Follows one run: server-sent events with automatic fallback to polling. The server is the source of truth.
export function useRun(runId: string | null) {
  const [run, setRun] = useState<Run | null>(null);
  const [connection, setConnection] = useState<'live' | 'polling' | 'offline'>('live');
  const failures = useRef(0);

  useEffect(() => {
    setRun(null);
    if (!runId) return;
    let closed = false, timer: number | undefined, source: EventSource | null = null;
    const poll = async () => {
      try {
        const next = await api.run(runId);
        if (closed) return;
        failures.current = 0;
        setRun(next);
        setConnection('polling');
        if (!TERMINAL.has(next.status)) timer = window.setTimeout(poll, 2000);
      } catch {
        failures.current += 1;
        setConnection('offline');
        if (!closed) timer = window.setTimeout(poll, Math.min(15000, 2000 * failures.current));
      }
    };
    api.run(runId).then(next => {if (!closed) setRun(next);}).catch(() => undefined);
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(`/api/runs/${runId}/events`);
      source.addEventListener('snapshot', event => {
        const next = JSON.parse((event as MessageEvent).data) as Run;
        setConnection('live');
        setRun(previous => ({...previous, ...next}) as Run);
        if (TERMINAL.has(next.status)) {
          source?.close();
          api.run(runId).then(full => {if (!closed) setRun(full);}).catch(() => undefined);
        }
      });
      source.onerror = () => {
        source?.close();
        if (!closed) poll();
      };
    } else poll();
    return () => {closed = true; source?.close(); window.clearTimeout(timer);};
  }, [runId]);

  return {run, connection, refresh: async () => runId && setRun(await api.run(runId))};
}
