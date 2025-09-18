import React, { useEffect, useRef, useState, type ChangeEvent, type FC } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import GPXParser from 'gpxparser';

interface GPXPoint {
  lat: number;
  lon: number;
  ele?: number;          // 고도
}

interface GPXTrack {
  points: GPXPoint[];
}

interface GPXWaypoint {
  lat: number;
  lon: number;
  name?: string;
  desc?: string;
  ele?: number;
}

declare global {
  interface Window {
    google: any;
  }
}

const MapView: FC = () => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<any | null>(null);
  // 오버레이(Polyline, Marker) 저장용 Ref
  const polylinesRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);

  // Google Maps 초기 로드
  useEffect(() => {
    const loader = new Loader({
      apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
      version: 'weekly',
    });
    loader.load().then(() => {
      if (!mapRef.current) return;
      const m = new window.google.maps.Map(mapRef.current, {
        center: { lat: 37.5665, lng: 126.9780 },
        zoom: 12,
        mapId: "c0a25ce225e1da024b403bc2",
        disableDefaultUI: true,
      });
      setMap(m);
    });
  }, []);

  // 고도에 따른 색상 보간 (파랑 → 빨강)
  const getColorForElevation = (e: number, minE: number, maxE: number) => {
    let ratio = (e - minE) / (maxE - minE || 1);
    // 감마 0.5로 보정 → 중간 영역이 더 쨍하게
    ratio = Math.pow(ratio, 4);

    const r = Math.round(255 * ratio);
    const b = Math.round(255 * (1 - ratio));
    return `rgb(${r},0,${b})`;
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!map) return;

    // 1) 초기화: 이전 Polyline & Marker 모두 지도에서 제거
    polylinesRef.current.forEach(poly => poly.setMap(null));
    markersRef.current.forEach(marker => marker.setMap(null));
    polylinesRef.current = [];
    markersRef.current = [];

    // 2) GPX 파싱
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parser = new GPXParser();
    parser.parse(text);

    // 3) 고도 범위 계산
    const tracks = parser.tracks as GPXTrack[];
    const allPts = tracks.flatMap(t => t.points);
    const elevations = allPts.map(p => p.ele ?? 0);
    const minE = Math.min(...elevations), maxE = Math.max(...elevations);

    tracks.forEach(track => {
      const pts = track.points;
      // 각 구간(segment)마다 색을 달리해서 그리기
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i], p2 = pts[i + 1];
        const avgE = ((p1.ele ?? 0) + (p2.ele ?? 0)) / 2;
        const line = new window.google.maps.Polyline({
          path: [
            { lat: p1.lat, lng: p1.lon },
            { lat: p2.lat, lng: p2.lon },
          ],
          strokeColor: getColorForElevation(avgE, minE, maxE),
          strokeOpacity: 0.9,
          strokeWeight: 4,
          map,
        });
        polylinesRef.current.push(line);
      }
    });

    // 2) 웨이포인트에 마커 + InfoWindow
    const waypoints: GPXWaypoint[] = parser.waypoints;
    waypoints.forEach(wp => {
      const marker = new window.google.maps.Marker({
        position: { lat: wp.lat, lng: wp.lon },
        map,
        title: wp.name,
      });
      if (wp.name || wp.desc || wp.ele != null) {
        const info = new window.google.maps.InfoWindow({
          content: `
            <div style="min-width:120px">
              ${wp.name ? `<h4>${wp.name}</h4>` : ''}
              ${wp.desc ? `<p>${wp.desc}</p>` : ''}
              ${wp.ele != null ? `<small>Elevation: ${wp.ele}m</small>` : ''}
            </div>`
        });
        marker.addListener('click', () => info.open(map, marker));
      }
    });

    // 3) 전체 트랙이 보이도록 지도 범위 조정
    const bounds = new window.google.maps.LatLngBounds();
    allPts.forEach(p => bounds.extend({ lat: p.lat, lng: p.lon }));
    (parser.waypoints as GPXWaypoint[]).forEach(wp =>
      bounds.extend({ lat: wp.lat, lng: wp.lon })
    );
    map.fitBounds(bounds);
  };

  return (
    <div className="map-container">
      <input
        className="gpx-file"
        type="file"
        accept=".gpx .xml"
        onChange={handleFile}
      />
      <div className="map-viewer" ref={mapRef} />
    </div>
  );
};

export default MapView;
