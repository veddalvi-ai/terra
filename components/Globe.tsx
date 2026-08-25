'use client';

import { useEffect, useRef, useState } from 'react';
import { Map, NavigationControl, GlobeControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import AreaCard from './AreaCard';
import CountryPanel from './CountryPanel';
import SearchBar from './SearchBar';
import { formatCompactPrice } from '@/lib/formatPrice';
import { flyEase } from '@/lib/flyEase';

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// Turbopack can't resolve MapLibre's own script URL for its worker (auto-detection
// yields an empty string, so `new Worker('')` fails silently and every tile hangs
// forever). Point it at a static copy instead.
setWorkerUrl('/maplibre-gl-worker.mjs');

interface RegionPin {
  id: string;
  name: string;
  level: 'city' | 'area';
  lng: number;
  lat: number;
  sale_median: string | null;
  rent_median: string | null;
  currency: string;
}

interface CountryFeatureProps {
  iso: string;
  name: string;
  tier: 'has-data' | 'coming-soon' | 'no-data';
  note?: string;
}

export default function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryFeatureProps | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: OPENFREEMAP_STYLE,
      center: [0, 20],
      zoom: 1.5,
    });

    map.addControl(new NavigationControl(), 'top-right');
    map.addControl(new GlobeControl(), 'top-right');

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
    });

    map.on('load', async () => {
      // Country choropleth (spec §3.1 "Space" zoom / §3.2) — 3 flat shades, no
      // numbers, faded out once you're zoomed past the whole-world view so it
      // never obscures the real street map underneath.
      map.addSource('countries', { type: 'geojson', data: '/countries.geojson' });
      map.addLayer({
        id: 'countries-fill',
        type: 'fill',
        source: 'countries',
        paint: {
          'fill-color': [
            'match',
            ['get', 'tier'],
            'has-data', '#1d4ed8',
            'coming-soon', '#f59e0b',
            /* no-data */ '#9ca3af',
          ],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.45, 2, 0.45, 4, 0],
        },
      });
      map.addLayer({
        id: 'countries-outline',
        type: 'line',
        source: 'countries',
        paint: {
          'line-color': '#ffffff',
          'line-width': 0.5,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 2, 0.6, 4, 0],
        },
      });

      map.on('click', 'countries-fill', (e) => {
        const props = e.features?.[0]?.properties as CountryFeatureProps | undefined;
        if (!props) return;
        if (props.tier === 'has-data') {
          setSelectedCountry(null);
          map.flyTo({ center: e.lngLat, zoom: 5, easing: flyEase });
        } else {
          setSelectedRegionId(null);
          setSelectedCountry(props);
        }
      });
      map.on('mouseenter', 'countries-fill', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'countries-fill', () => (map.getCanvas().style.cursor = ''));

      const res = await fetch('/api/regions');
      const pins: RegionPin[] = await res.json();

      // context.md §6: cluster pins so a dense country doesn't turn to mush.
      // MapLibre's built-in GeoJSON clustering handles this natively — no need
      // to reach for deck.gl just for this.
      map.addSource('area-pins', {
        type: 'geojson',
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 50,
        data: {
          type: 'FeatureCollection',
          features: pins.map((p) => {
            const price = p.sale_median ?? p.rent_median;
            return {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
              properties: {
                id: p.id,
                name: p.name,
                level: p.level,
                priceLabel: price ? `${p.name}\n${formatCompactPrice(Number(price), p.currency)}` : p.name,
              },
            };
          }),
        },
      });

      map.addLayer({
        id: 'clusters-layer',
        type: 'circle',
        source: 'area-pins',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
          'circle-color': '#1e40af',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: 'cluster-count-layer',
        type: 'symbol',
        source: 'area-pins',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      });

      map.addLayer({
        id: 'area-pins-layer',
        type: 'circle',
        source: 'area-pins',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['match', ['get', 'level'], 'city', 10, 6],
          'circle-color': '#2563eb',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // Price labels crossfade in as you approach city zoom rather than
      // popping into existence (context.md §6).
      map.addLayer({
        id: 'area-pins-label',
        type: 'symbol',
        source: 'area-pins',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['get', 'priceLabel'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 1],
        },
      });

      map.on('click', 'clusters-layer', async (e) => {
        const feature = e.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        if (clusterId == null) return;
        const source = map.getSource('area-pins') as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        const geometry = feature!.geometry;
        if (geometry.type !== 'Point') return;
        map.easeTo({ center: geometry.coordinates as [number, number], zoom, easing: flyEase });
      });
      map.on('mouseenter', 'clusters-layer', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'clusters-layer', () => (map.getCanvas().style.cursor = ''));

      map.on('click', 'area-pins-layer', (e) => {
        const feature = e.features?.[0];
        if (feature?.properties) {
          setSelectedCountry(null);
          setSelectedRegionId(feature.properties.id as string);
        }
      });
      map.on('mouseenter', 'area-pins-layer', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'area-pins-layer', () => (map.getCanvas().style.cursor = ''));
    });

    mapRef.current = map;
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __terraMap?: Map }).__terraMap = map;
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <>
      <div ref={containerRef} style={{ width: '100vw', height: '100dvh' }} />
      <SearchBar
        onSelect={(result) => {
          mapRef.current?.flyTo({
            center: [result.lng, result.lat],
            zoom: result.level === 'area' ? 12 : 10,
            easing: flyEase,
          });
          if (result.level === 'city' || result.level === 'area') {
            setSelectedCountry(null);
            setSelectedRegionId(result.id);
          }
        }}
      />
      {selectedRegionId && <AreaCard regionId={selectedRegionId} onClose={() => setSelectedRegionId(null)} />}
      {selectedCountry && <CountryPanel country={selectedCountry} onClose={() => setSelectedCountry(null)} />}
    </>
  );
}
