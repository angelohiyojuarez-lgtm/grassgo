import { Injectable } from '@angular/core';

export interface Establishment {
  id: number;
  name: string;
  location: string;
  city: string;
  fields: number;
  fieldType: string;
  description: string;
  rating: number;
  image: string;
  pricePerHour: number;
  isMock?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class MockDataService {
  private establishments: Establishment[] = [
    {
      id: 1,
      name: 'Grass El Puma',
      location: 'Salinas, Andahuaylas, Apurímac',
      city: 'Andahuaylas',
      fields: 1,
      fieldType: 'Grass Sintético',
      description:
        'Cancha de grass sintético de alta calidad. Ideal para partidos de fútbol 5 y fútbol 7. Ubicada cerca de "el Seguro".',
      rating: 4.7,
      image: 'grass1',
      pricePerHour: 50,
      isMock: true,
    },
  ];

  getEstablishments(): Establishment[] {
    return this.establishments;
  }

  getEstablishmentById(id: number): Establishment | undefined {
    return this.establishments.find((e) => e.id === id);
  }

  getEstablishmentsByCity(city: string): Establishment[] {
    return this.establishments.filter((e) => e.city.toLowerCase().includes(city.toLowerCase()));
  }
}
