import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import type {PersonBox} from '../api/types';

export interface PeopleDetection {hash: string; status: 'counting' | 'done' | 'failed'; count?: number; people?: PersonBox[];
  error?: string}

const POLL_MS = 1500, MAX_POLLS = 80;

// Finds the faces in the photo being edited, once per photo: where each person is (for "Trocar pessoas") and how many
// there are. `onCount` fills "Pessoas na foto" only while that field is empty (`wanted`), and only when at least one
// face was found; zero means "could not tell".
export function usePeopleCount(hash: string | null, wanted: boolean, online: boolean,
                               onCount: (hash: string, count: number) => void): PeopleDetection | null {
  const [detection, setDetection] = useState<PeopleDetection | null>(null);
  const tried = useRef(new Set<string>());
  const report = useRef(onCount);
  report.current = onCount;
  const want = useRef(wanted);
  want.current = wanted;
  useEffect(() => {
    if (!hash || !online || tried.current.has(hash)) return;
    tried.current.add(hash);
    let stopped = false, finished = false, id: string | undefined;
    setDetection({hash, status: 'counting'});
    (async () => {
      try {
        let job = await api.countPeople(hash);
        id = job.id;
        for (let i = 0; i < MAX_POLLS && !stopped && (job.status === 'queued' || job.status === 'running'); i++) {
          await new Promise(r => setTimeout(r, POLL_MS));
          if (!stopped) job = await api.peopleCount(job.id);
        }
        finished = job.status !== 'queued' && job.status !== 'running';
        if (stopped) return;
        if (job.status === 'completed' && job.count !== undefined) {
          setDetection({hash, status: 'done', count: job.count, people: job.people ?? []});
          if (job.count > 0 && want.current) report.current(hash, job.count);
        } else {
          setDetection({hash, status: 'failed', error: job.error ?? 'A contagem automática não terminou.'});
        }
      } catch (error) {
        finished = true;
        if (!stopped) setDetection({hash, status: 'failed', error: (error as Error).message});
      }
    })();
    return () => {
      stopped = true;
      if (!finished) {                     // interrupted: the same photo may be counted again later
        tried.current.delete(hash);
        setDetection(current => current?.hash === hash && current.status === 'counting' ? null : current);
        if (id) api.cancelPeopleCount(id).catch(() => undefined);
      }
    };
  }, [hash, online]);
  return detection?.hash === hash ? detection : null;
}
