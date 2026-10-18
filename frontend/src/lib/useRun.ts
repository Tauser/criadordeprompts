import {useEffect, useRef, useState} from 'react';
import {ApiError, api} from '../api/client';
import type {Run} from '../api/types';
import {TERMINAL} from './labels';

// Follows one run: server-sent events with automatic fallback to polling. The server is the source of truth.
export function useRun(runId: string | null) {
  const [run, setRun] = useState<Run | null>(null);
  const [connection, setConnection] = useState<'live' | 'polling' | 'offline'>('live');
  const failures = useRef(0);
  const subscription = useRef(0);

  useEffect(() => {
    setRun(null);
    failures.current = 0;
    const generation = ++subscription.current;
    if (!runId) return;
    let closed = false, polling = false, revision = 0;
    let timer: number | undefined, source: EventSource | null = null;
    const poll = async () => {
      try {
        const next = await api.run(runId);
        if (closed) return;
        failures.current = 0;
        setRun(next);
        setConnection('polling');
        if (!TERMINAL.has(next.status)) timer = window.setTimeout(poll, 2000);
      } catch (error) {
        if (closed) return;
        failures.current += 1;
        setConnection('offline');
        if (error instanceof ApiError && error.status === 404) {setRun(null); return;}
        timer = window.setTimeout(poll, Math.min(15000, 2000 * failures.current));
      }
    };
    const fallback = () => {
      if (closed || polling) return;
      polling = true;
      source?.close();
      poll();
    };
    if (typeof EventSource !== 'undefined') {
      api.run(runId).then(next => {if (!closed && revision === 0 && !polling) setRun(next);}).catch(fallback);
      source = new EventSource(`/api/runs/${runId}/events`);
      source.addEventListener('snapshot', event => {
        if (closed || polling) return;
        let next: Run;
        try {
          next = JSON.parse((event as MessageEvent).data) as Run;
          if (!next || next.id !== runId || typeof next.status !== 'string') {fallback(); return;}
        } catch {fallback(); return;}
        revision++;
        setConnection('live');
        setRun(next);
        if (TERMINAL.has(next.status)) {
          source?.close();
        }
      });
      source.onerror = fallback;
    } else poll();
    return () => {
      closed = true;
      if (subscription.current === generation) subscription.current++;
      source?.close(); window.clearTimeout(timer);
    };
  }, [runId]);

  return {run, connection, refresh: async () => {
    if (!runId) return;
    const generation = subscription.current;
    const next = await api.run(runId);
    if (subscription.current === generation) setRun(next);
  }};
}
