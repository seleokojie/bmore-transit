import { Routes } from '@angular/router';
import { MapShellComponent } from './map/map-shell.component';

export const routes: Routes = [
  { path: '', component: MapShellComponent },
  { path: '**', redirectTo: '' }
];
