export interface StoreResponse {
  id: string;
  name: string;
  city: string;
  address: string;
  subwayStoreId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreStateChange {
  store: StoreResponse;
  changed: boolean;
}

// Resultado de editar un local: el local actualizado y cómo estaba antes,
// para auditar el valor anterior de los campos sensibles (ID Subway).
export interface StoreUpdateResult {
  store: StoreResponse;
  previous: StoreResponse;
}
