import api from './api';

export async function fetchAppointments() {
  const { data } = await api.get('/appointments');
  return data;
}

export async function createAppointment(payload) {
  const { data } = await api.post('/appointments', payload);
  return data;
}

export async function updateAppointmentStatus(appointmentId, status) {
  const { data } = await api.patch(`/appointments/${appointmentId}/status`, { status });
  return data;
}
