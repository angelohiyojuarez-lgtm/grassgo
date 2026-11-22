import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '../firebase/firebase.service';
import { BackendTransport } from './backend-transport.service';
import {
  PreparedPaymentQr,
  paymentQrParts,
  validPaymentQr,
} from '../models/establishment-business';
@Injectable({ providedIn: 'root' })
export class BusinessMediaService {
  private readonly transport = inject(BackendTransport);
  private readonly firebase = inject(FirebaseService);
  async read(path: string): Promise<string> {
    if (path.startsWith('payment-qrs/')) {
      const parts = paymentQrParts(path);
      if (!parts) throw Error('La referencia de la foto del QR no es válida.');
      const { doc, getDocFromServer } = await import('firebase/firestore');
      const saved = (
        await getDocFromServer(
          doc(
            await this.firebase.getDb(),
            'catalog',
            parts.establishmentId,
            'paymentQrs',
            parts.id,
          ),
        )
      ).data();
      if (
        !saved ||
        saved['establishmentId'] !== parts.establishmentId ||
        saved['id'] !== parts.id ||
        !validPaymentQr(saved as PreparedPaymentQr)
      )
        throw Error('No se pudo cargar una foto válida del QR.');
      return saved['imageData'];
    }
    if (!path.startsWith('business-media/')) return path;
    if (await this.transport.base())
      return URL.createObjectURL(await this.transport.readMedia(path));
    const { getBlob, ref } = await import('firebase/storage');
    return URL.createObjectURL(
      await getBlob(ref(await this.firebase.getStorage(), path), 5 * 1024 * 1024),
    );
  }
  async upload(path: string, file: File): Promise<void> {
    if (await this.transport.base()) return this.transport.uploadMedia(path, file);
    const { uploadBytes, ref, getMetadata } = await import('firebase/storage');
    const reference = ref(await this.firebase.getStorage(), path);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    )
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('');
    try {
      const metadata = await getMetadata(reference);
      if (metadata.customMetadata?.['sha256'] !== digest)
        throw Error('Ya existe una imagen distinta en este intento.');
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== 'storage/object-not-found') throw error;
    }
    await uploadBytes(reference, file, {
      contentType: file.type,
      customMetadata: { sha256: digest },
    });
  }
}
