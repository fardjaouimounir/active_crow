import { INTERNAL_ERROR } from '@fieldflow/shared';

/**
 * Translated message for an ApiError code, falling back to the generic server error.
 * @param {import('i18next').TFunction} t
 * @param {{ code?: string } | null | undefined} error
 */
export function apiErrorMessage(t, error) {
  return t(`common:errors.codes.${error?.code}`, {
    defaultValue: t(`common:errors.codes.${INTERNAL_ERROR}`),
  });
}
