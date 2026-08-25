'use client';

import { useState } from 'react';

interface SearchResult {
  id: string;
  name: string;
  level: string;
  lng: number;
  lat: number;
}

export default function SearchBar({ onSelect }: { onSelect: (result: SearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    setResults(await res.json());
    setSearched(true);
  }

  return (
    <div style={{ position: 'absolute', top: 16, left: 16, width: 280, maxWidth: 'calc(100vw - 32px)', fontFamily: 'system-ui, sans-serif' }}>
      <input
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        placeholder="Search city, area, or country..."
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid #ccc',
          fontSize: 14,
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        }}
      />
      {searched && (
        <div
          style={{
            marginTop: 4,
            background: 'white',
            borderRadius: 8,
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            overflow: 'hidden',
          }}
        >
          {results.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: '#666' }}>
              No data for &quot;{query}&quot; yet — this area isn&apos;t covered.
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onSelect(r);
                  setResults([]);
                  setSearched(false);
                  setQuery(r.name);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  border: 'none',
                  borderTop: '1px solid #eee',
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {r.name} <span style={{ color: '#999', textTransform: 'capitalize' }}>· {r.level}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
