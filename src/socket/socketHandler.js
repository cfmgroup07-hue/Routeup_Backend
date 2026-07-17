let io = null;

const init = (ioInstance) => {
  io = ioInstance;
  
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    socket.on('join_admin_room', () => {
      socket.join('admin_room');
      console.log(`Socket ${socket.id} joined admin_room`);
    });
    
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
};

const notifyNewBooking = (booking) => {
  if (io) {
    io.to('admin_room').emit('new_booking', booking);
    console.log(`Socket event emitted: new_booking for ID ${booking._id}`);
  }
};

const notifyBookingUpdate = (booking) => {
  if (io) {
    io.to('admin_room').emit('booking_updated', booking);
    console.log(`Socket event emitted: booking_updated for ID ${booking._id}`);
  }
};

const notifyServiceCreated = (service) => {
  if (io) {
    io.emit('service_created', service);
    console.log(`Socket event: service_created for ID ${service._id}`);
  }
};

const notifyServiceUpdated = (service) => {
  if (io) {
    io.emit('service_updated', service);
    console.log(`Socket event: service_updated for ID ${service._id}`);
  }
};

const notifyServiceDeleted = (serviceId) => {
  if (io) {
    io.emit('service_deleted', serviceId);
    console.log(`Socket event: service_deleted for ID ${serviceId}`);
  }
};

const notifyVisaPathwayCreated = (pathway) => {
  if (io) {
    io.emit('visa_pathway_created', pathway);
    console.log(`Socket event: visa_pathway_created for ID ${pathway._id}`);
  }
};

const notifyVisaPathwayUpdated = (pathway) => {
  if (io) {
    io.emit('visa_pathway_updated', pathway);
    console.log(`Socket event: visa_pathway_updated for ID ${pathway._id}`);
  }
};

const notifyVisaPathwayDeleted = (pathwayId) => {
  if (io) {
    io.emit('visa_pathway_deleted', pathwayId);
    console.log(`Socket event: visa_pathway_deleted for ID ${pathwayId}`);
  }
};

const emitStudyAbroadLeadUpdated = (lead) => {
  if (io) {
    io.to('admin_room').emit('study_abroad_lead_updated', lead);
    console.log(`Socket event emitted: study_abroad_lead_updated for ID ${lead._id}`);
  }
};

const emitAustraliaPrLeadUpdated = (lead) => {
  if (io) {
    io.to('admin_room').emit('australia_pr_lead_updated', lead);
    console.log(`Socket event emitted: australia_pr_lead_updated for ID ${lead._id}`);
  }
};

const emitNewNotification = (notification) => {
  if (io) {
    io.to('admin_room').emit('new_notification', notification);
    console.log(`Socket event emitted: new_notification for ID ${notification._id}`);
  }
};

module.exports = {
  init,
  notifyNewBooking,
  notifyBookingUpdate,
  notifyServiceCreated,
  notifyServiceUpdated,
  notifyServiceDeleted,
  notifyVisaPathwayCreated,
  notifyVisaPathwayUpdated,
  notifyVisaPathwayDeleted,
  emitStudyAbroadLeadUpdated,
  emitAustraliaPrLeadUpdated,
  emitNewNotification,
};

