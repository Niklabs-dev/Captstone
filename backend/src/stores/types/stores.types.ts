export interface StoreResponse {
  id: string;
  name: string;
  city: string;
  address: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreStateChange {
  store: StoreResponse;
  changed: boolean;
}
