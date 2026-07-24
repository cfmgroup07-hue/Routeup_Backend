const {
  printSocketConnection,
  printSocketDisconnection,
  printSocketAdminJoin,
} = require('../utils/startupLogger');

let io = null;

const init = (ioInstance) => {
  io = ioInstance;

  io.on('connection', (socket) => {
    printSocketConnection(socket, io);

    socket.on('join_admin_room', () => {
      socket.join('admin_room');
      printSocketAdminJoin(socket);
    });

    socket.on('disconnect', (reason) => {
      printSocketDisconnection(socket, io, reason);
    });
  });

  console.log('[Socket.io] handler initialized — waiting for clients');
};

const notifyNewBooking = (booking) => {
  if (io) {
    io.to('admin_room').emit('new_booking', booking);
    console.log(`[Socket] emit → new_booking (${booking._id})`);
  }
};

const notifyBookingUpdate = (booking) => {
  if (io) {
    io.to('admin_room').emit('booking_updated', booking);
    console.log(`[Socket] emit → booking_updated (${booking._id})`);
  }
};

const notifyServiceCreated = (service) => {
  if (io) {
    io.emit('service_created', service);
    console.log(`[Socket] emit → service_created (${service._id})`);
  }
};

const notifyServiceUpdated = (service) => {
  if (io) {
    io.emit('service_updated', service);
    console.log(`[Socket] emit → service_updated (${service._id})`);
  }
};

const notifyServiceDeleted = (serviceId) => {
  if (io) {
    io.emit('service_deleted', serviceId);
    console.log(`[Socket] emit → service_deleted (${serviceId})`);
  }
};

const notifyVisaPathwayCreated = (pathway) => {
  if (io) {
    io.emit('visa_pathway_created', pathway);
    console.log(`[Socket] emit → visa_pathway_created (${pathway._id})`);
  }
};

const notifyVisaPathwayUpdated = (pathway) => {
  if (io) {
    io.emit('visa_pathway_updated', pathway);
    console.log(`[Socket] emit → visa_pathway_updated (${pathway._id})`);
  }
};

const notifyVisaPathwayDeleted = (pathwayId) => {
  if (io) {
    io.emit('visa_pathway_deleted', pathwayId);
    console.log(`[Socket] emit → visa_pathway_deleted (${pathwayId})`);
  }
};

const emitStudyAbroadLeadUpdated = (lead) => {
  if (io) {
    io.to('admin_room').emit('study_abroad_lead_updated', lead);
    console.log(`[Socket] emit → study_abroad_lead_updated (${lead._id})`);
  }
};

const emitNewStudyAbroadLead = (lead) => {
  if (io) {
    io.to('admin_room').emit('new_study_abroad_lead', lead);
    console.log(`[Socket] emit → new_study_abroad_lead (${lead._id})`);
  }
};

const emitStudyAbroadLeadDeleted = (leadId) => {
  if (io) {
    io.to('admin_room').emit('study_abroad_lead_deleted', leadId);
    console.log(`[Socket] emit → study_abroad_lead_deleted (${leadId})`);
  }
};

const emitAustraliaPrLeadUpdated = (lead) => {
  if (io) {
    io.to('admin_room').emit('australia_pr_lead_updated', lead);
    console.log(`[Socket] emit → australia_pr_lead_updated (${lead._id})`);
  }
};

const emitNewAustraliaPrLead = (lead) => {
  if (io) {
    io.to('admin_room').emit('new_australia_pr_lead', lead);
    console.log(`[Socket] emit → new_australia_pr_lead (${lead._id})`);
  }
};

const emitAustraliaPrLeadDeleted = (leadId) => {
  if (io) {
    io.to('admin_room').emit('australia_pr_lead_deleted', leadId);
    console.log(`[Socket] emit → australia_pr_lead_deleted (${leadId})`);
  }
};

const emitUniversityLeadUpdated = (lead) => {
  if (io) {
    io.to('admin_room').emit('university_lead_updated', lead);
    console.log(`[Socket] emit → university_lead_updated (${lead._id})`);
  }
};

const emitNewUniversityLead = (lead) => {
  if (io) {
    io.to('admin_room').emit('new_university_lead', lead);
    console.log(`[Socket] emit → new_university_lead (${lead._id})`);
  }
};

const emitUniversityLeadDeleted = (leadId) => {
  if (io) {
    io.to('admin_room').emit('university_lead_deleted', leadId);
    console.log(`[Socket] emit → university_lead_deleted (${leadId})`);
  }
};

const emitNewNotification = (notification) => {
  if (io) {
    io.to('admin_room').emit('new_notification', notification);
    console.log(`[Socket] emit → new_notification (${notification._id})`);
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
  emitNewStudyAbroadLead,
  emitStudyAbroadLeadDeleted,
  emitAustraliaPrLeadUpdated,
  emitNewAustraliaPrLead,
  emitAustraliaPrLeadDeleted,
  emitUniversityLeadUpdated,
  emitNewUniversityLead,
  emitUniversityLeadDeleted,
  emitNewNotification,
};
