const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const { protect } = require('../middleware/authMiddleware');
const { 
  notifyServiceCreated, 
  notifyServiceUpdated, 
  notifyServiceDeleted 
} = require('../socket/socketHandler');

// @desc    Get all services
// @route   GET /api/services
// @access  Public
router.get('/', async (req, res) => {
  try {
    const services = await Service.find({}).sort({ createdAt: 1 });
    res.json(services);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Create a new service
// @route   POST /api/services
// @access  Private (Admin)
router.post('/', protect, async (req, res) => {
  const { title, key, description, price, icon } = req.body;

  try {
    if (!title || !key || !description || price === undefined || !icon) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const serviceExists = await Service.findOne({ key: key.toLowerCase().trim() });
    if (serviceExists) {
      return res.status(400).json({ message: 'A service with this key already exists' });
    }

    const service = await Service.create({
      title,
      key: key.toLowerCase().trim(),
      description,
      price: Number(price),
      icon
    });

    // Broadcast creation
    notifyServiceCreated(service);

    res.status(201).json(service);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @desc    Update a service
// @route   PUT /api/services/:id
// @access  Private (Admin)
router.put('/:id', protect, async (req, res) => {
  const { title, key, description, price, icon } = req.body;

  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    if (key && key.toLowerCase().trim() !== service.key) {
      const keyExists = await Service.findOne({ key: key.toLowerCase().trim() });
      if (keyExists) {
        return res.status(400).json({ message: 'A service with this key already exists' });
      }
      service.key = key.toLowerCase().trim();
    }

    if (title) service.title = title;
    if (description) service.description = description;
    if (price !== undefined) service.price = Number(price);
    if (icon) service.icon = icon;

    await service.save();

    // Broadcast update
    notifyServiceUpdated(service);

    res.json(service);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Delete a service
// @route   DELETE /api/services/:id
// @access  Private (Admin)
router.delete('/:id', protect, async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    await service.deleteOne();

    // Broadcast deletion
    notifyServiceDeleted(req.params.id);

    res.json({ message: 'Service removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
