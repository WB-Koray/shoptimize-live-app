import { useState, useEffect, useRef, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';
const MAX_EVENTS = 500;

export function useSSE(tid, token) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);
  const retryRef = useRef(null);
  const mountedRef = useRef(true);
  const seenRef = useRef(new Set());

  const connect = useCallback(() => {
    if (!tid || !token || !mountedRef.current) return;

    const url = `${API_URL}/api/live/stream?tid=${encodeURIComponent(tid)}&token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (mountedRef.current) setConnected(true);
    };

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const event = JSON.parse(e.data);
        // Deduplicate by vid+ts+event_type combo
        const key = `${event.vid}|${event.ts}|${event.event_type}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        if (seenRef.current.size > MAX_EVENTS * 2) {
          // Trim old keys to avoid unbounded growth
          const arr = [...seenRef.current];
          seenRef.current = new Set(arr.slice(arr.length - MAX_EVENTS));
        }
        setEvents((prev) => {
          const next = [event, ...prev];
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next;
        });
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      es.close();
      esRef.current = null;
      retryRef.current = setTimeout(connect, 5000);
    };
  }, [tid, token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(retryRef.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  return { events, connected };
}
