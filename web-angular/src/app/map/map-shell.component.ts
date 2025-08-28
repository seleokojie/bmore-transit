import { Component, inject, signal } from '@angular/core';
import { ApiService, Vehicle } from '../core/api.service';

declare const mapboxgl: any;

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
    const token = (window as any)['MAPBOX_ACCESS_TOKEN'] || '';
    if (!token) console.warn('MAPBOX_ACCESS_TOKEN missing; the map may not render.');
    (mapboxgl as any).accessToken = token;

    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'https://demotiles.maplibre.org/style.json', // works without token; swap to mapbox style if you set token
      center: [-76.6122, 39.2904],
      zoom: 12
    });

    this.map.on('load', () => {
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
