import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { CatalogEstablishment } from '../../core/models/domain';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'gg-discovery',
  imports: [RouterLink, FormsModule, Icon],
  templateUrl: './discovery.html',
})
export class Discovery {
  readonly auth = inject(AuthService);
  private readonly catalog = inject(CatalogService);
  readonly isCatalog = inject(ActivatedRoute).snapshot.data['view'] === 'catalog';
  readonly search = signal('');
  readonly establishments = signal<CatalogEstablishment[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly filtered = computed(() => {
    const text = this.search().trim().toLocaleLowerCase('es-PE');
    return this.establishments().filter((item) =>
      `${item.name} ${item.location}`.toLocaleLowerCase('es-PE').includes(text),
    );
  });

  constructor() {
    if (this.isCatalog) void this.load();
  }

  async load(): Promise<void> {
    await this.auth.ready;
    if (!this.auth.user()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      this.establishments.set(await this.catalog.published());
    } catch {
      this.error.set('No pudimos cargar los establecimientos publicados. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }
}
