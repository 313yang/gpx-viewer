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

  const initializeMap = async () => {
    try {
      const loader = new Loader({
        apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
        version: 'weekly',
      });

      await loader.load();

      if (!mapRef.current) return;

      const googleMap = new window.google.maps.Map(mapRef.current, {
        center: { lat: 37.5665, lng: 126.9780 },
        zoom: 12,
        mapId: "c0a25ce225e1da024b403bc2",
        disableDefaultUI: true,
      });

      setMap(googleMap);
    } catch (error) {
      console.error('Error loading Google Maps:', error);
    }
  };

  useEffect(() => {
    initializeMap();
  }, []);

  const getColorForElevation = (elevation: number, minElevation: number, maxElevation: number): string => {
    const ratio = (elevation - minElevation) / (maxElevation - minElevation || 1);
    const normalizedRatio = Math.max(0, Math.min(1, ratio));

    // Low elevation: rgb(128, 140, 255) (RGB: 197, 180, 255)
    // High elevation: rgb(255, 125, 113) (RGB: 255, 171, 147)
    const lowColor = { r: 128, g: 140, b: 255 };
    const highColor = { r: 255, g: 125, b: 113 };

    const r = Math.round(lowColor.r + (highColor.r - lowColor.r) * normalizedRatio);
    const g = Math.round(lowColor.g + (highColor.g - lowColor.g) * normalizedRatio);
    const b = Math.round(lowColor.b + (highColor.b - lowColor.b) * normalizedRatio);

    return `rgb(${r}, ${g}, ${b})`;
  };

  const clearMapOverlays = () => {
    polylinesRef.current.forEach(polyline => polyline.setMap(null));
    markersRef.current.forEach(marker => marker.setMap(null));
    polylinesRef.current = [];
    markersRef.current = [];
  };

  const calculateDistance = (point1: GPXPoint, point2: GPXPoint): number => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLon = (point2.lon - point1.lon) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calculateBearing = (point1: GPXPoint, point2: GPXPoint): number => {
    const dLon = (point2.lon - point1.lon) * Math.PI / 180;
    const lat1 = point1.lat * Math.PI / 180;
    const lat2 = point2.lat * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  };

  const calculateElevationRange = (tracks: GPXTrack[]) => {
    const allPoints = tracks.flatMap(track => track.points);
    const elevations = allPoints.map(point => point.ele ?? 0);
    return {
      min: Math.min(...elevations),
      max: Math.max(...elevations),
      allPoints
    };
  };

  const renderTrackSegments = (tracks: GPXTrack[], minElevation: number, maxElevation: number) => {
    tracks.forEach(track => {
      const points = track.points;
      for (let i = 0; i < points.length - 1; i++) {
        const currentPoint = points[i];
        const nextPoint = points[i + 1];
        const averageElevation = ((currentPoint.ele ?? 0) + (nextPoint.ele ?? 0)) / 2;

        const polyline = new window.google.maps.Polyline({
          path: [
            { lat: currentPoint.lat, lng: currentPoint.lon },
            { lat: nextPoint.lat, lng: nextPoint.lon }
          ],
          strokeColor: getColorForElevation(averageElevation, minElevation, maxElevation),
          strokeOpacity: 0.9,
          strokeWeight: 4,
          map
        });
        polylinesRef.current.push(polyline);
      }
    });
  };

  const renderDirectionArrows = (tracks: GPXTrack[]) => {
    tracks.forEach(track => {
      const points = track.points;
      let accumulatedDistance = 0;
      let lastArrowDistance = 0;

      for (let i = 0; i < points.length - 1; i++) {
        const currentPoint = points[i];
        const nextPoint = points[i + 1];
        const segmentDistance = calculateDistance(currentPoint, nextPoint);
        accumulatedDistance += segmentDistance;

        if (accumulatedDistance - lastArrowDistance >= 3) { // 5km intervals
          const bearing = calculateBearing(currentPoint, nextPoint);

          const arrowMarker = new window.google.maps.Marker({
            position: { lat: currentPoint.lat, lng: currentPoint.lon },
            map,
            icon: {
              path: 'M 0,-1.2 L -1.2,1.5 L 0,0.5 L 1.2,1.5 Z',
              fillColor: 'rgb(128, 140, 255)',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 1,
              scale: 6,
              rotation: bearing
            },
            title: `Distance: ${accumulatedDistance.toFixed(1)}km`
          });

          markersRef.current.push(arrowMarker);
          lastArrowDistance = accumulatedDistance;
        }
      }
    });
  };

  const renderWaypoints = (waypoints: GPXWaypoint[]) => {
    waypoints.forEach(waypoint => {
      const marker = new window.google.maps.Marker({
        position: { lat: waypoint.lat, lng: waypoint.lon },
        map,
        title: waypoint.name
      });

      markersRef.current.push(marker);

      if (waypoint.name || waypoint.desc || waypoint.ele != null) {
        const infoWindow = new window.google.maps.InfoWindow({
          content: `
            <div style="min-width:120px">
              ${waypoint.name ? `<h4>${waypoint.name}</h4>` : ''}
              ${waypoint.desc ? `<p>${waypoint.desc}</p>` : ''}
              ${waypoint.ele != null ? `<small>Elevation: ${waypoint.ele}m</small>` : ''}
            </div>`
        });
        marker.addListener('click', () => infoWindow.open(map, marker));
      }
    });
  };

  const fitMapBounds = (allPoints: GPXPoint[], waypoints: GPXWaypoint[]) => {
    const bounds = new window.google.maps.LatLngBounds();
    allPoints.forEach(point => bounds.extend({ lat: point.lat, lng: point.lon }));
    waypoints.forEach(waypoint => bounds.extend({ lat: waypoint.lat, lng: waypoint.lon }));
    map.fitBounds(bounds);
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!map) return;

    clearMapOverlays();

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parser = new GPXParser();
      parser.parse(text);

      const tracks = parser.tracks as GPXTrack[];
      const waypoints = parser.waypoints as GPXWaypoint[];

      const { min: minElevation, max: maxElevation, allPoints } = calculateElevationRange(tracks);

      renderTrackSegments(tracks, minElevation, maxElevation);
      renderDirectionArrows(tracks);
      renderWaypoints(waypoints);
      fitMapBounds(allPoints, waypoints);
    } catch (error) {
      console.error('Error parsing GPX file:', error);
    }
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
