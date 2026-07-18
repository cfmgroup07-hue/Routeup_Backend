const StudyAbroadLead = require('../models/StudyAbroadLead');
const AustraliaPRLead = require('../models/AustraliaPRLead');
const Booking = require('../models/Booking');
const Admin = require('../models/Admin');
const { isConfigured, isCloudinaryUrl, isLocalUploadPath } = require('./cloudinary');
const { resolveStoredFileUrl } = require('./resolveFileUrl');

const migrateStoredPath = async (storedPath, folderOverride) => {
  if (!storedPath || isCloudinaryUrl(storedPath) || !isLocalUploadPath(storedPath)) {
    return { path: storedPath, changed: false };
  }

  try {
    const cloudUrl = await resolveStoredFileUrl(storedPath, folderOverride);
    return { path: cloudUrl, changed: cloudUrl !== storedPath };
  } catch (error) {
    console.warn(`[Migrate] ${storedPath} → ${error.message}`);
    return { path: storedPath, changed: false, missing: true };
  }
};

const migrateLeadDocuments = async (lead, folder) => {
  let changed = false;
  for (const doc of lead.uploadedDocuments || []) {
    if (!doc?.filePath) continue;
    const result = await migrateStoredPath(doc.filePath, folder);
    if (result.changed) {
      doc.filePath = result.path;
      changed = true;
      console.log(`[Migrate] ${lead.name || lead._id} → ${doc.title} moved to Cloudinary`);
    } else if (result.missing && isLocalUploadPath(doc.filePath)) {
      doc.needsReupload = true;
      doc.reuploadNote =
        doc.reuploadNote ||
        'Original file could not be found on the server. Please upload this document again.';
      doc.filePath = '';
      changed = true;
      console.warn(`[Migrate] ${lead.name || lead._id} → ${doc.title} marked for re-upload (file missing)`);
    }
  }
  return changed;
};

const migrateLocalUploadsToCloudinary = async () => {
  if (!isConfigured) {
    console.warn('[Migrate] Cloudinary not configured — skipping local upload migration');
    return;
  }

  let updatedCount = 0;

  const studyLeads = await StudyAbroadLead.find({
    'uploadedDocuments.filePath': { $regex: '^/uploads/' },
  });
  for (const lead of studyLeads) {
    if (await migrateLeadDocuments(lead, 'study-abroad-docs')) {
      lead.markModified('uploadedDocuments');
      await lead.save();
      updatedCount += 1;
    }
  }

  const prLeads = await AustraliaPRLead.find({
    'uploadedDocuments.filePath': { $regex: '^/uploads/' },
  });
  for (const lead of prLeads) {
    if (await migrateLeadDocuments(lead, 'pr-docs')) {
      lead.markModified('uploadedDocuments');
      await lead.save();
      updatedCount += 1;
    }
  }

  const bookings = await Booking.find({
    $or: [
      { 'placementDetails.cvPath': { $regex: '^/uploads/' } },
      { 'postMeetingDetails.documentPath': { $regex: '^/uploads/' } },
      { 'postMeetingDetails.documentPaths': { $regex: '^/uploads/' } },
    ],
  });

  for (const booking of bookings) {
    let changed = false;

    if (booking.placementDetails?.cvPath) {
      const result = await migrateStoredPath(booking.placementDetails.cvPath, 'resumes');
      if (result.changed) {
        booking.placementDetails.cvPath = result.path;
        changed = true;
      }
    }

    if (booking.postMeetingDetails?.documentPath) {
      const result = await migrateStoredPath(booking.postMeetingDetails.documentPath, 'booking-docs');
      if (result.changed) {
        booking.postMeetingDetails.documentPath = result.path;
        changed = true;
      }
    }

    if (Array.isArray(booking.postMeetingDetails?.documentPaths)) {
      const nextPaths = [];
      for (const storedPath of booking.postMeetingDetails.documentPaths) {
        const result = await migrateStoredPath(storedPath, 'booking-docs');
        nextPaths.push(result.path);
        if (result.changed) changed = true;
      }
      booking.postMeetingDetails.documentPaths = nextPaths;
    }

    if (changed) {
      booking.markModified('placementDetails');
      booking.markModified('postMeetingDetails');
      await booking.save();
      updatedCount += 1;
      console.log(`[Migrate] booking ${booking.name || booking._id} files moved to Cloudinary`);
    }
  }

  const admins = await Admin.find({ avatar: { $regex: '^/uploads/' } });
  for (const admin of admins) {
    const result = await migrateStoredPath(admin.avatar, 'admin-avatars');
    if (result.changed) {
      admin.avatar = result.path;
      await admin.save();
      updatedCount += 1;
      console.log(`[Migrate] admin avatar ${admin.email} moved to Cloudinary`);
    }
  }

  if (updatedCount > 0) {
    console.log(`[Migrate] Completed — ${updatedCount} record(s) updated with Cloudinary URLs`);
  } else {
    console.log('[Migrate] No documents could be migrated (files may already be on Cloudinary or local copies are missing)');
  }
};

module.exports = { migrateLocalUploadsToCloudinary };
