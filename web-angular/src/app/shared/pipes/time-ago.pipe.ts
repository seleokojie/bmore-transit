import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'timeAgo', standalone: true })
export class TimeAgoPipe implements PipeTransform {
  transform(value: number | Date | null): string {
    if (!value) return '';
    const ts = typeof value === 'number' ? value*1000 : new Date(value).getTime();
    const diff = Date.now() - ts;
    const s = Math.floor(diff/1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    return `${h}h ago`;
  }
}
