import { Component, input } from '@angular/core';
@Component({
  selector: 'gg-icon',
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="paths[name()] || paths['arrow']" />
  </svg>`,
  styles: [
    ':host{display:inline-flex;width:1.3em;height:1.3em;flex-shrink:0}svg{width:100%;height:100%}',
  ],
})
export class Icon {
  readonly name = input('arrow');
  readonly paths: Record<string, string> = {
    building: 'M4 21V5h10v16M14 10h6v11M2 21h20M7 8h4M7 12h4M7 16h4M17 13v2m0 3v2',
    plus: 'M12 5v14M5 12h14',
    grid: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',
    activity: 'M3 12h4l3-8 4 16 3-8h4',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
    home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    field: 'M3 4h18v16H3ZM12 4v16M3 9h4v6H3m18-6h-4v6h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    calendar: 'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 11h18M7 15h2m6 0h2',
    user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
    shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6ZM8 12l3 3 5-6',
    clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
    chevron: 'm9 5 7 7-7 7',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    check: 'm5 12 4 4L19 6',
    logout: 'M9 3H3v18h6m6-15 6 6-6 6m-7-6h13',
    mail: 'M3 5h18v14H3Zm0 0 9 8 9-8',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    back: 'M19 12H5m6-6-6 6 6 6',
  };
}
