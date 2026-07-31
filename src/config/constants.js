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

const DRIVE_FOLDER_TYPE = Object.freeze({
  GENERAL: 'general',
  CLIENT: 'client',
});

module.exports = { ROLES, POSTING_STATUS, DRIVE_FOLDER_TYPE };
