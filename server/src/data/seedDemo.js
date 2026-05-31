import Appointment from '../models/Appointment.js';
import Pet from '../models/Pet.js';
import User from '../models/User.js';

export async function seedDemoData() {
  const demoEmail = 'demo@petcare.local';
  let user = await User.findOne({ email: demoEmail });

  if (user) {
    const existingPets = await Pet.countDocuments({ owner: user._id });
    const existingAppointments = await Appointment.countDocuments({ owner: user._id });

    if (existingPets > 0 || existingAppointments > 0) {
      return;
    }

    user.name = 'Piyush Bhandari';
    user.password = 'Demo123!';
    await user.save();
  } else {
    user = await User.create({
      name: 'Piyush Bhandari',
      email: demoEmail,
      password: 'Demo123!'
    });
  }

  const pets = await Pet.insertMany([
    {
      owner: user._id,
      name: 'Tommy',
      type: 'Dog',
      breed: 'German Shepherd',
      age: 5,
      photoUrl: 'https://placehold.co/800x600/fbbf24/ffffff?text=Tommy'
    },
    {
      owner: user._id,
      name: 'Pirro',
      type: 'Cat',
      breed: 'Persian Cat',
      age: 3,
      photoUrl: 'https://placehold.co/800x600/a78bfa/ffffff?text=Pirro'
    }
  ]);

  await Appointment.insertMany([
    {
      owner: user._id,
      pet: pets[0]._id,
      reason: 'Checkup',
      datetime: new Date('2025-08-15T10:30:00Z'),
      status: 'scheduled'
    },
    {
      owner: user._id,
      pet: pets[1]._id,
      reason: 'Grooming',
      datetime: new Date('2025-08-20T14:00:00Z'),
      status: 'scheduled'
    },
    {
      owner: user._id,
      pet: pets[0]._id,
      reason: 'Vaccination',
      datetime: new Date('2025-07-25T11:00:00Z'),
      status: 'completed'
    }
  ]);

  console.log('Demo data seeded');
}
