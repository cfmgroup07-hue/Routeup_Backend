/**
 * One-time script: upload Files/Student Vol 01-10.pdf to Cloudinary
 * and write public URLs into the frontend guides data file.
 *
 * Usage (from Routeup_Backend): node scripts/uploadGuidesToCloudinary.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const FILES_DIR = path.join(__dirname, '../../Files');
const OUT_FILE = path.join(
  __dirname,
  '../../Routeup_Frontend/src/data/studyAbroadGuides.js'
);

const VOLUMES = [
  {
    volume: 1,
    file: 'Student Vol 01.pdf',
    publicId: 'routeup-guides/student-vol-01',
    num: 'Volume 1',
    title: 'Making Informed Decisions About Studying Abroad',
    blurb:
      'Start here: why “I want to go abroad” is the wrong first sentence, and the four questions that replace it.',
  },
  {
    volume: 2,
    file: 'Student Vol 02.pdf',
    publicId: 'routeup-guides/student-vol-02',
    num: 'Volume 2',
    title: 'Choosing Your Country',
    blurb:
      'The honest 2026 comparison — including the refusal rates and green card queues nobody puts in a brochure.',
  },
  {
    volume: 3,
    file: 'Student Vol 03.pdf',
    publicId: 'routeup-guides/student-vol-03',
    num: 'Volume 3',
    title: 'The Real Cost of Studying Abroad',
    blurb:
      'Why a ₹40 lakh loan can become ₹1 crore, what a week abroad really costs, and the family budget worksheet.',
  },
  {
    volume: 4,
    file: 'Student Vol 04.pdf',
    publicId: 'routeup-guides/student-vol-04',
    num: 'Volume 4',
    title: 'Choosing the Right Course and University',
    blurb:
      'Ranking myths, commission-driven “recommendations,” and the straight-line rule that protects your career and PR.',
  },
  {
    volume: 5,
    file: 'Student Vol 05.pdf',
    publicId: 'routeup-guides/student-vol-05',
    num: 'Volume 5',
    title: 'The Application Playbook',
    blurb:
      'SOPs, references, the 12-month timeline — and exactly which parts you can do yourself for free.',
  },
  {
    volume: 6,
    file: 'Student Vol 06.pdf',
    publicId: 'routeup-guides/student-vol-06',
    num: 'Volume 6',
    title: 'Visa Interviews and Rejections',
    blurb:
      '40% of Indian applications to Australia are refused. The five reasons why — and the fix for each.',
  },
  {
    volume: 7,
    file: 'Student Vol 07.pdf',
    publicId: 'routeup-guides/student-vol-07',
    num: 'Volume 7',
    title: 'Your First 90 Days Abroad',
    blurb:
      'Housing, money, safety, and the part-time job reality — the survival manual for after you land.',
  },
  {
    volume: 8,
    file: 'Student Vol 08.pdf',
    publicId: 'routeup-guides/student-vol-08',
    num: 'Volume 8',
    title: 'Getting Your First Job Abroad',
    blurb:
      'Why mass applications fail, and the direct method that gets interviews: research, named managers, tailored emails.',
  },
  {
    volume: 9,
    file: 'Student Vol 09.pdf',
    publicId: 'routeup-guides/student-vol-09',
    num: 'Volume 9',
    title: 'From Student to Permanent Residency',
    blurb:
      'PR is designed backwards from day one. The honest pathway map for Canada, Australia, UK, Germany, and the USA.',
  },
  {
    volume: 10,
    file: 'Student Vol 10.pdf',
    publicId: 'routeup-guides/student-vol-10',
    num: 'Volume 10 · For Parents',
    title: 'The Parents’ Guide',
    blurb:
      'For the real decision-makers: the money conversation, six questions to ask any consultancy, and how to protect your child from a distance.',
    featured: true,
  },
];

const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function main() {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error('Cloudinary env vars missing in Routeup_Backend/.env');
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const uploaded = [];

  for (const vol of VOLUMES) {
    const localPath = path.join(FILES_DIR, vol.file);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Missing file: ${localPath}`);
    }

    console.log(`Uploading ${vol.file} → ${vol.publicId} ...`);
    const result = await cloudinary.uploader.upload(localPath, {
      resource_type: 'image',
      public_id: vol.publicId,
      overwrite: true,
      invalidate: true,
      use_filename: false,
      unique_filename: false,
    });

    const viewUrl = result.secure_url;
    const downloadUrl = cloudinary.url(result.public_id, {
      resource_type: 'image',
      type: 'upload',
      format: 'pdf',
      flags: 'attachment',
      secure: true,
    });

    uploaded.push({
      ...vol,
      viewUrl,
      downloadUrl,
      downloadName: `RouteUp-${vol.file.replace(/\s+/g, '-')}`,
    });

    console.log(`  ✓ ${viewUrl}`);
  }

  const body = uploaded
    .map(
      (vol) => `  {
    volume: ${vol.volume},
    num: '${escape(vol.num)}',
    title: '${escape(vol.title)}',
    blurb: '${escape(vol.blurb)}',
    featured: ${vol.featured ? 'true' : 'false'},
    viewUrl: '${escape(vol.viewUrl)}',
    downloadUrl: '${escape(vol.downloadUrl)}',
    downloadName: '${escape(vol.downloadName)}',
  }`
    )
    .join(',\n');

  const fileContents = `/** Auto-generated by Routeup_Backend/scripts/uploadGuidesToCloudinary.js — do not edit URLs by hand. */
export const STUDY_ABROAD_GUIDE_VOLUMES = [
${body},
];
`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, fileContents, 'utf8');
  console.log(`\nWrote ${OUT_FILE}`);
  console.log('Done. You can remove the Files/ folder when ready.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
