const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

const isConfigured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name' &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_KEY !== 'your_api_key' &&
  process.env.CLOUDINARY_API_SECRET &&
  process.env.CLOUDINARY_API_SECRET !== 'your_api_secret';

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.zip',
  '.csv',
]);

const isCloudinaryUrl = (value = '') =>
  typeof value === 'string' && /^https?:\/\/res\.cloudinary\.com\//i.test(value);

const isLocalUploadPath = (value = '') =>
  typeof value === 'string' && (value.startsWith('/uploads/') || value.startsWith('uploads/'));

const getResourceType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  // PDFs as image so page previews work on free plans where raw PDF delivery is blocked.
  if (ext === '.pdf') return 'image';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'raw';
  return 'auto';
};

const isPdfCloudinaryUrl = (url = '') =>
  isCloudinaryUrl(url) && /\.pdf(\?|$)/i.test(String(url));

const parseCloudinaryUrl = (url = '') => {
  const match = String(url).match(/\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/i);
  if (!match) return null;
  return { resourceType: match[1], publicId: match[2] };
};

const getDocumentViewUrl = (secureUrl) => {
  if (!isCloudinaryUrl(secureUrl)) return secureUrl;

  if (!isPdfCloudinaryUrl(secureUrl)) {
    return secureUrl;
  }

  const parsed = parseCloudinaryUrl(secureUrl);
  if (!parsed) return secureUrl;

  if (parsed.resourceType === 'image') {
    const baseId = parsed.publicId.replace(/\.pdf$/i, '');
    return cloudinary.url(baseId, {
      resource_type: 'image',
      type: 'upload',
      format: 'jpg',
      page: 1,
      secure: true,
    });
  }

  return secureUrl;
};

const getDocumentDownloadUrl = (secureUrl) => {
  if (!isCloudinaryUrl(secureUrl)) return secureUrl;

  const parsed = parseCloudinaryUrl(secureUrl);
  if (!parsed) return secureUrl;

  if (isPdfCloudinaryUrl(secureUrl)) {
    return cloudinary.url(parsed.publicId, {
      resource_type: parsed.resourceType,
      type: 'upload',
      flags: 'attachment',
      secure: true,
    });
  }

  return cloudinary.url(parsed.publicId, {
    resource_type: parsed.resourceType,
    type: 'upload',
    flags: 'attachment',
    secure: true,
  });
};

/**
 * Fetch original Cloudinary asset bytes via Admin private download API.
 * Works even when public PDF/ZIP delivery is blocked (res.cloudinary.com → 401).
 */
const downloadCloudinaryAsset = async (secureUrl) => {
  if (!isConfigured) {
    throw new Error('Cloudinary is not configured');
  }
  if (!isCloudinaryUrl(secureUrl)) {
    throw new Error('Not a Cloudinary URL');
  }

  const parsed = parseCloudinaryUrl(secureUrl);
  if (!parsed) {
    throw new Error('Could not parse Cloudinary URL');
  }

  let publicId = parsed.publicId;
  let format;
  const extMatch = publicId.match(/\.([a-z0-9]+)$/i);
  if (extMatch) {
    format = extMatch[1].toLowerCase();
    publicId = publicId.replace(/\.[a-z0-9]+$/i, '');
  } else if (isPdfCloudinaryUrl(secureUrl)) {
    format = 'pdf';
  }

  const privateUrl = cloudinary.utils.private_download_url(publicId, format || '', {
    resource_type: parsed.resourceType,
    type: 'upload',
    attachment: true,
  });

  const response = await fetch(privateUrl);
  if (!response.ok) {
    throw new Error(`Cloudinary private download failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType =
    response.headers.get('content-type') ||
    (format === 'pdf' ? 'application/pdf' : 'application/octet-stream');

  return { buffer, contentType, format };
};

const checkPdfDeliveryEnabled = async () => {
  if (!isConfigured) {
    return { ok: false, detail: 'Cloudinary not configured' };
  }

  try {
    const resources = await cloudinary.api.resources({
      resource_type: 'image',
      prefix: 'pdf-delivery-check',
      max_results: 1,
    });

    let testUrl = resources.resources?.[0]?.secure_url;
    if (!testUrl) {
      const tmpPath = path.join(__dirname, '../uploads/.pdf-delivery-check.pdf');
      if (!fs.existsSync(path.dirname(tmpPath))) {
        fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
      }
      fs.writeFileSync(
        tmpPath,
        Buffer.from(
          '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n'
        )
      );
      const uploaded = await cloudinary.uploader.upload(tmpPath, {
        folder: 'pdf-delivery-check',
        resource_type: 'image',
        public_id: 'pdf-delivery-check/probe',
        overwrite: true,
        invalidate: true,
      });
      testUrl = uploaded.secure_url;
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }

    const response = await fetch(testUrl, { method: 'HEAD' });
    if (response.status === 401) {
      return {
        ok: false,
        detail:
          'PDF download blocked — enable Settings → Security → Allow delivery of PDF and ZIP files',
      };
    }

    return { ok: true, detail: 'PDF delivery enabled' };
  } catch (error) {
    return { ok: false, detail: error.message || 'Could not verify PDF delivery' };
  }
};

/**
 * Uploads a local file to Cloudinary and deletes the local temp file afterwards.
 */
const uploadToCloudinary = async (filePath, folder = 'routeup') => {
  if (!filePath) {
    throw new Error('No file path provided for Cloudinary upload.');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Upload file not found: ${filePath}`);
  }
  if (!isConfigured) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_* variables in .env');
  }

  const resourceType = getResourceType(filePath);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
    });

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error(`[Cloudinary] failed to delete temp file ${filePath}:`, unlinkErr.message);
      }
    }

    console.log(`[Cloudinary] uploaded → ${result.secure_url}`);
    return result.secure_url;
  } catch (error) {
    console.error('[Cloudinary] upload error:', error.message || error);
    throw new Error(`Cloudinary upload failed: ${error.message || 'Unknown error'}`);
  }
};

const deleteFromCloudinary = async (url) => {
  if (!isCloudinaryUrl(url)) return;

  try {
    const parsed = parseCloudinaryUrl(url);
    if (!parsed) return;

    await cloudinary.uploader.destroy(parsed.publicId, {
      resource_type: parsed.resourceType,
    });
    console.log(`[Cloudinary] deleted → ${parsed.publicId}`);
  } catch (error) {
    console.error(`[Cloudinary] delete failed for ${url}:`, error.message || error);
  }
};

const assertCloudinaryDocumentPaths = (uploadedDocuments = []) => {
  for (const doc of uploadedDocuments) {
    if (!doc?.filePath) continue;
    if (isCloudinaryUrl(doc.filePath)) continue;
    if (doc.filePath.startsWith('http://') || doc.filePath.startsWith('https://')) continue;
    throw new Error(
      `Document "${doc.title || 'Unknown'}" must be stored on Cloudinary before saving`
    );
  }
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  downloadCloudinaryAsset,
  isConfigured,
  isCloudinaryUrl,
  isLocalUploadPath,
  isPdfCloudinaryUrl,
  getResourceType,
  getDocumentViewUrl,
  getDocumentDownloadUrl,
  checkPdfDeliveryEnabled,
  assertCloudinaryDocumentPaths,
  parseCloudinaryUrl,
};
