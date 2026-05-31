import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createAppointment,
  fetchAppointments,
  updateAppointmentStatus
} from '../services/appointmentService';
import {
  createPet,
  deletePet,
  fetchPetById,
  fetchPets,
  updatePet
} from '../services/petService';
import { useAuth } from './AuthContext';

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const { user } = useAuth();
  const [pets, setPets] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      if (!user) {
        setPets([]);
        setAppointments([]);
        return;
      }

      setLoading(true);
      setDataError('');

      try {
        const [petsResponse, appointmentsResponse] = await Promise.all([
          fetchPets(),
          fetchAppointments()
        ]);

        if (isMounted) {
          setPets(petsResponse.data);
          setAppointments(appointmentsResponse.data);
        }
      } catch (error) {
        if (isMounted) {
          setDataError(error?.response?.data?.message || 'Failed to load pet care data.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const refreshPets = async () => {
    const response = await fetchPets();
    setPets(response.data);
    return response.data;
  };

  const refreshAppointments = async () => {
    const response = await fetchAppointments();
    setAppointments(response.data);
    return response.data;
  };

  const getPetById = async (petId) => {
    const response = await fetchPetById(petId);
    return response.data;
  };

  const submitPet = async (petId, formData) => {
    const response = petId ? await updatePet(petId, formData) : await createPet(formData);
    await refreshPets();
    return response.data;
  };

  const removePet = async (petId, options = {}) => {
    const response = await deletePet(petId, options);
    await Promise.all([refreshPets(), refreshAppointments()]);
    return response.data;
  };

  const submitAppointment = async (payload) => {
    const response = await createAppointment(payload);
    await refreshAppointments();
    return response.data;
  };

  const changeAppointmentStatus = async (appointmentId, status) => {
    const response = await updateAppointmentStatus(appointmentId, status);
    await refreshAppointments();
    return response.data;
  };

  const value = useMemo(() => ({
    pets,
    appointments,
    loading,
    dataError,
    setDataError,
    getPetById,
    submitPet,
    removePet,
    submitAppointment,
    changeAppointmentStatus,
    refreshPets,
    refreshAppointments
  }), [pets, appointments, loading, dataError]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used inside AppDataProvider');
  }
  return context;
}
