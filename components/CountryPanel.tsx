'use client';

interface CountryProps {
  name: string;
  tier: 'has-data' | 'coming-soon' | 'no-data';
  note?: string;
}

const HEADLINE: Record<CountryProps['tier'], string> = {
  'has-data': 'Data available',
  'coming-soon': 'Coming soon',
  'no-data': 'No data available',
};

// spec §3.2: tapping a coming-soon/no-data country never returns a price —
// this panel exists specifically to make "we don't know" a trust signal
// instead of a dead end.
export default function CountryPanel({ country, onClose }: { country: CountryProps; onClose: () => void }) {
  return (
    <div className="overlay-panel" style={panelStyle}>
      <button onClick={onClose} style={closeStyle} aria-label="Close">×</button>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{country.name}</h2>
      <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: country.tier === 'coming-soon' ? '#b45309' : '#666' }}>
        {HEADLINE[country.tier]}
      </p>
      {country.note ? (
        <p style={{ margin: 0, fontSize: 13, color: '#333', lineHeight: 1.5 }}>{country.note}</p>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
          {country.tier === 'coming-soon'
            ? 'A source has been identified but not yet verified or connected.'
            : 'No government or open-licence source has been identified for this country yet.'}
        </p>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 320,
  background: 'white',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  fontFamily: 'system-ui, sans-serif',
  color: '#111',
};

const closeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  border: 'none',
  background: 'none',
  fontSize: 20,
  cursor: 'pointer',
  color: '#666',
};
