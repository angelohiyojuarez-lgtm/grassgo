import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BookingService } from '../../core/services/booking.service';
import { BusinessMediaService } from '../../core/services/business-media.service';
import {
  BusinessConfiguration,
  BusinessConfigurationResponse,
  emptyConfiguration,
  emptyCourt,
  ConfiguredCourt,
} from '../../core/models/business-configuration';
import { environment } from '../../environments/environment';
import { Icon } from '../../shared/icon';
interface ImageChoice {
  path: string;
  file?: File;
  url: string;
}
@Component({
  selector: 'gg-business-editor',
  imports: [FormsModule, RouterLink, Icon],
  templateUrl: './business-editor.html',
})
export class BusinessEditor implements OnInit, OnDestroy {
  private readonly backend = inject(BookingService);
  private readonly media = inject(BusinessMediaService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly demo = environment.useEmulators;
  readonly step = signal(1);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly status = signal('draft');
  readonly revision = signal(0);
  readonly businessId = signal(this.route.snapshot.paramMap.get('establishmentId') || '');
  readonly saved = signal(false);
  readonly progress = signal('');
  readonly publishConfirm = signal(false);
  readonly steps = [
    { id: 1, title: 'Negocio', icon: 'building' },
    { id: 2, title: 'Horarios', icon: 'clock' },
    { id: 3, title: 'Canchas', icon: 'field' },
    { id: 4, title: 'Pagos', icon: 'shield' },
    { id: 5, title: 'Revisión', icon: 'check' },
  ];
  readonly districts = ['Andahuaylas', 'San Jerónimo', 'Talavera'];
  readonly weekdays = [
    { id: 1, name: 'Lunes' },
    { id: 2, name: 'Martes' },
    { id: 3, name: 'Miércoles' },
    { id: 4, name: 'Jueves' },
    { id: 5, name: 'Viernes' },
    { id: 6, name: 'Sábado' },
    { id: 0, name: 'Domingo' },
  ];
  readonly hours = Array.from({ length: 25 }, (_, i) => i);
  config = emptyConfiguration();
  courtCount = 1;
  private readonly choices = new Map<string, ImageChoice[]>();
  private businessPhotos: ImageChoice[] = [];
  private qrChoice: ImageChoice | null = null;
  private readonly requestId = crypto.randomUUID();
  private alive = true;
  private changeCounter = 0;
  changed(): void {
    this.saved.set(false);
    this.publishConfirm.set(false);
    this.changeCounter++;
  }
  async ngOnInit(): Promise<void> {
    const initialStep = Number(this.route.snapshot.queryParamMap.get('paso'));
    if (Number.isInteger(initialStep) && initialStep >= 1 && initialStep <= 5)
      this.step.set(initialStep);
    if (!this.businessId()) return;
    this.loading.set(true);
    try {
      const result = await this.backend.call<BusinessConfigurationResponse>(
        'getBusinessConfiguration',
        { establishmentId: this.businessId() },
      );
      this.status.set(result.status);
      this.revision.set(result.revision);
      if (result.configuration) this.config = { ...emptyConfiguration(), ...result.configuration };
      else {
        this.config.name = result.name;
        this.config.address = result.location;
        if (result.legacyCourts?.length) this.config.courts = result.legacyCourts;
      }
      this.courtCount = this.config.courts.length;
      for (const path of this.config.images) {
        const url = await this.media.read(path);
        if (!this.alive) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        this.businessPhotos.push({ path, url });
      }
      for (const court of this.config.courts) {
        const images: ImageChoice[] = [];
        for (const path of court.images) {
          const url = await this.media.read(path);
          if (!this.alive) {
            if (url.startsWith('blob:')) URL.revokeObjectURL(url);
            return;
          }
          images.push({ path, url });
        }
        this.choices.set(court.id, images);
      }
      if (this.config.payment.qr) {
        const url = await this.media.read(this.config.payment.qr);
        if (this.alive) this.qrChoice = { path: this.config.payment.qr, url };
        else if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      this.saved.set(!!result.configuration);
      if (result.configuration && this.route.snapshot.queryParamMap.get('guardado') === '1')
        this.message.set('Borrador guardado. Puedes seguir completando sus datos.');
    } catch (error) {
      this.loadFailed.set(true);
      this.error.set(
        this.errorMessage(
          error,
          'No pudimos cargar la configuración. Recarga la página para intentarlo de nuevo.',
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }
  hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }
  toggleDay(day: number): void {
    this.config.days = this.config.days.includes(day)
      ? this.config.days.filter((item) => item !== day)
      : [...this.config.days, day];
    this.changed();
  }
  toggleMethod(method: string): void {
    this.config.payment.methods = this.config.payment.methods.includes(method)
      ? this.config.payment.methods.filter((item) => item !== method)
      : [...this.config.payment.methods, method];
    this.changed();
  }
  resizeCourts(): void {
    const count = Number(this.courtCount);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      this.error.set('Indica entre 1 y 20 canchas.');
      return;
    }
    while (this.config.courts.length < count)
      this.config.courts.push(emptyCourt(this.config.courts.length + 1));
    while (this.config.courts.length > count) {
      const removed = this.config.courts.pop()!;
      for (const image of this.choices.get(removed.id) || []) this.revoke(image);
      this.choices.delete(removed.id);
    }
    this.error.set('');
    this.changed();
  }
  cents(value: unknown): number | null {
    return value === null || value === '' ? null : Math.round(Number(value) * 100);
  }
  images(court: ConfiguredCourt): ImageChoice[] {
    return this.choices.get(court.id) || [];
  }
  qr(): ImageChoice | null {
    return this.qrChoice;
  }
  establishmentImages(): ImageChoice[] {
    return this.businessPhotos;
  }
  chooseBusinessImages(event: Event): void {
    const input = event.target as HTMLInputElement,
      files = Array.from(input.files || []);
    this.error.set('');
    if (
      files.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          !file.size ||
          file.size > 5 * 1024 * 1024,
      )
    ) {
      this.error.set('Usa imágenes JPG, PNG o WebP de hasta 5 MB.');
      input.value = '';
      return;
    }
    if (files.length + this.businessPhotos.length > 5) {
      this.error.set('Puedes agregar hasta 5 fotos del establecimiento, incluida su portada.');
      input.value = '';
      return;
    }
    if (!files.length) return;
    this.businessPhotos.push(
      ...files.map((file) => ({
        path: `business-media/PENDING/${crypto.randomUUID()}`,
        file,
        url: URL.createObjectURL(file),
      })),
    );
    input.value = '';
    this.changed();
  }
  removeBusinessImage(index: number): void {
    const image = this.businessPhotos[index];
    if (!image) return;
    this.revoke(image);
    this.businessPhotos.splice(index, 1);
    this.changed();
  }
  makeBusinessCover(index: number): void {
    const image = this.businessPhotos[index];
    if (!image || index === 0) return;
    this.businessPhotos.splice(index, 1);
    this.businessPhotos.unshift(image);
    this.changed();
  }
  sports(): string {
    return [...new Set(this.config.courts.map((court) => court.sport).filter(Boolean))].join(' · ');
  }
  attentionDays(): string {
    return this.weekdays
      .filter((day) => this.config.days.includes(day.id))
      .map((day) => day.name)
      .join(', ');
  }
  chooseImages(event: Event, court?: ConfiguredCourt): void {
    const input = event.target as HTMLInputElement,
      files = Array.from(input.files || []);
    this.error.set('');
    if (
      files.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          !file.size ||
          file.size > 5 * 1024 * 1024,
      )
    ) {
      this.error.set('Usa imágenes JPG, PNG o WebP de hasta 5 MB.');
      input.value = '';
      return;
    }
    const previous = court ? this.images(court) : [];
    if (court && files.length + previous.length > 3) {
      this.error.set('Puedes agregar hasta 3 fotografías por cancha.');
      input.value = '';
      return;
    }
    const choices = files.map((file) => ({
      path: `business-media/PENDING/${crypto.randomUUID()}`,
      file,
      url: URL.createObjectURL(file),
    }));
    if (court) this.choices.set(court.id, [...previous, ...choices]);
    else if (choices.length) {
      if (this.qrChoice) this.revoke(this.qrChoice);
      this.qrChoice = choices[0];
    }
    input.value = '';
    this.changed();
  }
  removeImage(court: ConfiguredCourt, index: number): void {
    const images = [...this.images(court)];
    this.revoke(images[index]);
    images.splice(index, 1);
    this.choices.set(court.id, images);
    this.changed();
  }
  missing(): string[] {
    const c = this.config,
      result: string[] = [];
    if (c.name.trim().length < 2) result.push('Nombre del negocio.');
    if (!this.businessPhotos.length) result.push('Foto de portada del establecimiento.');
    if (!c.district || c.address.trim().length < 2) result.push('Distrito y dirección exacta.');
    if (!c.days.length || c.openHour === null || c.closeHour === null || c.closeHour <= c.openHour)
      result.push('Días y horario de atención válido.');
    for (const [i, court] of c.courts.entries())
      if (
        !court.name.trim() ||
        !court.sport ||
        !court.surface ||
        court.dayPriceCents === null ||
        court.dayPriceCents < 1000 ||
        court.nightPriceCents === null ||
        court.nightPriceCents < 1000 ||
        court.nightStartsAt === null ||
        !this.images(court).length
      )
        result.push(`Cancha ${i + 1}: nombre, tipo, superficie, tarifas (mínimo S/ 10) y foto.`);
    if (!c.courts.length) result.push('Al menos una cancha.');
    if (Number(this.courtCount) !== c.courts.length)
      result.push('Actualiza las fichas para aplicar el número de canchas.');
    if (c.holdMinutes === null || c.holdMinutes < 1)
      result.push('Plazo para enviar el comprobante.');
    if (!c.adminEmail.trim()) result.push('Correo del administrador responsable.');
    if (!c.payment.methods.length) result.push('Método de pago Yape o Plin.');
    if (
      c.payment.mode === 'live' &&
      (!c.payment.recipient.trim() || !c.payment.phone.trim() || !this.qrChoice)
    )
      result.push('Titular, número y código QR de pago.');
    if (c.payment.mode === 'demo' && !this.demo) result.push('Datos reales de pago.');
    return result;
  }
  private errorMessage(error: unknown, fallback: string): string {
    const code = (error as { code?: string })?.code || '';
    return [
      'functions/invalid-argument',
      'functions/failed-precondition',
      'functions/aborted',
      'functions/permission-denied',
      'functions/not-found',
    ].includes(code)
      ? (error as { message: string }).message
      : fallback;
  }
  async save(): Promise<void> {
    if (this.busy() || this.loading() || this.loadFailed() || this.status() === 'published') return;
    if (this.config.name.trim().length < 2) {
      this.step.set(1);
      this.error.set('Escribe el nombre del negocio para guardar el borrador.');
      return;
    }
    if (
      !Number.isInteger(Number(this.courtCount)) ||
      Number(this.courtCount) !== this.config.courts.length
    ) {
      this.step.set(3);
      this.error.set('Actualiza las fichas para aplicar el número de canchas antes de guardar.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    const changeCounter = this.changeCounter;
    try {
      if (!this.businessId()) {
        this.progress.set('Preparando el registro…');
        const result = await this.backend.call<{ id: string }>('createEstablishment', {
          requestId: this.requestId,
          name: this.config.name.trim(),
          location:
            [this.config.address, this.config.district].filter(Boolean).join(', ') ||
            'Ubicación pendiente',
          description: this.config.description,
        });
        this.businessId.set(result.id);
      }
      for (const image of this.businessPhotos) await this.upload(image);
      this.config.images = this.businessPhotos.map((image) => image.path);
      for (const court of this.config.courts) {
        for (const image of this.images(court)) await this.upload(image);
        court.images = this.images(court).map((image) => image.path);
      }
      if (this.qrChoice) {
        await this.upload(this.qrChoice);
        this.config.payment.qr = this.qrChoice.path;
      } else this.config.payment.qr = '';
      this.progress.set('Guardando configuración…');
      const result = await this.backend.call<BusinessConfigurationResponse>(
        'saveBusinessConfiguration',
        {
          establishmentId: this.businessId(),
          revision: this.revision(),
          configuration: this.config,
        },
      );
      this.revision.set(result.revision);
      this.saved.set(changeCounter === this.changeCounter);
      this.message.set('Borrador guardado. Puedes volver a abrirlo desde Negocios.');
      if (!this.route.snapshot.paramMap.has('establishmentId'))
        await this.router.navigate(['/superadmin/negocios', this.businessId(), 'configurar'], {
          queryParams: { paso: this.step(), guardado: '1' },
        });
    } catch (error) {
      this.error.set(
        this.errorMessage(
          error,
          'No pudimos guardar todos los datos. Conservamos tu formulario: vuelve a intentarlo.',
        ),
      );
    } finally {
      this.busy.set(false);
      this.progress.set('');
    }
  }
  private async upload(image: ImageChoice): Promise<void> {
    if (!image.file) return;
    image.path = image.path.replace('/PENDING/', `/${this.businessId()}/`);
    this.progress.set(`Subiendo ${image.file.name}…`);
    await this.media.upload(image.path, image.file);
    image.file = undefined;
  }
  async publish(): Promise<void> {
    if (this.busy() || !this.saved() || this.missing().length || !this.publishConfirm()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.backend.call('publishBusiness', {
        establishmentId: this.businessId(),
        revision: this.revision(),
      });
      this.status.set('published');
      this.publishConfirm.set(false);
      this.message.set(
        'Negocio publicado. Sus canchas ya aparecen a los clientes y su administrador tiene acceso al local.',
      );
    } catch (error) {
      this.error.set(
        this.errorMessage(error, 'No pudimos publicar el negocio. El borrador sigue guardado.'),
      );
    } finally {
      this.busy.set(false);
    }
  }
  private revoke(image: ImageChoice): void {
    if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
  }
  ngOnDestroy(): void {
    this.alive = false;
    for (const image of this.businessPhotos) this.revoke(image);
    for (const images of this.choices.values()) for (const image of images) this.revoke(image);
    if (this.qrChoice) this.revoke(this.qrChoice);
  }
}
