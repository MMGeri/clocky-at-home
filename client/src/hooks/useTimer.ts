import { useState, useEffect, useRef, useCallback } from 'react';

export function useTimer() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        if (startRef.current) {
          setElapsed(Math.floor((Date.now() - startRef.current.getTime()) / 1000));
        }
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const start = useCallback(function start(fromTime?: Date) {
    startRef.current = fromTime ?? new Date();
    setElapsed(Math.floor((Date.now() - startRef.current.getTime()) / 1000));
    setRunning(true);
  }, []);

  const stop = useCallback(function stop(): { startTime: Date; endTime: Date; duration: number } | null {
    if (!startRef.current) return null;
    const endTime = new Date();
    const duration = Math.floor((endTime.getTime() - startRef.current.getTime()) / 1000);
    const startTime = startRef.current;
    setRunning(false);
    setElapsed(0);
    startRef.current = null;
    return { startTime, endTime, duration };
  }, []);

  return { running, elapsed, start, stop };
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}
