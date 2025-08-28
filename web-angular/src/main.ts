import { bootstrapApplication } from '@angular/platform-browser';
import { MapShellComponent } from './app/map/map-shell.component';
import { appConfig } from './app/app.config';

(window as any)['API_BASE'] = (window as any)['API_BASE'] || (document.querySelector('base')?.getAttribute('href')?.includes('localhost') ? 'http://localhost:8080' : '');
bootstrapApplication(MapShellComponent, appConfig).catch((err: unknown) => console.error(err));
