import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { BusinessMediaService } from '../core/services/business-media.service';
@Directive({ selector: 'img[ggMedia]' })
export class BusinessImage {
  readonly ggMedia = input('');
  private readonly element = inject(ElementRef<HTMLImageElement>);
  private readonly media = inject(BusinessMediaService);
  constructor() {
    effect((cleanup) => {
      const path = this.ggMedia();
      let active = true,
        url = '';
      this.element.nativeElement.removeAttribute('src');
      if (path)
        void this.media
          .read(path)
          .then((result) => {
            if (active) {
              url = result;
              this.element.nativeElement.src = result;
            } else if (result.startsWith('blob:')) URL.revokeObjectURL(result);
          })
          .catch(() => {
            if (active) this.element.nativeElement.alt = 'No se pudo cargar esta imagen';
          });
      cleanup(() => {
        active = false;
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    });
  }
}
