'use client';

import { useEffect } from 'react';

export default function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // installability is a nice-to-have, not a hard requirement — fail quietly
      });
    }
  }, []);
  return null;
}
