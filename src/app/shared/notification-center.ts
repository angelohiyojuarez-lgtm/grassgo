import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { NotificationService } from '../core/services/notification.service';

@Component({
  selector: 'gg-notification-center',
  imports: [RouterLink],
  templateUrl: './notification-center.html',
  styleUrl: './notification-center.css',
})
export class NotificationCenter {
  readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  readonly open = signal(false);
  notificationLink(href: string): UrlTree {
    return this.router.parseUrl(href);
  }
  toggle(): void {
    this.open.update((value) => !value);
    if (this.open()) this.notifications.markAllRead();
  }
}
