import {
  Component,
  HostListener,
  InjectionToken,
  OnChanges,
  OnDestroy,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EstablishmentBusinessService } from '../../core/services/establishment-business.service';
import { preparePaymentQr } from '../../core/services/payment-qr-image';
import {
  BusinessContact,
  BusinessPayment,
  PreparedPaymentQr,
} from '../../core/models/establishment-business';
import { BusinessImage } from '../../shared/business-image';
import { Icon } from '../../shared/icon';

export const PAYMENT_QR_PREPARER = new InjectionToken<typeof preparePaymentQr>(
  'Preparador de la foto del QR de pago',
  { providedIn: 'root', factory: () => preparePaymentQr },
);

const emptyContact = (): BusinessContact => ({
  phone: '',
  description: '',
  reference: '',
  revision: 0,
});
const emptyPayment = (): BusinessPayment => ({
  methods: [],
  recipient: '',
  phone: '',
  qr: '',
  revision: 0,
});
const contactKey = (value: BusinessContact): string =>
  JSON.stringify([value.phone.trim(), value.description.trim(), value.reference.trim()]);
const paymentKey = (value: BusinessPayment, image?: PreparedPaymentQr | null): string =>
  JSON.stringify([
    [...value.methods].sort(),
    value.recipient.trim(),
    value.phone.trim(),
    value.qr,
    image?.id || '',
  ]);
const businessError = (error: unknown, fallback: string): string => {
  const detail = error as { code?: string; message?: string };
  const code = detail?.code?.split('/').pop();
  if (['aborted', 'invalid-argument', 'failed-precondition'].includes(code || ''))
    return detail.message || fallback;
  if (code === 'permission-denied')
    return 'No tienes permiso para editar este establecimiento. Vuelve a ingresar con su administrador.';
  if (code === 'unauthenticated') return 'Tu sesión venció. Vuelve a ingresar.';
  return fallback;
};

@Component({
  selector: 'gg-admin-local-business',
  imports: [FormsModule, BusinessImage, Icon],
  templateUrl: './admin-local-business.html',
  styleUrl: './admin-local-business.css',
})
export class AdminLocalBusiness implements OnChanges, OnDestroy {
  readonly establishmentId = input.required<string>();
  private readonly service = inject(EstablishmentBusinessService);
  private readonly prepareQr = inject(PAYMENT_QR_PREPARER);
  readonly name = signal('');
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly processing = signal(false);
  readonly loadError = signal('');
  readonly contactError = signal('');
  readonly paymentError = signal('');
  readonly contactMessage = signal('');
  readonly paymentMessage = signal('');
  readonly stagedQr = signal<PreparedPaymentQr | null>(null);
  readonly pendingReload = signal<'contact' | 'payment' | null>(null);
  readonly methods = ['Yape', 'Plin'];
  contact = emptyContact();
  payment = emptyPayment();
  paymentReviewed = false;
  private reviewedKey = '';
  private savedContact = '';
  private savedPayment = '';
  private version = 0;
  private imageVersion = 0;
  private destroyed = false;

  ngOnChanges(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.version;
    ++this.imageVersion;
  }
  private current(id: string, version: number): boolean {
    return !this.destroyed && id === this.establishmentId() && version === this.version;
  }
  async load(): Promise<void> {
    const id = this.establishmentId(),
      version = ++this.version;
    ++this.imageVersion;
    this.name.set('');
    this.loading.set(true);
    this.busy.set(false);
    this.processing.set(false);
    this.loadError.set('');
    this.contactError.set('');
    this.paymentError.set('');
    this.contactMessage.set('');
    this.paymentMessage.set('');
    this.pendingReload.set(null);
    this.contact = emptyContact();
    this.payment = emptyPayment();
    this.savedContact = '';
    this.savedPayment = '';
    this.stagedQr.set(null);
    this.paymentChanged();
    try {
      const data = await this.service.load(id);
      if (!this.current(id, version)) return;
      this.name.set(data.name);
      this.acceptContact(data.contact);
      this.acceptPayment(data.payment);
    } catch (error) {
      if (this.current(id, version))
        this.loadError.set(
          businessError(error, 'No pudimos consultar los datos del local. Vuelve a intentarlo.'),
        );
    } finally {
      if (this.current(id, version)) this.loading.set(false);
    }
  }
  private acceptContact(value: BusinessContact): void {
    this.contact = { ...value };
    this.savedContact = contactKey(value);
  }
  private acceptPayment(value: BusinessPayment): void {
    this.payment = { ...value, methods: [...value.methods] };
    this.savedPayment = paymentKey(value);
    this.stagedQr.set(null);
    this.paymentChanged();
  }
  private contactDirty(): boolean {
    return !!this.savedContact && contactKey(this.contact) !== this.savedContact;
  }
  private paymentDirty(): boolean {
    return !!this.savedPayment && paymentKey(this.payment, this.stagedQr()) !== this.savedPayment;
  }
  hasUnsavedChanges(): boolean {
    return (
      this.processing() || this.contactDirty() || this.paymentDirty() || !!this.pendingReload()
    );
  }
  isSaving(): boolean {
    return this.busy() || this.processing();
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: Event): void {
    if (this.isSaving() || this.hasUnsavedChanges()) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = '';
    }
  }
  paymentChanged(): void {
    this.paymentReviewed = false;
    this.reviewedKey = '';
    this.paymentMessage.set('');
  }
  reviewPayment(checked: boolean): void {
    if (this.isSaving()) return;
    this.paymentReviewed = checked;
    this.reviewedKey = checked ? paymentKey(this.payment, this.stagedQr()) : '';
  }
  toggleMethod(method: string): void {
    if (this.isSaving() || !this.methods.includes(method)) return;
    this.payment.methods = this.payment.methods.includes(method)
      ? this.payment.methods.filter((value) => value !== method)
      : [...this.payment.methods, method];
    this.paymentChanged();
  }
  legacyQr(): boolean {
    return !!this.payment.qr && !this.payment.qr.startsWith('payment-qrs/');
  }
  onQrSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.chooseQr(file);
  }
  async chooseQr(file: File): Promise<void> {
    if (this.busy() || this.loading()) return;
    const id = this.establishmentId(),
      version = this.version,
      imageVersion = ++this.imageVersion;
    this.stagedQr.set(null);
    this.paymentChanged();
    this.paymentError.set('');
    this.processing.set(true);
    try {
      const image = await this.prepareQr(file);
      if (this.current(id, version) && imageVersion === this.imageVersion) this.stagedQr.set(image);
    } catch (error) {
      if (this.current(id, version) && imageVersion === this.imageVersion)
        this.paymentError.set(
          businessError(
            error,
            'No pudimos preparar esa foto. Elige otra imagen JPG, PNG o WebP de hasta 5 MB.',
          ),
        );
    } finally {
      if (this.current(id, version) && imageVersion === this.imageVersion)
        this.processing.set(false);
    }
  }
  removeStagedQr(): void {
    if (this.isSaving()) return;
    this.stagedQr.set(null);
    this.paymentError.set('');
    this.paymentChanged();
  }
  async saveContact(): Promise<void> {
    if (this.isSaving() || this.loading()) return;
    this.contactError.set('');
    this.contactMessage.set('');
    if (
      !/^[+0-9 ()-]{0,20}$/.test(this.contact.phone.trim()) ||
      this.contact.description.trim().length > 1000 ||
      this.contact.reference.trim().length > 300
    ) {
      this.contactError.set(
        'Revisa el celular, la referencia (hasta 300 caracteres) y la descripción (hasta 1000).',
      );
      return;
    }
    const id = this.establishmentId(),
      version = this.version;
    const value = {
      ...this.contact,
      phone: this.contact.phone.trim(),
      description: this.contact.description.trim(),
      reference: this.contact.reference.trim(),
    };
    this.busy.set(true);
    try {
      const saved = await this.service.saveContact(id, value);
      if (!this.current(id, version)) return;
      this.acceptContact(saved);
      this.contactMessage.set('Datos del negocio guardados. Los clientes verán esta información.');
    } catch (error) {
      if (this.current(id, version))
        this.contactError.set(
          businessError(
            error,
            'No pudimos guardar los datos del negocio. Tus cambios siguen aquí; vuelve a intentarlo.',
          ),
        );
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
  async savePayment(): Promise<void> {
    if (this.isSaving() || this.loading()) return;
    this.paymentError.set('');
    this.paymentMessage.set('');
    const image = this.stagedQr();
    if (!image && (!this.payment.qr || this.legacyQr())) {
      this.paymentError.set('Primero sube una foto de tu QR y comprueba que se vea completo.');
      return;
    }
    if (
      !this.payment.methods.length ||
      this.payment.methods.some((value) => !this.methods.includes(value)) ||
      new Set(this.payment.methods).size !== this.payment.methods.length ||
      this.payment.recipient.trim().length < 2 ||
      this.payment.recipient.trim().length > 100 ||
      !/^\+?[0-9][0-9 ()-]{7,19}$/.test(this.payment.phone.trim())
    ) {
      this.paymentError.set(
        'Elige Yape o Plin y completa el nombre del titular y su celular de pago.',
      );
      return;
    }
    if (!this.paymentReviewed || this.reviewedKey !== paymentKey(this.payment, image)) {
      this.paymentChanged();
      this.paymentError.set(
        'Revisa la foto, el titular y el celular. Después marca la casilla de revisión.',
      );
      return;
    }
    const id = this.establishmentId(),
      version = this.version;
    const value = {
      ...this.payment,
      methods: [...this.payment.methods],
      recipient: this.payment.recipient.trim(),
      phone: this.payment.phone.trim(),
      qr: image ? 'payment-qrs/' + id + '/' + image.id : this.payment.qr,
    };
    this.busy.set(true);
    try {
      const saved = await this.service.savePayment(id, value, image || undefined);
      if (!this.current(id, version)) return;
      this.acceptPayment(saved);
      this.paymentMessage.set(
        'Datos de pago guardados para nuevas solicitudes. Las solicitudes anteriores conservan sus datos de pago.',
      );
    } catch (error) {
      if (this.current(id, version))
        this.paymentError.set(
          businessError(
            error,
            'No pudimos guardar el QR y los datos de pago. Tu foto y cambios siguen aquí; vuelve a intentarlo.',
          ),
        );
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
  requestReload(section: 'contact' | 'payment'): void {
    if (this.isSaving() || this.loading()) return;
    if (section === 'contact' ? this.contactDirty() : this.paymentDirty())
      this.pendingReload.set(section);
    else void this.reloadSection(section);
  }
  confirmReload(): void {
    const section = this.pendingReload();
    if (!section || this.isSaving()) return;
    void this.reloadSection(section);
  }
  private async reloadSection(section: 'contact' | 'payment'): Promise<void> {
    const id = this.establishmentId(),
      version = this.version;
    this.busy.set(true);
    (section === 'contact' ? this.contactError : this.paymentError).set('');
    try {
      const data = await this.service.load(id);
      if (!this.current(id, version)) return;
      if (section === 'contact') {
        this.acceptContact(data.contact);
        this.contactMessage.set('Datos del negocio actualizados.');
      } else {
        this.acceptPayment(data.payment);
        this.paymentMessage.set('Datos de pago actualizados.');
      }
      this.pendingReload.set(null);
    } catch (error) {
      if (this.current(id, version))
        (section === 'contact' ? this.contactError : this.paymentError).set(
          businessError(error, 'No pudimos actualizar los datos. Tus cambios siguen aquí.'),
        );
    } finally {
      if (this.current(id, version)) this.busy.set(false);
    }
  }
}
