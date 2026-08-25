'use client';

import { useEffect, useState } from 'react';

interface RegionSummary {
  period: string;
  listing_type: 'sale' | 'rent';
  median_price: string;
  transaction_count: number;
  tier: 'A' | 'B';
}

interface Transaction {
  id: string;
  source: string;
  sale_date: string;
  price: string;
  currency: string;
  address: string | null;
  property_type: string | null;
  floor_area_sqm: string | null;
  listing_type: 'sale' | 'rent';
}

interface RegionDetail {
  region: { id: string; name: string; level: string; country_code: string; currency: string };
  summaries: RegionSummary[];
  transactions: { sale: Transaction[]; rent: Transaction[] };
}

const TIER_LABEL: Record<string, string> = { A: 'High confidence', B: 'Medium confidence' };

function formatPrice(amount: string, currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    Number(amount)
  );
}

export default function AreaCard({ regionId, onClose }: { regionId: string; onClose: () => void }) {
  const [data, setData] = useState<RegionDetail | null>(null);
  const [tab, setTab] = useState<'sale' | 'rent'>('sale');

  useEffect(() => {
    setData(null);
    fetch(`/api/regions/${regionId}`)
      .then((r) => r.json())
      .then(setData);
  }, [regionId]);

  if (!data) {
    return (
      <div className="overlay-panel" style={panelStyle}>
        <button onClick={onClose} style={closeStyle}>×</button>
        <p>Loading…</p>
      </div>
    );
  }

  const { region, summaries, transactions } = data;
  const latestByType = (type: 'sale' | 'rent') => summaries.find((s) => s.listing_type === type);
  const latestSale = latestByType('sale');
  const latestRent = latestByType('rent');
  const hasBoth = !!latestSale && !!latestRent;
  const active = tab === 'rent' && latestRent ? latestRent : latestSale;

  return (
    <div className="overlay-panel" style={panelStyle}>
      <button onClick={onClose} style={closeStyle} aria-label="Close">×</button>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{region.name}</h2>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#666', textTransform: 'capitalize' }}>{region.level}</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setTab('sale')}
          disabled={!latestSale}
          style={toggleStyle(tab === 'sale', !latestSale)}
          title={!latestSale ? 'No sale data for this area' : undefined}
        >
          Buy
        </button>
        <button
          onClick={() => setTab('rent')}
          disabled={!latestRent}
          style={toggleStyle(tab === 'rent', !latestRent)}
          title={!hasBoth ? 'No paired rental data for this area yet' : undefined}
        >
          Rent
        </button>
      </div>

      {active ? (
        <>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {formatPrice(active.median_price, region.currency)}
            {tab === 'rent' && <span style={{ fontSize: 14, fontWeight: 400 }}> /month</span>}
          </div>
          {/* guardrail 1: transaction count + date, same weight as the price — never fine print */}
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
            {active.transaction_count} transactions · {active.period}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{TIER_LABEL[active.tier]}</div>
        </>
      ) : (
        <p>No data.</p>
      )}

      {(() => {
        const list = transactions[tab];
        if (list.length === 0) return null;
        return (
          <>
            <h3 style={{ fontSize: 13, margin: '16px 0 8px', color: '#444' }}>Recent transactions</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto' }}>
              {list.map((t) => (
                <li key={t.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #eee' }}>
                  <div>{t.address || '(address withheld by source)'}</div>
                  <div style={{ color: '#666' }}>
                    {t.sale_date} · {formatPrice(t.price, t.currency)} · {t.property_type} · source: {t.source}
                  </div>
                </li>
              ))}
            </ul>
          </>
        );
      })()}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 320,
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'calc(100dvh - 32px)',
  overflowY: 'auto',
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

function toggleStyle(activeTab: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 12px',
    borderRadius: 4,
    border: '1px solid #ccc',
    background: activeTab ? '#111' : 'white',
    color: activeTab ? 'white' : disabled ? '#bbb' : '#111',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
  };
}
