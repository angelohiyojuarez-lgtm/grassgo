import {
  Component,
  HostListener,
  OnChanges,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KioskService, kioskError, kioskMoneyInput } from '../../core/services/kiosk.service';
import { KioskMovement, KioskPaymentMethod, KioskProduct } from '../../core/models/kiosk';
import { money } from '../../core/models/booking';
import { Icon } from '../../shared/icon';
import { ProductPhotoService } from '../../core/services/product-photo';

interface ProductDraft {
  productId: string;
  name: string;
  category: string;
  price: string;
  cost: string;
  initialStock: number | null;
  active: boolean;
  expectedRevision: number;
  photo: string | null;
}
type KioskSection = 'sell' | 'products' | 'history';
type KioskForm = 'create' | 'edit' | 'sale' | 'restock';
const blankProduct = (): ProductDraft => ({
  productId: crypto.randomUUID(),
  name: '',
  category: '',
  price: '',
  cost: '',
  initialStock: null,
  active: true,
  expectedRevision: 0,
  photo: null,
});

@Component({
  selector: 'gg-admin-kiosk',
  imports: [FormsModule, Icon],
  templateUrl: './admin-kiosk.html',
  styleUrl: './admin-kiosk.css',
})
export class AdminKiosk implements OnChanges, OnDestroy {
  readonly establishmentId = input.required<string>();
  readonly context = input<'local' | 'platform'>('local');
  readonly changed = output<void>();
  private readonly service = inject(KioskService);
  private readonly photoService = inject(ProductPhotoService);
  readonly products = signal<KioskProduct[]>([]);
  readonly movements = signal<KioskMovement[]>([]);
  readonly section = signal<KioskSection>('sell');
  readonly form = signal<KioskForm | null>(null);
  readonly loading = signal(true);
  readonly historyLoading = signal(false);
  readonly busy = signal(false);
  readonly locked = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');
  readonly historyError = signal('');
  readonly photoPreparing = signal(false);
  readonly photoError = signal('');
  readonly message = signal('');
  readonly search = signal('');
  readonly includeArchived = signal(false);
  readonly selectedProduct = signal<KioskProduct | null>(null);
  readonly productDraft = signal<ProductDraft>(blankProduct());
  readonly quantity = signal<number | null>(1);
  readonly paymentMethod = signal<KioskPaymentMethod | ''>('');
  readonly paymentReceived = signal(false);
  readonly money = money;
  readonly shownProducts = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('es');
    return this.products().filter(
      (p) =>
        ((this.section() !== 'sell' && this.includeArchived()) || p.active) &&
        (!query || `${p.name} ${p.category}`.toLocaleLowerCase('es').includes(query)),
    );
  });
  readonly activeCount = computed(() => this.products().filter((p) => p.active).length);
  readonly emptyCount = computed(
    () => this.products().filter((p) => p.active && p.stock === 0).length,
  );
  private stop?: () => void;
  private version = 0;
  private destroyed = false;
  private operationId = crypto.randomUUID();
  private savedKey = '';
  private photoRequest = 0;

  ngOnChanges(): void {
    void this.load();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    ++this.version;
    ++this.photoRequest;
    this.photoPreparing.set(false);
    this.stop?.();
  }
  async load(): Promise<void> {
    const id = this.establishmentId(),
      version = ++this.version;
    this.stop?.();
    this.stop = undefined;
    this.products.set([]);
    this.movements.set([]);
    this.busy.set(false);
    this.historyLoading.set(false);
    this.loading.set(true);
    this.loadError.set('');
    this.resetForm();
    try {
      const stop = await this.service.observeProducts(
        id,
        (products) => {
          if (this.destroyed || version !== this.version) return;
          this.products.set(products);
          this.loading.set(false);
          this.loadError.set('');
        },
        () => {
          if (this.destroyed || version !== this.version) return;
          this.loadError.set('No pudimos actualizar el stock. Vuelve a consultar antes de vender.');
          this.loading.set(false);
        },
      );
      if (this.destroyed || version !== this.version) stop();
      else this.stop = stop;
    } catch (error) {
      if (!this.destroyed && version === this.version) {
        this.loadError.set(kioskError(error));
        this.loading.set(false);
      }
    }
  }
  isSaving(): boolean {
    return this.busy() || this.photoPreparing();
  }
  hasUnsavedChanges(): boolean {
    return !!this.form() && (this.locked() || this.formKey() !== this.savedKey);
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: Event): void {
    if (this.isSaving() || this.hasUnsavedChanges()) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = '';
    }
  }
  private formKey(): string {
    return JSON.stringify(
      this.form() === 'create' || this.form() === 'edit'
        ? this.productDraft()
        : [this.quantity(), this.paymentMethod(), this.paymentReceived()],
    );
  }
  private canSwitch(): boolean {
    return (
      !this.busy() &&
      (!this.hasUnsavedChanges() ||
        window.confirm(
          this.locked()
            ? 'El guardado todavía no se confirmó. Si sales, revisa los movimientos antes de registrar otra vez la misma operación. ¿Quieres salir?'
            : 'Tienes datos sin guardar en el kiosko. ¿Quieres descartarlos?',
        ))
    );
  }
  private resetForm(): void {
    ++this.photoRequest;
    this.photoPreparing.set(false);
    this.photoError.set('');
    this.form.set(null);
    this.locked.set(false);
    this.selectedProduct.set(null);
    this.quantity.set(1);
    this.paymentMethod.set('');
    this.paymentReceived.set(false);
    this.operationId = crypto.randomUUID();
    this.savedKey = '';
    this.error.set('');
  }
  closeForm(): void {
    if (this.canSwitch()) this.resetForm();
  }
  async setSection(section: KioskSection): Promise<void> {
    if (section === this.section() || !this.canSwitch()) return;
    this.resetForm();
    this.section.set(section);
    this.search.set('');
    if (section === 'history') await this.loadHistory();
  }
  async loadHistory(): Promise<void> {
    const id = this.establishmentId(),
      version = this.version;
    this.historyLoading.set(true);
    this.historyError.set('');
    try {
      const items = await this.service.listMovements(id);
      if (!this.destroyed && version === this.version) this.movements.set(items);
    } catch (error) {
      if (!this.destroyed && version === this.version) this.historyError.set(kioskError(error));
    } finally {
      if (!this.destroyed && version === this.version) this.historyLoading.set(false);
    }
  }
  openProduct(product?: KioskProduct): void {
    if (!this.canSwitch()) return;
    this.resetForm();
    this.section.set('products');
    this.productDraft.set(
      product
        ? {
            productId: product.id,
            name: product.name,
            category: product.category,
            price: (product.priceCents / 100).toFixed(2),
            cost: product.costCents === null ? '' : (product.costCents / 100).toFixed(2),
            initialStock: product.stock,
            active: product.active,
            expectedRevision: product.revision,
            photo: product.photo ?? null,
          }
        : blankProduct(),
    );
    this.form.set(product ? 'edit' : 'create');
    this.savedKey = this.formKey();
    this.message.set('');
  }
  openAction(product: KioskProduct, action: 'sale' | 'restock'): void {
    if (!this.canSwitch() || !product.active || (action === 'sale' && product.stock <= 0)) return;
    this.resetForm();
    this.selectedProduct.set({ ...product });
    this.form.set(action);
    this.savedKey = this.formKey();
    this.message.set('');
  }
  stepQuantity(step: number): void {
    if (this.busy() || this.locked()) return;
    const maximum = this.form() === 'sale' ? this.selectedProduct()?.stock || 0 : 1000000;
    this.quantity.set(Math.max(1, Math.min(maximum, (Number(this.quantity()) || 1) + step)));
  }
  saleTotal(): number {
    return (this.selectedProduct()?.priceCents || 0) * (Number(this.quantity()) || 0);
  }
  saleProfit(): number | null {
    const product = this.selectedProduct();
    return !product || product.costCents === null
      ? null
      : (product.priceCents - product.costCents) * (Number(this.quantity()) || 0);
  }
  async selectPhoto(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy() || this.locked() || !['create', 'edit'].includes(this.form() || ''))
      return;
    const token = ++this.photoRequest,
      version = this.version,
      operationId = this.operationId,
      productId = this.productDraft().productId;
    const current = () =>
      !this.destroyed &&
      token === this.photoRequest &&
      version === this.version &&
      operationId === this.operationId &&
      productId === this.productDraft().productId &&
      ['create', 'edit'].includes(this.form() || '');
    this.photoPreparing.set(true);
    this.photoError.set('');
    try {
      const photo = await this.photoService.prepare(file);
      if (current()) this.productDraft.update((draft) => ({ ...draft, photo }));
    } catch (error) {
      if (current())
        this.photoError.set(
          (error as Error)?.message || 'No se pudo preparar la foto. Elige otra imagen.',
        );
    } finally {
      if (current()) this.photoPreparing.set(false);
    }
  }
  removePhoto(): void {
    if (this.busy() || this.locked() || !['create', 'edit'].includes(this.form() || '')) return;
    ++this.photoRequest;
    this.photoPreparing.set(false);
    this.photoError.set('');
    this.productDraft.update((draft) => ({ ...draft, photo: null }));
  }
  async saveProduct(): Promise<void> {
    if (this.isSaving() || !['create', 'edit'].includes(this.form() || '')) return;
    const draft = this.productDraft();
    const priceCents = kioskMoneyInput(draft.price),
      costCents = draft.cost.trim() === '' ? null : kioskMoneyInput(draft.cost);
    if (
      draft.name.trim().length < 2 ||
      draft.name.trim().length > 100 ||
      draft.category.trim().length > 40 ||
      priceCents === null ||
      priceCents < 1 ||
      (draft.cost.trim() !== '' && costCents === null) ||
      !Number.isInteger(draft.initialStock) ||
      draft.initialStock! < 0 ||
      draft.initialStock! > 1000000
    ) {
      this.error.set(
        'Escribe el nombre, un precio válido y el stock inicial en unidades enteras. El costo puede quedar vacío si todavía no lo conoces.',
      );
      return;
    }
    await this.commit(
      () =>
        this.service.saveProduct(this.establishmentId(), {
          productId: draft.productId,
          operationId: this.operationId,
          name: draft.name.trim(),
          category: draft.category.trim(),
          priceCents,
          costCents,
          initialStock: draft.initialStock!,
          active: draft.active,
          expectedRevision: draft.expectedRevision,
          photo: draft.photo,
        }),
      this.form() === 'create'
        ? 'Producto agregado con su stock inicial.'
        : 'Producto actualizado. Las ventas anteriores conservan su precio y costo.',
    );
  }
  async saveAction(): Promise<void> {
    if (this.busy() || !['sale', 'restock'].includes(this.form() || '')) return;
    const product = this.selectedProduct(),
      quantity = this.quantity();
    if (
      !product ||
      !Number.isInteger(quantity) ||
      quantity! < 1 ||
      quantity! > 1000000 ||
      (this.form() === 'sale' && quantity! > product.stock)
    ) {
      this.error.set(
        'Escribe una cantidad entera válida. Para vender debe alcanzar el stock disponible.',
      );
      return;
    }
    const input = {
      productId: product.id,
      operationId: this.operationId,
      quantity: quantity!,
      expectedRevision: product.revision,
    };
    if (this.form() === 'sale') {
      if (!this.paymentMethod() || !this.paymentReceived()) {
        this.error.set('Elige cómo te pagaron y confirma que ya recibiste el dinero.');
        return;
      }
      await this.commit(
        () =>
          this.service.sell(this.establishmentId(), {
            ...input,
            paymentMethod: this.paymentMethod() as KioskPaymentMethod,
            paymentReceived: true,
          }),
        'Venta registrada. El stock ya se descontó y el ingreso aparece en el resumen.',
      );
    } else
      await this.commit(
        () => this.service.restock(this.establishmentId(), input),
        'Reposición registrada. El stock ya está actualizado.',
      );
  }
  private async commit(action: () => Promise<void>, success: string): Promise<void> {
    const version = this.version;
    this.busy.set(true);
    this.locked.set(true);
    this.error.set('');
    try {
      await action();
      if (this.destroyed || version !== this.version) return;
      this.resetForm();
      this.message.set(success);
      this.changed.emit();
    } catch (error) {
      if (this.destroyed || version !== this.version) return;
      const code = (error as { code?: string })?.code?.split('/').pop();
      if (code === 'aborted' || code === 'failed-precondition') {
        this.resetForm();
        this.error.set(
          kioskError(error) +
            ' Vuelve a seleccionar el producto y revisa el stock y precio actualizados.',
        );
      } else {
        if (['invalid-argument', 'permission-denied', 'unauthenticated'].includes(code || ''))
          this.locked.set(false);
        this.error.set(kioskError(error));
      }
    } finally {
      if (!this.destroyed && version === this.version) this.busy.set(false);
    }
  }
  movementLabel(kind: KioskMovement['kind']): string {
    return {
      create: 'Producto y stock inicial',
      edit: 'Datos del producto',
      restock: 'Reposición',
      sale: 'Venta',
    }[kind];
  }
  timeLabel(at: number | null): string {
    return at === null
      ? 'Registrando hora…'
      : new Intl.DateTimeFormat('es-PE', {
          timeZone: 'America/Lima',
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(at);
  }
}
