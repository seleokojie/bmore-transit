import { Component, inject, signal } from '@angular/core';
import { ApiService, Vehicle } from '../core/api.service';
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
    const ensure = () => this.ensureVehicleLayer();
    this.map.on('load', ensure);
    this.map.on('style.load', ensure);
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
    if (!this.map.getSource(this.sourceId)) {
      this.map.addSource(this.sourceId, { type: 'geojson', data: this.vehiclesToGeoJSON(this.vehicles()) });
    }
    if (!this.map.getLayer(this.layerId)) {
      this.map.addLayer({
        id: this.layerId,
        type: 'circle',
        source: this.sourceId,
        paint: {
          'circle-radius': 5,
          'circle-stroke-width': 1,
          'circle-color': '#1d4ed8',
          'circle-stroke-color': '#ffffff',
        },
      });
    }
    this.updateVehicleLayer();
  }

  private poll() {
  this.api.vehicles().subscribe((vs: Vehicle[]) => {
      this.vehicles.set(vs);
      this.updateVehicleLayer();
    });
  }

  private updateVehicleLayer() {
    if (!this.map || !this.map.getSource) return;
    const src = this.map.getSource(this.sourceId);
    if (!src) return;
    src.setData(this.vehiclesToGeoJSON(this.vehicles()));
  }

  private vehiclesToGeoJSON(vs: Vehicle[]) {
    return {
      type: 'FeatureCollection',
      features: vs.map(v => ({
        type: 'Feature',
        properties: { id: v.id, route_id: v.route_id, ts: v.ts },
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] }
      }))
    };
  }
}
