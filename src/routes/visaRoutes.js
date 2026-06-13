const express = require('express');
const router = express.Router();
const VisaPathway = require('../models/VisaPathway');
const { protect } = require('../middleware/authMiddleware');
const { 
  notifyVisaPathwayCreated, 
  notifyVisaPathwayUpdated, 
  notifyVisaPathwayDeleted 
} = require('../socket/socketHandler');

// @desc    Get all visa pathways
// @route   GET /api/visa-pathways
// @access  Public
router.get('/', async (req, res) => {
  try {
    const pathways = await VisaPathway.find({}).sort({ createdAt: 1 });
    res.json(pathways);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a new visa pathway
// @route   POST /api/visa-pathways
// @access  Private (Admin)
router.post('/', protect, async (req, res) => {
  const { countryName, countryFlag, visaTypes, description, docBadgeText } = req.body;

  try {
    if (!countryName || !countryFlag || !visaTypes || !description) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const visaTypesArray = typeof visaTypes === 'string'
      ? visaTypes.split(',').map(v => v.trim()).filter(Boolean)
      : visaTypes;

    const pathway = await VisaPathway.create({
      countryName,
      countryFlag,
      visaTypes: visaTypesArray,
      description,
      docBadgeText: docBadgeText || 'Detailed visa document provided'
    });

    // Broadcast creation
    notifyVisaPathwayCreated(pathway);

    res.status(201).json(pathway);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a visa pathway
// @route   PUT /api/visa-pathways/:id
// @access  Private (Admin)
router.put('/:id', protect, async (req, res) => {
  const { countryName, countryFlag, visaTypes, description, docBadgeText } = req.body;

  try {
    const pathway = await VisaPathway.findById(req.params.id);
    if (!pathway) {
      return res.status(404).json({ message: 'Visa pathway not found' });
    }

    if (countryName) pathway.countryName = countryName;
    if (countryFlag) pathway.countryFlag = countryFlag;
    if (description) pathway.description = description;
    if (docBadgeText !== undefined) pathway.docBadgeText = docBadgeText;
    
    if (visaTypes) {
      pathway.visaTypes = typeof visaTypes === 'string'
        ? visaTypes.split(',').map(v => v.trim()).filter(Boolean)
        : visaTypes;
    }

    await pathway.save();

    // Broadcast update
    notifyVisaPathwayUpdated(pathway);

    res.json(pathway);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete a visa pathway
// @route   DELETE /api/visa-pathways/:id
// @access  Private (Admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const pathway = await VisaPathway.findById(req.params.id);
    if (!pathway) {
      return res.status(404).json({ message: 'Visa pathway not found' });
    }

    await pathway.deleteOne();

    // Broadcast deletion
    notifyVisaPathwayDeleted(req.params.id);

    res.json({ message: 'Visa pathway removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
