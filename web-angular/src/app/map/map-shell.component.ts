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
  private palette = ['#2563EB','#F59E0B','#10B981','#EF4444','#8B5CF6','#06B6D4','#84CC16','#D946EF','#F97316','#22D3EE'];
  routes = signal<RouteRow[]>([]);
  currentRouteId: string | null = null;

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
        'circle-stroke-width': 1,
        'circle-color': ['coalesce', ['get','color'], '#1d4ed8'],
        'circle-stroke-color': '#ffffff',
      },
    });
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
    src.setData(this.vehiclesToGeoJSON(this.vehicles()));
  }

  private vehiclesToGeoJSON(vs: Vehicle[]) {
    return {
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
          
          return {
            type: 'Feature',
            properties: { 
              id: String(v.id || 'unknown'), 
              route_id: String(v.route_id || 'unknown'), 
              ts: ts,
              color: this.colorForRoute(v.route_id),
              speed: speed,
              heading: heading
            },
            geometry: { type: 'Point', coordinates: [lon, lat] }
          };
        })
    };
  }

  private loadRoutes() {
    this.api.routes().subscribe((rows: RouteRow[]) => {
      const map: { [key: string]: string } = {};
      for (const r of rows) {
        const color = this.normalizeHex(r.color);
        const ids = [r.route_id, this.unprefixed(r.route_id)];
        for (const id of ids) if (id) map[id] = color;
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
    return /^#?[0-9a-fA-F]{6}$/.test(hex) ? hex.replace(/^#?/, '#').toUpperCase() : '#1d4ed8';
  }

  private unprefixed(id?: string): string {
    if (!id) return '';
    const i = id.indexOf(':');
    return i >= 0 ? id.slice(i+1) : id;
  }

  private colorForRoute(routeId?: string): string {
    const raw = routeId || '';
    const found = this.routeColorMap.get(raw) || this.routeColorMap.get(this.unprefixed(raw));
    if (found) return found;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return this.palette[h % this.palette.length];
  }

  // ----- Route streets overlay -----
  selectRoute(routeId: string) {
    this.currentRouteId = routeId;
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
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
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
      // Fit bounds to the route
      try {
        const bbox = this.computeBbox(fc);
        if (bbox) this.map.fitBounds(bbox as any, { padding: 40, duration: 500 });
      } catch {}
    });
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
}
