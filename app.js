// Wait for the entire webpage to load before running any JavaScript.
// This prevents errors from trying to interact with elements that haven't been created yet.
document.addEventListener('DOMContentLoaded', () => {
    
    // =================================================================
    // SETUP: Grabbing all the HTML elements we'll need to work with.
    // =================================================================
    // We find all important parts of the webpage (buttons, forms, pages) 
    // and give them easy-to-use variable names.

    // --- App Sections ---
    const loginPage = document.getElementById('login-page');
    const mainAppContainer = document.getElementById('main-app-container');
    const pages = document.querySelectorAll('.main-page');
    const navBtns = document.querySelectorAll('.nav-btn');

    // --- Authentication ---
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const showSignupBtn = document.getElementById('show-signup');
    const showLoginBtn = document.getElementById('show-login');
    const logoutBtn = document.getElementById('logout-btn');
    const userGreeting = document.getElementById('user-greeting');

    // --- Dashboard ---
    const petProfilesContainer = document.getElementById('pet-profiles-container');
    const noPetsPlaceholder = document.getElementById('no-pets-placeholder');

    // --- Pet Profile Page ---
    const petProfilePage = document.getElementById('pet-profile-page');

    // --- Add/Edit Pet Page (The "Setup" page) ---
    const petProfileForm = document.getElementById('pet-profile-form');
    const editPetIdInput = document.getElementById('edit-pet-id');
    const photoPreview = document.getElementById('photoPreview');
    const petPhotoInput = document.getElementById('petPhoto');
    const setupFormTitle = document.getElementById('setup-form-title');
    const setupFormSubmitBtn = document.getElementById('setup-form-submit-btn');

    // --- Appointment Page ---
    const appointmentForm = document.getElementById('appointmentForm');
    const appointmentPetSelect = document.getElementById('appointment-pet-select');

    // --- Appointment Tracking Page ---
    const appointmentColumns = document.querySelectorAll('.appointment-column');
    const noAppointmentsPlaceholder = document.getElementById('no-appointments-placeholder');

    // --- Modals ---
    const successModal = document.getElementById('success-modal');
    const successModalTitle = document.getElementById('success-modal-title');
    const successModalMessage = document.getElementById('success-modal-message');
    const successModalCloseBtn = document.getElementById('success-modal-close-btn');

    // =================================================================
    // STATE & DATA: The information our app needs to remember.
    // =================================================================
    
    let userPets = []; 
    let userAppointments = [];
    let currentUser = null;

    // This is a mock user database for demonstration.
    const mockUserData = {
        name: "Piyush Bhandari",
        pets: [
            { id: 1, name: 'Tommy', type: 'Dog', breed: 'German Shepherd', age: 5, photo: 'https://placehold.co/400x300/FBBF24/FFFFFF?text=Tommy' },
            { id: 2, name: 'Pirro', type: 'Cat', breed: 'Persian Cat', age: 3, photo: 'https://placehold.co/400x300/A78BFA/FFFFFF?text=Pirro' }
        ],
        appointments: [
            { id: 101, petName: 'Tommy', reason: 'Checkup', datetime: '2025-08-15T10:30', status: 'scheduled' },
            { id: 102, petName: 'Pirro', reason: 'Grooming', datetime: '2025-08-20T14:00', status: 'scheduled' },
            { id: 103, petName: 'Tommy', reason: 'Vaccination', datetime: '2025-07-25T11:00', status: 'completed' }
        ]
    };

    // =================================================================
    // CORE FUNCTIONS: The main actions our app can perform.
    // =================================================================

    /**
     * Switches between the main pages of the app (Dashboard, Add Pet, etc.).
     * @param {string} pageIdToShow The ID of the HTML element for the page to display.
     */
    function showMainPage(pageIdToShow) {
        pages.forEach(page => page.classList.remove('active'));
        const pageToShow = document.getElementById(pageIdToShow);
        if (pageToShow) pageToShow.classList.add('active');
        
        navBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageIdToShow);
        });
    }
    
    /**
     * Shows or hides the main app sections (the login page vs. the main application).
     * @param {string} sectionId The ID of the section to show ('login-page' or 'main-app-container').
     */
    function showAppSection(sectionId) {
        document.getElementById('login-page').classList.remove('active');
        document.getElementById('main-app-container').classList.remove('active');
        const sectionToShow = document.getElementById(sectionId);
        if(sectionToShow) sectionToShow.classList.add('active');
    }

    /**
     * Displays a success modal with a custom title and message.
     * @param {string} title The title for the modal.
     * @param {string} message The message for the modal.
     */
    function showSuccessModal(title, message) {
        const modalContent = successModal.querySelector('.modal-content');
        successModalTitle.textContent = title;
        successModalMessage.textContent = message;
        successModal.classList.remove('hidden');
        setTimeout(() => modalContent.classList.add('active'), 10);
    }

    /**
     * Hides the success modal with an animation.
     */
    function hideSuccessModal() {
        const modalContent = successModal.querySelector('.modal-content');
        modalContent.classList.remove('active');
        setTimeout(() => successModal.classList.add('hidden'), 200);
    }

    /**
     * Renders the pet profile cards on the dashboard.
     */
    function renderPetProfiles() {
        petProfilesContainer.innerHTML = ''; 
        noPetsPlaceholder.classList.toggle('hidden', userPets.length > 0);
        userPets.forEach(pet => {
            const petCardHTML = `
                <div class="bg-white rounded-2xl shadow-lg overflow-hidden transform hover:-translate-y-2 transition-transform duration-300 cursor-pointer" data-pet-id="${pet.id}">
                    <img src="${pet.photo || 'https://placehold.co/400x300/CBD5E1/475569?text=My+Pet'}" alt="Photo of ${pet.name}" class="w-full h-48 object-cover" onerror="this.onerror=null;this.src='https://placehold.co/400x300/CBD5E1/475569?text=Image+Error';">
                    <div class="p-6">
                        <h3 class="text-2xl font-bold text-gray-800">${pet.name}</h3>
                        <p class="text-gray-600">${pet.breed || pet.type}</p>
                        <div class="mt-4 flex items-center text-gray-500">
                            <i class="fas fa-birthday-cake mr-2 text-purple-500"></i>
                            <span>${pet.age} years old</span>
                        </div>
                    </div>
                </div>
            `;
            petProfilesContainer.insertAdjacentHTML('beforeend', petCardHTML);
        });
    }

    /**
     * Renders the appointment cards on the tracking board.
     */
    function renderAppointments() {
        // Clear all columns first
        appointmentColumns.forEach(col => col.innerHTML = '');
        
        // Show placeholder if no appointments exist
        noAppointmentsPlaceholder.classList.toggle('hidden', userAppointments.length > 0);

        userAppointments.forEach(appt => {
            const pet = userPets.find(p => p.name === appt.petName);
            const petPhoto = pet ? pet.photo : 'https://placehold.co/100/CBD5E1/475569?text=?';
            const formattedDate = new Date(appt.datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            const appointmentCardHTML = `
                <div class="appointment-card bg-white p-4 rounded-lg shadow-md cursor-grab" draggable="true" data-appt-id="${appt.id}">
                    <div class="flex items-start space-x-3">
                        <img src="${petPhoto}" class="w-12 h-12 rounded-full object-cover border-2 border-gray-200" onerror="this.onerror=null;this.src='https://placehold.co/100/CBD5E1/475569?text=Pet';">
                        <div>
                            <p class="font-bold text-gray-800">${appt.petName}</p>
                            <p class="text-sm text-gray-600">${appt.reason}</p>
                            <p class="text-xs text-gray-500 mt-1"><i class="far fa-clock mr-1"></i>${formattedDate}</p>
                        </div>
                    </div>
                </div>
            `;
            const column = document.querySelector(`.appointment-column[data-status="${appt.status}"]`);
            if(column) {
                column.insertAdjacentHTML('beforeend', appointmentCardHTML);
            }
        });

        // Add drag listeners to the newly rendered cards
        addDragListenersToCards();
    }
    
    /**
     * Renders the detailed view for a single pet on its own page.
     * @param {number} petId The ID of the pet to display.
     */
    function renderPetProfilePage(petId) {
        const pet = userPets.find(p => p.id === petId);
        if (!pet) return;

        const profileHTML = `
            <div class="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl p-8">
                <div class="flex flex-col md:flex-row gap-8">
                    <div class="md:w-1/3 text-center">
                        <img src="${pet.photo || 'https://placehold.co/400x300/CBD5E1/475569?text=My+Pet'}" alt="Photo of ${pet.name}" class="w-48 h-48 mx-auto rounded-full object-cover shadow-lg border-4 border-purple-200" onerror="this.onerror=null;this.src='https://placehold.co/400x300/CBD5E1/475569?text=Image+Error';">
                        <h2 class="text-3xl font-bold text-gray-800 mt-4">${pet.name}</h2>
                        <p class="text-gray-600 text-lg">${pet.breed || pet.type}</p>
                    </div>
                    <div class="md:w-2/3">
                        <h3 class="text-2xl font-bold text-gray-800 border-b pb-2 mb-4">Pet Details</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-gray-700 text-lg">
                            <div><strong>Age:</strong> ${pet.age} years</div>
                            <div><strong>Type:</strong> ${pet.type}</div>
                        </div>
                        <div class="mt-8 flex justify-end space-x-4">
                            <button class="edit-btn-profile px-6 py-2 text-white font-semibold bg-blue-600 rounded-lg hover:bg-blue-700 transition-transform transform hover:scale-105" data-pet-id="${pet.id}"><i class="fas fa-edit mr-2"></i>Edit</button>
                            <button class="delete-btn-profile px-6 py-2 text-white font-semibold bg-red-500 rounded-lg hover:bg-red-600 transition-transform transform hover:scale-105" data-pet-id="${pet.id}"><i class="fas fa-trash mr-2"></i>Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        petProfilePage.innerHTML = profileHTML;
        showMainPage('pet-profile-page');
    }
    
    /**
     * Populates the pet selection dropdown in the appointment form with the user's pets.
     */
    function populateAppointmentPetSelect() {
        appointmentPetSelect.innerHTML = '<option value="">Select your pet</option>';
        userPets.forEach(pet => {
            const option = document.createElement('option');
            option.value = pet.name;
            option.textContent = pet.name;
            appointmentPetSelect.appendChild(option);
        });
    }

    /**
     * Adds drag-and-drop event listeners to appointment cards.
     */
    function addDragListenersToCards() {
        const cards = document.querySelectorAll('.appointment-card');
        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                card.classList.add('dragging');
                e.dataTransfer.setData('text/plain', card.dataset.apptId);
            });
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });
        });
    }
    
    // =================================================================
    // EVENT HANDLERS: Making the site interactive.
    // =================================================================

    // --- Authentication Flow ---
    loginForm.addEventListener('submit', (event) => {
        event.preventDefault();
        currentUser = { ...mockUserData };
        userPets = [...currentUser.pets];
        userAppointments = [...currentUser.appointments];
        userGreeting.textContent = `Hello, ${currentUser.name}!`;
        renderPetProfiles();
        renderAppointments();
        populateAppointmentPetSelect();
        showAppSection('main-app-container');
        showMainPage('dashboard-page');
    });

    signupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = document.getElementById('signup-name').value;
        currentUser = { name, pets: [], appointments: [] };
        userPets = [];
        userAppointments = [];
        userGreeting.textContent = `Hello, ${name}!`;
        renderPetProfiles();
        renderAppointments();
        populateAppointmentPetSelect();
        showAppSection('main-app-container');
        showMainPage('dashboard-page');
    });

    logoutBtn.addEventListener('click', () => {
        userPets = [];
        userAppointments = [];
        currentUser = null;
        loginForm.reset();
        signupForm.reset();
        showAppSection('login-page');
    });

    showSignupBtn.addEventListener('click', (e) => { e.preventDefault(); loginForm.classList.add('hidden'); signupForm.classList.remove('hidden'); });
    showLoginBtn.addEventListener('click', (e) => { e.preventDefault(); signupForm.classList.add('hidden'); loginForm.classList.remove('hidden'); });

    // --- Main Navigation ---
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const pageId = btn.dataset.page;
            if (pageId === 'setup-page') {
                petProfileForm.reset();
                editPetIdInput.value = '';
                photoPreview.innerHTML = '<i class="fas fa-plus text-3xl text-gray-400"></i>';
                setupFormTitle.textContent = 'Create Your Pet Profile';
                setupFormSubmitBtn.innerHTML = '<i class="fas fa-check"></i><span>Create Pet Profile</span>';
            }
            showMainPage(pageId);
        });
    });
    
    // --- Appointment Board Drag-and-Drop ---
    appointmentColumns.forEach(column => {
        column.addEventListener('dragover', e => {
            e.preventDefault();
            column.classList.add('drag-over');
        });
        column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
        column.addEventListener('drop', e => {
            e.preventDefault();
            column.classList.remove('drag-over');
            const apptId = Number(e.dataTransfer.getData('text/plain'));
            const newStatus = column.dataset.status;
            const appointment = userAppointments.find(a => a.id === apptId);
            if (appointment) {
                appointment.status = newStatus;
                renderAppointments(); // Re-render the entire board to reflect the change
            }
        });
    });

    // --- Dashboard Interaction ---
    petProfilesContainer.addEventListener('click', (event) => {
        const card = event.target.closest('[data-pet-id]');
        if (card) {
            const petId = Number(card.dataset.petId);
            renderPetProfilePage(petId);
        }
    });

    // --- Pet Profile Page Interaction (Edit/Delete) ---
    petProfilePage.addEventListener('click', (event) => {
        const petId = Number(event.target.dataset.petId);
        if (event.target.classList.contains('edit-btn-profile')) {
            const petToEdit = userPets.find(p => p.id === petId);
            if (petToEdit) {
                editPetIdInput.value = petToEdit.id;
                document.getElementById('petName').value = petToEdit.name;
                document.getElementById('petType').value = petToEdit.type;
                document.getElementById('breed').value = petToEdit.breed;
                document.getElementById('age').value = petToEdit.age;
                photoPreview.innerHTML = petToEdit.photo ? `<img src="${petToEdit.photo}" alt="Pet photo" class="w-full h-full object-cover rounded-full">` : '<i class="fas fa-plus text-3xl text-gray-400"></i>';
                setupFormTitle.textContent = 'Edit Pet Profile';
                setupFormSubmitBtn.innerHTML = '<i class="fas fa-save"></i><span>Update Profile</span>';
                showMainPage('setup-page');
            }
        }
        if (event.target.classList.contains('delete-btn-profile')) {
            if (confirm('Are you sure you want to delete this pet profile? This action cannot be undone.')) {
                userPets = userPets.filter(p => p.id !== petId);
                renderPetProfiles();
                populateAppointmentPetSelect();
                showMainPage('dashboard-page');
            }
        }
    });

    // --- Add/Edit Pet Form (Setup Page) ---
    petPhotoInput.addEventListener("change", function (e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                photoPreview.innerHTML = `<img src="${e.target.result}" alt="Pet photo" class="w-full h-full object-cover rounded-full">`;
            };
            reader.readAsDataURL(file);
        }
    });

    petProfileForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const petId = Number(editPetIdInput.value);
        const reader = new FileReader();
        const photoFile = petPhotoInput.files[0];

        const savePetData = (photoDataUrl) => {
             const petData = {
                name: document.getElementById('petName').value,
                type: document.getElementById('petType').value,
                breed: document.getElementById('breed').value,
                age: document.getElementById('age').value,
                photo: photoDataUrl,
            };
            let successTitle = '';
            let successMessage = '';
            if (petId) {
                const petIndex = userPets.findIndex(p => p.id === petId);
                if (petIndex !== -1) {
                    if (!petData.photo) petData.photo = userPets[petIndex].photo;
                    userPets[petIndex] = { ...userPets[petIndex], ...petData };
                    successTitle = 'Profile Updated!';
                    successMessage = `${petData.name}'s profile has been successfully updated.`;
                }
            } else {
                petData.id = Date.now();
                userPets.push(petData);
                successTitle = 'Profile Created!';
                successMessage = `${petData.name}'s profile has been successfully created.`;
            }
            renderPetProfiles();
            populateAppointmentPetSelect();
            showSuccessModal(successTitle, successMessage);
            showMainPage('dashboard-page');
        };

        if (photoFile) {
            reader.onload = e => savePetData(e.target.result);
            reader.readAsDataURL(photoFile);
        } else {
            savePetData(petId ? userPets.find(p=>p.id === petId)?.photo : null);
        }
    });

    // --- Appointment Form ---
    appointmentForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const newAppointment = {
            id: Date.now(),
            petName: document.getElementById('appointment-pet-select').value,
            reason: document.getElementById('appointment-reason').value,
            datetime: document.getElementById('appointment-datetime').value,
            status: 'scheduled' // Default status for new appointments
        };
        userAppointments.push(newAppointment);
        renderAppointments();
        showSuccessModal('Appointment Booked!', 'Your appointment has been successfully scheduled.');
        appointmentForm.reset();
        showMainPage('track-appointment-page');
    });

    // --- Modal Close Button ---
    successModalCloseBtn.addEventListener('click', hideSuccessModal);
});
