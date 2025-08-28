import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_BASE = (globalThis as any)['API_BASE'] || (typeof window !== 'undefined' ? (window as any)['API_BASE'] : '') || '';

export interface RouteRow { route_id:string; short_name:string; long_name:string; color:string; text_color:string; type:number; }
export interface Vehicle { id:string; route_id:string; lat:number; lon:number; speed?:number; heading?:number; ts:number; }

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  routes(): Observable<RouteRow[]> {
    return this.http.get<RouteRow[]>(`${API_BASE}/routes`);
  }

  vehicles(): Observable<Vehicle[]> {
    return this.http.get<Vehicle[]>(`${API_BASE}/vehicles`);
  }

  routeShape(routeId: string) {
    return this.http.get<any>(`${API_BASE}/routes/${routeId}/shape`);
  }

  routeStreets(routeId: string) {
    return this.http.get<any>(`${API_BASE}/routes/${routeId}/streets`);
  }
}
