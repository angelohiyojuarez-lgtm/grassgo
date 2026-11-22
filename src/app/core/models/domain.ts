export interface UserProfile {
  uid: string;
  displayName: string;
  phone: string;
}
export interface EstablishmentMembership {
  establishmentId: string;
  name: string;
  role: 'admin';
  status: 'active' | 'suspended';
}
export interface CatalogEstablishment {
  id: string;
  name: string;
  location: string;
  description: string;
  status: 'published';
}
