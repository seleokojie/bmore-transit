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

  constructor() {
    // Initial poll
    this.poll();
    // Poll every 5s
    setInterval(() => this.poll(), 5000);
  }

  ngAfterViewInit() {
    const styleUrl = (window as any)['MAP_STYLE_URL'] || 'https://tiles.openfreemap.org/styles/liberty';
    this.map = new maplibregl.Map({
      container: 'map',
      style: styleUrl, // runtime configurable basemap style
      center: [-76.6122, 39.2904],
      zoom: 12,
      pitch: 45,
      bearing: -17.6
    });

    this.map.on('load', () => {
      // Basic map UI controls
      this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
      this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }));
      this.map.addSource(this.sourceId, { type: 'geojson', data: this.vehiclesToGeoJSON([]) });
      this.map.addLayer({
        id: this.layerId,
        type: 'circle',
        source: this.sourceId,
        paint: { 'circle-radius': 5, 'circle-stroke-width': 1 }
      });
      // push first data if present
      this.updateVehicleLayer();
    });
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
