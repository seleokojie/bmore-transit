import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, Vehicle, RouteRow } from '../core/api.service';
import maplibregl from 'maplibre-gl';

@Component({
  selector: 'app-map-shell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map-shell.component.html',
  styleUrls: ['./map-shell.component.scss'],
})
export class MapShellComponent {
  private api = inject(ApiService);
  vehicles = signal<Vehicle[]>([]);
  map?: any;
  private mapReady = false;
  sourceId = 'vehicles-src';
  layerId = 'vehicles-layer';
  currentStyle = 'liberty';
  // Route-colored markers
  private routeColorMap = new Map<string, string>();
  private routeMeta = new Map<string, RouteRow>();
  private palette = ['#2563EB','#F59E0B','#10B981','#EF4444','#8B5CF6','#06B6D4','#84CC16','#D946EF','#F97316','#22D3EE'];
  routes = signal<RouteRow[]>([]);
  currentRouteId: string | null = null;
  unit: 'mph' | 'kmh' = ((globalThis as any).localStorage?.getItem('unit') as any) === 'kmh' ? 'kmh' : 'mph';
  private popup: maplibregl.Popup | null = null;
  private pinned = false;
  private pinnedId: string | null = null;
  private onMouseEnter = (e: any) => {
    if (!e?.features?.length) return;
    this.map.getCanvas().style.cursor = 'pointer';
    const f = e.features[0];
    if (!this.pinned) this.showVehiclePopup(f, e.lngLat);
  };
  private onMouseMove = (e: any) => {
    if (!e?.features?.length) return;
    const f = e.features[0];
    if (!this.pinned) this.updateVehiclePopup(f, e.lngLat);
  };
  private onMouseLeave = () => {
    this.map.getCanvas().style.cursor = '';
    if (!this.pinned) this.removePopup();
  };
  private onLayerClick = (e: any) => {
    if (!e?.features?.length) return;
    const f = e.features[0];
    this.pinned = true;
    this.pinnedId = f.properties?.id || null;
    this.showVehiclePopup(f, e.lngLat);
  };
  private onMapClick = (e: any) => {
    // Unpin if clicking outside any vehicle feature
    const feats = this.map.queryRenderedFeatures(e.point, { layers: [this.layerId] });
    if (!feats.length) {
      this.pinned = false;
      this.pinnedId = null;
      this.removePopup();
    }
  };

  styles: Record<string, string> = {
    liberty: 'https://tiles.openfreemap.org/styles/liberty',
    bright: 'https://tiles.openfreemap.org/styles/bright',
    positron: 'https://tiles.openfreemap.org/styles/positron',
    // 3D uses liberty + extrusions; we use liberty URL
    '3d': 'https://tiles.openfreemap.org/styles/liberty',
  };

  constructor() {
    // Note: You may see console warnings "Expected value to be of type number, but found null instead"
    // These come from the vector tile data in OpenFreeMap styles and are harmless - they don't affect functionality
    
    // Initial poll
    this.poll();
    // Poll every 5s
    setInterval(() => this.poll(), 5000);
    // Load route colors
    this.loadRoutes();
  }

  ngAfterViewInit() {
    const styleOverride = (window as any)['MAP_STYLE_URL'] as string | undefined;
    let initialStyle = this.currentStyle; // default 'liberty'
    
    if (styleOverride) {
      this.styles['custom'] = styleOverride;
      initialStyle = 'custom';
    }

    this.map = new maplibregl.Map({
      container: 'map',
      style: this.styles[initialStyle],
      center: [-76.6122, 39.2904],
      zoom: 12,
      pitch: 0,
      bearing: 0,
    });

    // Basic map UI controls
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }));

    // ESC key to unpin/close popup
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.pinned = false;
        this.pinnedId = null;
        this.removePopup();
      }
    };
    window.addEventListener('keydown', onKey);
    // Store reference for removal in destroy
    (this as any)._onKey = onKey;

    // Ensure vehicles layer exists on initial load and whenever the style changes
    this.map.on('load', () => {
      this.mapReady = true;
      this.ensureVehicleLayer();
    });
    this.map.on('style.load', () => {
      this.mapReady = true;
      this.ensureVehicleLayer();
      this.ensureRouteLayer();
      
      // Handle 3D building setup if we're in 3D mode
      if (this.currentStyle === '3d') {
        this.map.easeTo({ pitch: 60, bearing: -17.6, duration: 500 });
        this.enable3DBuildings();
      } else {
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
        this.disable3DBuildings();
      }
    });
  }
  ngOnDestroy() {
    try {
      const onKey = (this as any)._onKey as ((e: KeyboardEvent)=>void) | undefined;
      if (onKey) window.removeEventListener('keydown', onKey);
    } catch {}
    try {
      if (this.map) {
        this.map.off('mouseenter', this.layerId, this.onMouseEnter);
        this.map.off('mousemove', this.layerId, this.onMouseMove);
        this.map.off('mouseleave', this.layerId, this.onMouseLeave);
        this.map.off('click', this.layerId, this.onLayerClick);
        this.map.off('click', this.onMapClick);
      }
    } catch {}
  }

  setBase(styleKey: 'liberty' | 'bright' | 'positron' | '3d') {
    this.currentStyle = styleKey;
    const url = this.styles[styleKey];
    if (!this.map || !url) return;
    
    this.mapReady = false; // Reset flag when changing styles
    this.map.setStyle(url);
    
    let handled = false;
    
    const handleStyleLoaded = () => {
      if (handled) return; // Prevent double execution
      handled = true;
      
      this.mapReady = true;
      this.ensureVehicleLayer();
      this.ensureRouteLayer();
      
      // Apply style-specific settings after layer is created
      if (styleKey === '3d') {
        this.map.easeTo({ pitch: 60, bearing: -17.6, duration: 500 });
        this.enable3DBuildings();
      } else {
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
        this.disable3DBuildings();
      }
    };
    
    // Try multiple events that can indicate style is ready
    this.map.once('style.load', () => {
      handleStyleLoaded();
    });
    
    this.map.once('styledata', (e: any) => {
      if (e.dataType === 'style') {
        handleStyleLoaded();
      }
    });
    
    // Backup: check after a short delay if neither event fired
    setTimeout(() => {
      if (!handled && this.map.isStyleLoaded()) {
        handleStyleLoaded();
      }
    }, 1000);
  }

  private enable3DBuildings() {
    try {
      if (!this.map.getSource('openmaptiles')) return; // source must exist in the style
      if (this.map.getLayer('3d-buildings')) return;
      this.map.addLayer({
        id: '3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-extrusion-color': '#aaa',
          'fill-extrusion-height': ['case', ['!=', ['typeof', ['get', 'render_height']], 'number'], 10, ['max', ['get', 'render_height'], 0]],
          'fill-extrusion-base': ['case', ['!=', ['typeof', ['get', 'render_min_height']], 'number'], 0, ['max', ['get', 'render_min_height'], 0]],
          'fill-extrusion-opacity': 0.6,
        },
      });
    } catch {}
  }

  private disable3DBuildings() {
    try {
      if (this.map.getLayer('3d-buildings')) this.map.removeLayer('3d-buildings');
    } catch {}
  }

  private ensureVehicleLayer() {
    if (!this.map || !this.mapReady) return;
        
    // Remove existing source and layer if they exist (cleanup)
    if (this.map.getLayer(this.layerId)) {
      this.map.removeLayer(this.layerId);
    }
    if (this.map.getSource(this.sourceId)) {
      this.map.removeSource(this.sourceId);
    }
    
    const vehicleData = this.vehiclesToGeoJSON(this.vehicles());
    
    // Add source with current vehicle data
    this.map.addSource(this.sourceId, { 
      type: 'geojson', 
      data: vehicleData
    });
    
    // Add layer
    this.map.addLayer({
      id: this.layerId,
      type: 'circle',
      source: this.sourceId,
      paint: {
        'circle-radius': 5,
        'circle-stroke-width': 2,
        // Fill color logic: not in service = gray, in service = route color or green fallback
        'circle-color': [
          'case',
          // If trip_id is null/undefined/empty, vehicle is not in service -> gray
          ['any', 
            ['==', ['get', 'trip_id'], null],
            ['==', ['get', 'trip_id'], ''],
            ['!', ['has', 'trip_id']]
          ], '#6B7280', // Dark gray for not in service
          // If in service and has a valid route color (not null, not empty), use route color
          ['all',
            ['has', 'color'],
            ['!=', ['get', 'color'], null],
            ['!=', ['get', 'color'], '']
          ], ['get', 'color'],
          // All other in-service vehicles (no valid route color) -> green
          '#10B981'
        ],
        // All markers have solid black stroke
        'circle-stroke-color': '#000000',
      },
    });

    // Bind hover/click interactions for popup
    try {
      this.map.off('mouseenter', this.layerId, this.onMouseEnter);
      this.map.off('mousemove', this.layerId, this.onMouseMove);
      this.map.off('mouseleave', this.layerId, this.onMouseLeave);
      this.map.off('click', this.layerId, this.onLayerClick);
      this.map.off('click', this.onMapClick);
    } catch {}
    this.map.on('mouseenter', this.layerId, this.onMouseEnter);
    this.map.on('mousemove', this.layerId, this.onMouseMove);
    this.map.on('mouseleave', this.layerId, this.onMouseLeave);
    this.map.on('click', this.layerId, this.onLayerClick);
    this.map.on('click', this.onMapClick);
  }

  private poll() {
  this.api.vehicles().subscribe((vs: Vehicle[]) => {
      this.vehicles.set(vs);
      this.updateVehicleLayer();
    });
  }

  private updateVehicleLayer() {
    if (!this.map || !this.map.getSource || !this.mapReady) return;
    const src = this.map.getSource(this.sourceId);
    if (!src) {
      // Source doesn't exist, recreate the whole layer
      this.ensureVehicleLayer();
      return;
    }
    const fc = this.vehiclesToGeoJSON(this.vehicles());
    src.setData(fc);
    // If pinned, keep popup synced to the pinned vehicle
    if (this.pinned && this.pinnedId && this.popup) {
      const found = (fc.features as any[]).find(f => f.properties?.id === this.pinnedId);
      if (found) {
        const [x, y] = found.geometry.coordinates;
        this.popup.setLngLat({ lng: x, lat: y }).setHTML(this.popupHTML(found));
      }
    }
  }

  private vehiclesToGeoJSON(vs: Vehicle[]) {
    const result = {
      type: 'FeatureCollection',
      features: vs
        .filter(v => {
          // More robust filtering for valid coordinates
          const lat = Number(v.lat);
          const lon = Number(v.lon);
          return v.lat != null && 
                 v.lon != null && 
                 !isNaN(lat) && 
                 !isNaN(lon) && 
                 isFinite(lat) && 
                 isFinite(lon) &&
                 lat >= -90 && lat <= 90 &&
                 lon >= -180 && lon <= 180;
        })
        .map(v => {
          // Ensure all numeric values are properly sanitized
          const lat = Number(v.lat);
          const lon = Number(v.lon);
          const speed = v.speed != null && !isNaN(Number(v.speed)) ? Number(v.speed) : 0;
          const heading = v.heading != null && !isNaN(Number(v.heading)) ? Number(v.heading) : 0;
          const ts = v.ts != null && !isNaN(Number(v.ts)) ? Number(v.ts) : Math.floor(Date.now() / 1000);
          
          const tripId = (v as any).trip_id || undefined;
          const routeColor = this.colorForRoute(v.route_id);
          
          return {
            type: 'Feature',
            properties: { 
              id: String(v.id || 'unknown'), 
              route_id: String(v.route_id || 'unknown'), 
              ts: ts,
              color: routeColor,
              speed: speed,
              heading: heading,
              feed: (v as any).feed || undefined,
              label: (v as any).label || undefined,
              license_plate: (v as any).license_plate || undefined,
              trip_id: tripId,
              current_status: (v as any).current_status ?? undefined,
              stop_id: (v as any).stop_id || undefined,
              current_stop_sequence: (v as any).current_stop_sequence ?? undefined,
              occupancy_status: (v as any).occupancy_status ?? undefined,
              occupancy_percentage: (v as any).occupancy_percentage ?? undefined,
            },
            geometry: { type: 'Point', coordinates: [lon, lat] }
          };
        })
    };
    
    return result;
  }

  private loadRoutes() {
    this.api.routes().subscribe((rows: RouteRow[]) => {
      const map: { [key: string]: string } = {};
      this.routeMeta.clear();
      
      for (const r of rows) {
        const color = this.normalizeHex(r.color);
        const ids = [r.route_id, this.unprefixed(r.route_id)];
        
        for (const id of ids) if (id) {
          map[id] = color;
          this.routeMeta.set(id, r);
        }
      }
      // Convert object to Map
      this.routeColorMap.clear();
      for (const key in map) {
        this.routeColorMap.set(key, map[key]);
      }
      
      this.routes.set(rows);
      this.updateVehicleLayer();
    });
  }

  private normalizeHex(c?: string): string {
    if (!c) return '#1d4ed8';
    const hex = c.indexOf('#') === 0 ? c : `#${c}`;
    const normalized = /^#?[0-9a-fA-F]{6}$/.test(hex) ? hex.replace(/^#?/, '#').toUpperCase() : '#1d4ed8';
    
    // If route color is too close to gray (#6B7280), use #5D6555 instead
    if (normalized === '#808285' || normalized === '#9CA3AF' || normalized === '#808080') {
      return '#5D6555';
    }
    
    return normalized;
  }

  private unprefixed(id?: string): string {
    if (!id) return '';
    const i = id.indexOf(':');
    return i >= 0 ? id.slice(i+1) : id;
  }

  private colorForRoute(routeId?: string): string | null {
    const raw = routeId || '';
    const found = this.routeColorMap.get(raw) || this.routeColorMap.get(this.unprefixed(raw));
    if (found) return found;
    
    // Return null for unknown routes - let MapLibre expression handle the fallback
    if (raw === '' || raw === 'UNKNOWN') return null;
    
    // Generate color for other routes that aren't explicitly unknown
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return this.palette[h % this.palette.length];
  }

  // ----- Route streets overlay -----
  selectRoute(routeId: string) {
    this.currentRouteId = routeId;
    if (!this.map) return;

    // Remove any existing sources/layers for route overlay
    try {
      if (this.map.getLayer('route-streets-vt-layer')) this.map.removeLayer('route-streets-vt-layer');
    } catch {}
    try {
      if (this.map.getSource('route-streets-vt-src')) this.map.removeSource('route-streets-vt-src');
    } catch {}
    try {
      if (this.map.getLayer('route-streets-layer')) this.map.removeLayer('route-streets-layer');
    } catch {}
    try {
      if (this.map.getSource('route-streets-src')) this.map.removeSource('route-streets-src');
    } catch {}

    // Add vector tile source and layer (fast rendering for long routes)
    try {
      this.map.addSource('route-streets-vt-src', {
        type: 'vector',
        tiles: [`${(globalThis as any)['API_BASE'] || (window as any)['API_BASE'] || ''}/routes/${routeId}/streets.mvt/{z}/{x}/{y}`],
        minzoom: 6,
        maxzoom: 20
      } as any);
      this.map.addLayer({
        id: 'route-streets-vt-layer',
        type: 'line',
        source: 'route-streets-vt-src',
        'source-layer': 'streets',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': this.colorForRoute(routeId),
          'line-width': 4,
          'line-opacity': 0.9,
          'line-blur': 0.2,
        }
      });
    } catch {}

    // Fit bounds quickly using bbox endpoint (very small response)
    this.api.routeStreetsBbox(routeId).subscribe(bbox => {
      try {
        if (bbox) this.map.fitBounds(bbox as any, { padding: 40, duration: 500 });
      } catch {}
    });

    // Fallback: if vector tiles fail for some reason, load GeoJSON
    setTimeout(() => {
      try {
        if (!this.map.getSource('route-streets-vt-src')) {
          this.api.routeStreets(routeId).subscribe(fc => {
            if (!this.map) return;
            const srcId = 'route-streets-src';
            const layerId = 'route-streets-layer';
            if (!this.map.getSource(srcId)) {
              this.map.addSource(srcId, { type: 'geojson', data: fc });
            } else {
              (this.map.getSource(srcId) as any).setData(fc);
            }
            if (!this.map.getLayer(layerId)) {
              this.map.addLayer({
                id: layerId,
                type: 'line',
                source: srcId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                  'line-color': this.colorForRoute(routeId),
                  'line-width': 4,
                  'line-opacity': 0.9,
                  'line-blur': 0.2
                }
              });
            } else {
              this.map.setPaintProperty(layerId, 'line-color', this.colorForRoute(routeId));
            }
            // Fit bounds if bbox wasn't available
            try {
              const bbox = this.computeBbox(fc);
              if (bbox) this.map.fitBounds(bbox as any, { padding: 40, duration: 500 });
            } catch {}
          });
        }
      } catch {}
    }, 0);
  }

  private ensureRouteLayer() {
    if (!this.map || !this.currentRouteId) return;
    // re-select to re-add source/layer after style change
    this.selectRoute(this.currentRouteId);
  }

  private computeBbox(fc: any): [number, number, number, number] | null {
    if (!fc || !fc.features || !fc.features.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of fc.features) {
      const geom = f.geometry;
      if (!geom) continue;
      const coords = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
      for (const line of coords) {
        for (const [x,y] of line) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX === Infinity) return null;
    return [minX, minY, maxX, maxY];
  }

  // ----- Popup + formatting helpers -----
  toggleUnit(next?: 'mph' | 'kmh') {
    this.unit = next || (this.unit === 'mph' ? 'kmh' : 'mph');
    try { (globalThis as any).localStorage?.setItem('unit', this.unit); } catch {}
    // Refresh popup to reflect units
    if (this.pinned && this.popup && this.pinnedId) {
      const vs = this.vehicles();
      const v = vs.find(x => x.id === this.pinnedId);
      if (v) {
        this.popup.setHTML(this.popupHTML({ properties: { ...v, color: this.colorForRoute(v.route_id) } } as any));
      }
    }
  }

  private routeDisplay(routeId: string): string {
    const r = this.routeMeta.get(routeId) || this.routeMeta.get(this.unprefixed(routeId));
    if (!r) return routeId || 'UNKNOWN';
    const sn = r.short_name || '';
    const ln = r.long_name || '';
    if (sn && ln) return `${sn} - ${ln}`;
    return sn || ln || routeId;
  }

  private formatSpeed(mps: number | undefined | null): string {
    if (!mps || !isFinite(mps) || mps <= 0) return '—';
    const mph = mps * 2.236936;
    const kmh = mps * 3.6;
    const val = this.unit === 'mph' ? mph : kmh;
    return `${Math.round(val)} ${this.unit}`;
  }

  private formatHeading(deg: number | undefined | null): string {
    if (deg == null || !isFinite(deg)) return '—';
    let d = ((deg % 360) + 360) % 360;
    const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
    const idx = Math.round(d / 45);
    return `${Math.round(d)}° (${dirs[idx]})`;
  }

  private timeAgo(tsSec: number): string {
    const s = Math.max(0, Math.floor(Date.now()/1000 - tsSec));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    return `${h}h ago`;
  }

  private occupancyLabel(n: number | undefined | null): string | null {
    if (n == null) return null;
    const map: Record<number, string> = {
      0: 'Empty',
      1: 'Many seats',
      2: 'Few seats',
      3: 'Standing room',
      4: 'Crushed',
      5: 'Full',
      6: 'Not accepting',
    };
    return map[n] || null;
  }

  private statusLabel(n: number | undefined | null): string | null {
    if (n == null) return null;
    const map: Record<number, string> = {
      0: 'Incoming',
      1: 'Stopped',
      2: 'In transit',
    };
    return map[n] || null;
  }

  private popupHTML(f: any): string {
    const p = f?.properties || {};
    const rid = p.route_id || 'UNKNOWN';
    const inService = !!p.trip_id;
    const title = inService ? this.routeDisplay(rid) : 'Not in Service';
    const updated = this.timeAgo(Number(p.ts || 0));
    const speed = this.formatSpeed(Number(p.speed));
    const heading = this.formatHeading(Number(p.heading));
    const veh = p.label || p.license_plate || p.id || 'Vehicle';
    const feed = p.feed ? `<div><span style="opacity:.7">Feed:</span> ${this.escape(p.feed)}</div>` : '';
    const move = this.statusLabel(p.current_status);
    const moveHtml = move ? `<div><span style="opacity:.7">Movement:</span> ${move}</div>` : '';
    const serviceHtml = `<div><span style="opacity:.7">Service:</span> ${inService ? 'In Service' : 'Not in Service'}</div>`;
    const occ = this.occupancyLabel(p.occupancy_status);
    const occPct = (p.occupancy_percentage != null && isFinite(Number(p.occupancy_percentage))) ? ` (${Math.round(Number(p.occupancy_percentage))}%)` : '';
    const occHtml = occ ? `<div><span style="opacity:.7">Occupancy:</span> ${occ}${occPct}</div>` : '';

    // Use same color logic as markers
    let markerColor = '#6B7280'; // Dark gray for not in service
    if (inService) {
      // In service: use route color if available, otherwise green
      markerColor = p.color || '#10B981';
    }

    return `
      <div style="min-width:220px; font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${markerColor};"></span>
          <div style="font-weight:600;">${this.escape(title)}</div>
        </div>
        <div style="margin:4px 0 8px; color:#374151;">
          <div><span style="opacity:.7">Vehicle:</span> ${this.escape(veh)}</div>
          <div><span style="opacity:.7">Updated:</span> ${updated}</div>
          <div><span style="opacity:.7">Speed:</span> ${speed}</div>
          <div><span style="opacity:.7">Heading:</span> ${heading}</div>
          ${feed}
          ${serviceHtml}
          ${moveHtml}
          ${occHtml}
        </div>
        <div style="margin-top:8px; display:flex; gap:6px; align-items:center;">
          <button data-unit="mph" style="padding:2px 6px; border-radius:4px; border:1px solid #d1d5db; background:${this.unit==='mph'?'#eef2ff':'#fff'}; cursor:pointer;">mph</button>
          <button data-unit="kmh" style="padding:2px 6px; border-radius:4px; border:1px solid #d1d5db; background:${this.unit==='kmh'?'#eef2ff':'#fff'}; cursor:pointer;">km/h</button>
          <span style="margin-left:auto; opacity:.6; font-size:12px;">Click to ${this.pinned ? 'unpin map' : 'pin'}</span>
        </div>
      </div>`;
  }

  private showVehiclePopup(f: any, lngLat: any) {
    if (!this.popup) {
      this.popup = new maplibregl.Popup({ closeButton: true, closeOnMove: false, closeOnClick: false, offset: 12 });
      try {
        this.popup.on('close', () => {
          this.pinned = false;
          this.pinnedId = null;
          this.popup = null;
        });
      } catch {}
    }
    this.popup.setLngLat(lngLat).setHTML(this.popupHTML(f)).addTo(this.map);
    // attach unit toggle listeners within popup
    setTimeout(() => {
      const el = this.popup?.getElement();
      if (!el) return;
      const mphBtn = el.querySelector('button[data-unit="mph"]');
      const kmhBtn = el.querySelector('button[data-unit="kmh"]');
      mphBtn?.addEventListener('click', () => this.toggleUnit('mph'));
      kmhBtn?.addEventListener('click', () => this.toggleUnit('kmh'));
    }, 0);
  }

  private updateVehiclePopup(f: any, lngLat: any) {
    if (!this.popup) return this.showVehiclePopup(f, lngLat);
    this.popup.setLngLat(lngLat).setHTML(this.popupHTML(f));
  }

  private removePopup() {
    try { this.popup?.remove(); } catch {}
    this.popup = null;
  }

  private escape(s: any): string {
    const t = String(s ?? '');
    return t.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'} as any)[c] || c);
  }
}
