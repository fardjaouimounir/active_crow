import { describe, expect, it } from 'vitest';
import {
  checkUpload,
  createCampaignSchema,
  fileRuleFor,
  maxUploadBytes,
  updateCampaignSchema,
} from '../src/index.js';

const MB = 1024 * 1024;

describe('file kind rules', () => {
  it('limits campaign documents to PDF ≤ 20 MB and images ≤ 10 MB', () => {
    expect(maxUploadBytes('campaign_document')).toBe(20 * MB);
    expect(fileRuleFor('campaign_document', 'image/png').maxBytes).toBe(10 * MB);
    expect(checkUpload('campaign_document', { type: 'application/pdf', size: 20 * MB })).toBeNull();
    expect(checkUpload('campaign_document', { type: 'application/pdf', size: 20 * MB + 1 })).toBe(
      'FILE_TOO_LARGE',
    );
    expect(checkUpload('campaign_document', { type: 'image/jpeg', size: 11 * MB })).toBe(
      'FILE_TOO_LARGE',
    );
    expect(checkUpload('campaign_document', { type: 'application/x-msdownload', size: 1 })).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );
    expect(checkUpload('attendance_proof', { type: 'application/pdf', size: 1 })).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );
    expect(checkUpload('unknown_kind', { type: 'image/png', size: 1 })).toBe(
      'FILE_TYPE_NOT_ALLOWED',
    );
  });
});

describe('campaign schemas', () => {
  const base = {
    clientId: '77111111-1111-4111-8111-111111111111',
    name: 'Ramadan',
    startDate: '2027-02-10',
    endDate: '2027-03-12',
  };

  it('defaults the approver to regional_manager and checks the date order', () => {
    expect(createCampaignSchema.parse(base).assignmentApproverRole).toBe('regional_manager');
    expect(createCampaignSchema.safeParse({ ...base, endDate: '2027-02-09' }).success).toBe(false);
  });

  it('never accepts clientId on update and requires a version plus one field', () => {
    expect(updateCampaignSchema.safeParse({ version: 1, name: 'x' }).success).toBe(true);
    expect(updateCampaignSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateCampaignSchema.safeParse({ version: 1, clientId: base.clientId }).success).toBe(
      false,
    );
  });
});
