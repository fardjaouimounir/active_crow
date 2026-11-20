import { ScopeService } from '../../core/authz/index.js';
import { documentLinks } from './campaigns.repository.js';

/**
 * File access policy for `campaign_document`: readable when one of the campaigns linking the file
 * is in the reader's scope; client-role users additionally need `visibility = client_visible`
 * (Q-16, Module 11). Returns the document label as the download name.
 * @type {import('../files/fileAccessPolicies.js').FileAccessPolicy}
 */
export async function campaignDocumentPolicy(actor, file, db) {
  const scope = ScopeService.resolve(actor);
  if (scope.level === 'client' && file.visibility !== 'client_visible') return null;
  const [link] = await documentLinks(db, scope, file.id);
  return link ? { filename: link.label ?? undefined } : null;
}
