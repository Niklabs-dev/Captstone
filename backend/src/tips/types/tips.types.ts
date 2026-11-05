export const MAX_TIP_AMOUNT = 9_999_999_999;

// El medio de pago viaja siempre como código estable del catálogo (string);
// el nombre se resuelve desde el catálogo para mostrar medios desactivados
// sin perder la referencia histórica.
export interface TipEntryResponse {
  id: string;
  businessDate: string;
  paymentMethod: string;
  paymentMethodName: string;
  amount: number;
  store: {
    id: string;
    name: string;
  };
  responsible: {
    id: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface TipEntryCreateResult {
  entry: TipEntryResponse;
  created: boolean;
}
