import { operation } from '../../core/http/openapi.js';
import * as input from './campaigns.validators.js';

const READ = 'campaign.read';
const MANAGE = 'campaign.manage';
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };

const campaignSchema = {
  type: 'object',
  required: ['id', 'code', 'name', 'status', 'startDate', 'endDate'],
  description:
    'Client-role users receive only id, code, name, description, status, dates and client.',
  properties: {
    id: uuid,
    code: { type: 'string', examples: ['CMP-2027-001'] },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    status: { type: 'string' },
    startDate: date,
    endDate: date,
    budgetAmount: { type: ['string', 'null'], examples: ['2500000.00'] },
    assignmentApproverRole: { type: 'string' },
    version: { type: 'integer' },
    requiredAnimateurs: { type: 'integer' },
    client: { type: 'object', properties: { id: uuid, name: { type: 'string' } } },
  },
};
const detailSchema = {
  ...campaignSchema,
  properties: {
    ...campaignSchema.properties,
    wilayas: { type: 'array', items: { type: 'object' } },
    pointsOfSale: { type: 'array', items: { type: 'object' } },
    products: { type: 'array', items: { type: 'object' } },
    counts: { type: 'object' },
  },
};
const documentSchema = {
  type: 'object',
  properties: {
    id: uuid,
    fileId: uuid,
    label: { type: ['string', 'null'] },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    width: { type: ['integer', 'null'] },
    height: { type: ['integer', 'null'] },
    hasThumbnail: { type: 'boolean' },
    visibility: { enum: ['internal', 'client_visible'] },
    uploadedBy: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const draftOnly = ' (draft campaigns only for now)';
const paths = [
  operation('get', '/campaigns', 'List the campaigns in scope', READ, {
    query: input.campaignList,
    list: true,
    dataSchema: campaignSchema,
  }),
  operation(
    'post',
    '/campaigns',
    'Create a draft campaign with its stock locations and rule set v1',
    MANAGE,
    { body: input.createCampaign, status: 201, dataSchema: detailSchema },
  ),
  operation('get', '/campaigns/{id}', 'Read a campaign with its coverage and counts', READ, {
    params: input.params,
    dataSchema: detailSchema,
  }),
  operation('patch', '/campaigns/{id}', 'Update a campaign at a version' + draftOnly, MANAGE, {
    params: input.params,
    body: input.updateCampaign,
    dataSchema: detailSchema,
  }),
  operation('put', '/campaigns/{id}/wilayas', 'Replace the target wilayas' + draftOnly, MANAGE, {
    params: input.params,
    body: input.wilayas,
    dataSchema: detailSchema,
  }),
  operation('post', '/campaigns/{id}/staff', 'Add a regional manager or supervisor', MANAGE, {
    params: input.params,
    body: input.staff,
    status: 201,
  }),
  operation('delete', '/campaigns/{id}/staff/{staffId}', 'Remove a staff member', MANAGE, {
    params: input.staffParams,
    status: 204,
  }),
  operation(
    'put',
    '/campaigns/{id}/points-of-sale',
    'Replace the points of sale' + draftOnly,
    MANAGE,
    { params: input.params, body: input.pointsOfSale, dataSchema: detailSchema },
  ),
  operation(
    'put',
    '/campaigns/{id}/products',
    'Replace the promoted products' + draftOnly,
    MANAGE,
    {
      params: input.params,
      body: input.products,
      dataSchema: detailSchema,
    },
  ),
  operation('get', '/campaigns/{id}/documents', 'List the reference documents', READ, {
    params: input.params,
    array: true,
    dataSchema: documentSchema,
  }),
  operation(
    'post',
    '/campaigns/{id}/documents',
    'Upload a reference document (PDF ≤ 20 MB, JPEG/PNG/WebP ≤ 10 MB)',
    'campaign.manage + file.upload',
    {
      params: input.params,
      multipart: { fields: input.documentLabel },
      status: 201,
      dataSchema: documentSchema,
    },
  ),
  operation('patch', '/campaigns/{id}/documents/{documentId}', 'Rename a document', MANAGE, {
    params: input.documentParams,
    body: input.documentLabel,
    dataSchema: documentSchema,
  }),
  operation(
    'delete',
    '/campaigns/{id}/documents/{documentId}',
    'Unlink a document (the file is kept)',
    MANAGE,
    { params: input.documentParams, status: 204 },
  ),
  operation('get', '/campaigns/{id}/status-history', 'Read the status history', READ, {
    params: input.params,
    array: true,
  }),
];

export function registerCampaignsOpenApi(registry) {
  paths.forEach((path) => registry.register(path));
}
