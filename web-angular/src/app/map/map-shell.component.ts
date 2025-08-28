import { Component, inject, signal } from '@angular/core';
import { ApiService, Vehicle, RouteRow } from '../core/api.service';
import maplibregl from 'maplibre-gl';

@Component({
  selector: 'app-map-shell',
  standalone: true,
  templateUrl: './map-shell.component.html',
  styleUrls: ['./map-shell.component.scss'],
})
export class MapShellComponent {
  private api = inject(ApiService);
  vehicles = signal<Vehicle[]>([]);
  map?: any;
  sourceId = 'vehicles-src';
  layerId = 'vehicles-layer';
  currentStyle = 'liberty';
  // Route-colored markers
  private routeColorMap = new Map<string, string>();
  private palette = ['#2563EB','#F59E0B','#10B981','#EF4444','#8B5CF6','#06B6D4','#84CC16','#D946EF','#F97316','#22D3EE'];

  styles: Record<string, string> = {
    liberty: 'https://tiles.openfreemap.org/styles/liberty',
    bright: 'https://tiles.openfreemap.org/styles/bright',
    positron: 'https://tiles.openfreemap.org/styles/positron',
    // 3D uses liberty + extrusions; we use liberty URL
    '3d': 'https://tiles.openfreemap.org/styles/liberty',
  };

  constructor() {
    // Initial poll
    this.poll();
    // Poll every 5s
    setInterval(() => this.poll(), 5000);
    // Load route colors
    this.loadRoutes();
  }

  ngAfterViewInit() {
    const styleOverride = (window as any)['MAP_STYLE_URL'] as string | undefined;
    if (styleOverride) {
      this.currentStyle = 'custom';
      this.styles['custom'] = styleOverride;
    }

    this.map = new maplibregl.Map({
      container: 'map',
      style: this.styles[this.currentStyle],
      center: [-76.6122, 39.2904],
      zoom: 12,
      pitch: 0,
      bearing: 0,
    });

    // Basic map UI controls
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }));

    // Ensure vehicles layer exists on initial load and whenever the style changes
    this.map.on('load', () => this.ensureVehicleLayer());
    this.map.on('style.load', () => this.ensureVehicleLayer());
  }

  setBase(styleKey: 'liberty' | 'bright' | 'positron' | '3d') {
    this.currentStyle = styleKey;
    const url = this.styles[styleKey];
    if (!this.map || !url) return;
    this.map.setStyle(url);
    // 3D settings
    if (styleKey === '3d') {
      this.map.once('style.load', () => {
        this.map.easeTo({ pitch: 60, bearing: -17.6, duration: 500 });
        this.enable3DBuildings();
      });
    } else {
      this.map.once('style.load', () => {
        this.map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
        this.disable3DBuildings();
      });
    }
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
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
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
    if (!this.map) return;
    
    console.log('Ensuring vehicle layer...');
    
    // Remove existing source and layer if they exist (cleanup)
    if (this.map.getLayer(this.layerId)) {
      console.log('Removing existing vehicle layer');
      this.map.removeLayer(this.layerId);
    }
    if (this.map.getSource(this.sourceId)) {
      console.log('Removing existing vehicle source');
      this.map.removeSource(this.sourceId);
    }
    
    const vehicleData = this.vehiclesToGeoJSON(this.vehicles());
    console.log(`Adding vehicle source with ${vehicleData.features.length} vehicles`);
    
    // Add source with current vehicle data
    this.map.addSource(this.sourceId, { 
      type: 'geojson', 
      data: vehicleData
    });
    
    console.log('Adding vehicle layer');
    // Add layer
    this.map.addLayer({
      id: this.layerId,
      type: 'circle',
      source: this.sourceId,
      paint: {
        'circle-radius': 5,
        'circle-stroke-width': 1,
        'circle-color': ['get','color'],
        'circle-stroke-color': '#ffffff',
      },
    });
  }

  private poll() {
  this.api.vehicles().subscribe((vs: Vehicle[]) => {
      console.log(`Polled ${vs.length} vehicles`);
      this.vehicles.set(vs);
      this.updateVehicleLayer();
    });
  }

  private updateVehicleLayer() {
    if (!this.map || !this.map.getSource) return;
    const src = this.map.getSource(this.sourceId);
    if (!src) {
      // Source doesn't exist, recreate the whole layer
      console.log('Vehicle source missing during update, ensuring layer...');
      this.ensureVehicleLayer();
      return;
    }
    console.log(`Updating vehicle source with ${this.vehicles().length} vehicles`);
    src.setData(this.vehiclesToGeoJSON(this.vehicles()));
  }

  private vehiclesToGeoJSON(vs: Vehicle[]) {
    return {
      type: 'FeatureCollection',
      features: vs.map(v => ({
        type: 'Feature',
        properties: { id: v.id, route_id: v.route_id, ts: v.ts, color: this.colorForRoute(v.route_id) },
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] }
      }))
    };
  }

  private loadRoutes() {
    this.api.routes().subscribe((rows: RouteRow[]) => {
      const map = new Map<string,string>();
      for (const r of rows) {
        const color = this.normalizeHex(r.color);
        const ids = [r.route_id, this.unprefixed(r.route_id)];
        for (const id of ids) if (id) map.set(id, color);
      }
      this.routeColorMap = map;
      this.updateVehicleLayer();
    });
  }

  private normalizeHex(c?: string): string {
    if (!c) return '#1d4ed8';
    const hex = c.startsWith('#') ? c : `#${c}`;
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
}
