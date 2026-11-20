import { useOrganizationResource, useOrganizationWrite } from '../organization/api.js';

export function usePointsOfSale(filters) {
  return useOrganizationResource('/points-of-sale', filters, { keepPrevious: true });
}

export function usePointOfSale(id) {
  return useOrganizationResource('/points-of-sale/' + id, undefined, {
    enabled: Boolean(id),
    staleTime: Infinity,
  });
}

export function usePointOfSaleWrite() {
  return useOrganizationWrite();
}
