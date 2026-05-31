import { useMemo, useState } from 'react';
import AppointmentCard from '../components/AppointmentCard';
import EmptyState from '../components/EmptyState';
import { useAppData } from '../context/AppDataContext';

const statuses = [
  { key: 'scheduled', title: 'Scheduled', tone: 'from-blue-500 to-blue-600' },
  { key: 'ongoing', title: 'Ongoing', tone: 'from-amber-500 to-yellow-500' },
  { key: 'completed', title: 'Completed', tone: 'from-emerald-500 to-green-500' }
];

export default function AppointmentBoardPage() {
  const { appointments, changeAppointmentStatus } = useAppData();
  const [draggingId, setDraggingId] = useState(null);

  const groupedAppointments = useMemo(() => {
    return statuses.reduce((accumulator, status) => {
      accumulator[status.key] = appointments.filter((appointment) => appointment.status === status.key);
      return accumulator;
    }, {});
  }, [appointments]);

  const handleDrop = async (event, status) => {
    event.preventDefault();
    const appointmentId = event.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    if (appointmentId) {
      await changeAppointmentStatus(appointmentId, status);
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[2rem] border border-white/80 p-6 md:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-violet-600">Tracking</p>
        <h1 className="font-display mt-3 text-3xl font-bold text-slate-950">Appointment board</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Drag cards between columns to update the appointment status in real time.
        </p>
      </section>

      {appointments.length ? (
        <div className="grid gap-5 xl:grid-cols-3">
          {statuses.map((status) => (
            <section
              key={status.key}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, status.key)}
              className="rounded-[2rem] bg-white/70 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 backdrop-blur"
            >
              <div className={`rounded-[1.5rem] bg-gradient-to-r ${status.tone} px-4 py-4 text-white`}>
                <p className="text-xs uppercase tracking-[0.3em] text-white/60">Column</p>
                <h2 className="font-display mt-1 text-2xl font-bold">{status.title}</h2>
                <p className="mt-1 text-sm text-white/80">{groupedAppointments[status.key].length} appointments</p>
              </div>
              <div className="mt-4 min-h-56 space-y-4 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 p-3">
                {groupedAppointments[status.key].length ? (
                  groupedAppointments[status.key].map((appointment) => (
                    <AppointmentCard
                      key={appointment._id}
                      appointment={appointment}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', appointment._id);
                        setDraggingId(appointment._id);
                      }}
                    />
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
                    Drop appointments here
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No appointments yet"
          message="Book a visit first, then move it through scheduled, ongoing, and completed as the care process advances."
          actionLabel="Book appointment"
          actionTo="/app/appointments/new"
        />
      )}
    </div>
  );
}
