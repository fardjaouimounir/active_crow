import { useCallback, useMemo } from 'react';
import { useGeoText } from '../../ui/map/geoMessages.js';
import { useWilayas } from '../organization/api.js';

/** Wilaya names in the UI language from the reference list, falling back to the API's own names. */
export function useWilayaName() {
  const { rtl } = useGeoText();
  const wilayas = useWilayas();
  const byId = useMemo(
    () => new Map((wilayas.data?.data ?? []).map((item) => [item.id, item])),
    [wilayas.data],
  );
  return useCallback(
    (id, member) => {
      const item = byId.get(id) ?? member ?? {};
      return (rtl && item.nameAr) || item.nameEn || String(id);
    },
    [byId, rtl],
  );
}
