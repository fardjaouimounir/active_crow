ALTER TABLE issue_comments ADD CONSTRAINT issue_comments_issue_id_id_key UNIQUE (issue_id, id);
ALTER TABLE issue_attachments ADD COLUMN comment_id UUID;
ALTER TABLE issue_attachments ADD CONSTRAINT issue_attachments_issue_id_comment_id_fkey
  FOREIGN KEY (issue_id, comment_id) REFERENCES issue_comments (issue_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX issue_attachments_issue_id_comment_id_idx ON issue_attachments (issue_id, comment_id);
