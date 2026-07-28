'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  CLIENT: 'client',
});

const POSTING_STATUS = Object.freeze({
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  POSTED: 'posted',
  ERROR: 'error',
});

const POST_MODE = Object.freeze({
  DRAFT_INBOX: 'draft_inbox',
  DIRECT_POST: 'direct_post',
});

const DRIVE_FOLDER_TYPE = Object.freeze({
  GENERAL: 'general',
  CLIENT: 'client',
});

module.exports = { ROLES, POSTING_STATUS, POST_MODE, DRIVE_FOLDER_TYPE };
