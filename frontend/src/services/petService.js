import api from './api';

export async function fetchPets() {
  const { data } = await api.get('/pets');
  return data;
}

export async function fetchPetById(petId) {
  const { data } = await api.get(`/pets/${petId}`);
  return data;
}

export async function createPet(formData) {
  const { data } = await api.post('/pets', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

export async function updatePet(petId, formData) {
  const { data } = await api.put(`/pets/${petId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data;
}

export async function deletePet(petId, options = {}) {
  const { confirmDelete = false } = options;

  const { data } = await api.delete(`/pets/${petId}`, {
    data: { confirmDelete }
  });
  return data;
}
