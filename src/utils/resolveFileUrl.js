const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const {
  uploadToCloudinary,
  isCloudinaryUrl,
  isLocalUploadPath,
  isConfigured,
} = require('./cloudinary');

const backendRoot = path.join(__dirname, '../..');

const resolveLocalPath = (storedPath = '') => {
  const relative = String(storedPath).replace(/^\//, '');
  return path.join(backendRoot, relative);
};

const folderForStoredPath = (storedPath = '') => {
  if (storedPath.includes('study-abroad-docs')) return 'study-abroad-docs';
  if (storedPath.includes('study-abroad-mail')) return 'study-abroad-mail';
  if (storedPath.includes('pr-docs')) return 'pr-docs';
  if (storedPath.includes('pr-mail')) return 'pr-mail';
  if (storedPath.includes('admin-avatars')) return 'admin-avatars';
  if (storedPath.includes('resumes') || storedPath.includes('/uploads/cv')) return 'resumes';
  if (storedPath.includes('booking-docs') || storedPath.includes('documents-')) return 'booking-docs';
  return 'routeup-migrated';
};

const searchCloudinaryByLocalPath = async (storedPath, folder) => {
  if (!isConfigured || !isLocalUploadPath(storedPath) || !folder) {
    return null;
  }

  const basename = path.basename(storedPath);
  const stem = path.basename(storedPath, path.extname(storedPath));

  for (const resourceType of ['raw', 'image']) {
    try {
      const result = await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        prefix: `${folder}/${stem}`,
        max_results: 10,
      });

      const match = (result.resources || []).find(
        (resource) =>
          resource.public_id?.includes(stem) ||
          resource.secure_url?.includes(basename)
      );

      if (match?.secure_url) {
        console.log(`[Resolve] recovered from Cloudinary search → ${match.secure_url}`);
        return match.secure_url;
      }
    } catch (error) {
      console.warn(`[Resolve] Cloudinary search failed (${resourceType}):`, error.message || error);
    }
  }

  return null;
};

/**
 * Returns a public Cloudinary URL for a stored file path.
 * Migrates legacy /uploads/* paths to Cloudinary when the local file still exists.
 */
const resolveStoredFileUrl = async (storedPath, folderOverride) => {
  if (!storedPath) {
    throw new Error('Document not found');
  }

  if (isCloudinaryUrl(storedPath)) {
    return storedPath;
  }

  if (isLocalUploadPath(storedPath)) {
    if (!isConfigured) {
      throw new Error('Cloudinary is not configured on the server');
    }

    const folder = folderOverride || folderForStoredPath(storedPath);
    const absolutePath = resolveLocalPath(storedPath);
    if (!fs.existsSync(absolutePath)) {
      const recovered = await searchCloudinaryByLocalPath(storedPath, folder);
      if (recovered) {
        return recovered;
      }
      throw new Error('This document is no longer available. Please request a re-upload.');
    }

    const cloudUrl = await uploadToCloudinary(absolutePath, folder);
    console.log(`[Resolve] migrated legacy file → ${cloudUrl}`);
    return cloudUrl;
  }

  if (storedPath.startsWith('http://') || storedPath.startsWith('https://')) {
    return storedPath;
  }

  throw new Error('Unsupported document storage path');
};

module.exports = {
  resolveStoredFileUrl,
  resolveLocalPath,
  folderForStoredPath,
};
