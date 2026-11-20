import {
  AI_CAPABILITIES,
  aiAcceptInput,
  aiCallbackSchema,
  aiRejectInput,
  aiRequestFilters,
  aiRequestInput,
  aiSuggestionFilters,
} from '@fieldflow/shared';
import { z } from 'zod';

export const empty = z.strictObject({});
export const params = z.strictObject({ id: z.uuid() });
export const commentaryQuery = z.strictObject({
  capability: z.enum(AI_CAPABILITIES),
  subjectId: z.uuid(),
});
export {
  aiAcceptInput,
  aiCallbackSchema,
  aiRejectInput,
  aiRequestFilters,
  aiRequestInput,
  aiSuggestionFilters,
};
