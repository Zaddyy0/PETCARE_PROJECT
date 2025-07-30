// This is the main brain of our pet care application.
// We'll wait for the entire webpage to load before we start running any JavaScript.
// This prevents errors from trying to find elements that haven't been created yet.
document.addEventListener('DOMContentLoaded', () => {
    
    // =================================================================
    // SETUP: Grabbing all the HTML elements we need
    // =================================================================
    // Think of this section as gathering our tools. We're finding all the
    // important parts of our webpage (buttons, forms, pages) and giving them
    // easy names to use in our code.

    // The main "pages" or screens of our app
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    const pages = document.querySelectorAll('.page');

    // Login and Signup forms and buttons
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const showSignupBtn = document.getElementById('show-signup');
    const showLoginBtn = document.getElementById('show-login');
    const logoutBtn = document.getElementById('logout-btn');
    const userGreeting = document.getElementById('user-greeting'); // The "Hello, Piyush!" message

    // Dashboard elements
    const addPetBtn = document.getElementById('add-pet-btn');
    const petProfilesContainer = document.getElementById('pet-profiles-container'); // Where pet cards go
    const noPetsPlaceholder = document.getElementById('no-pets-placeholder'); // Message shown when no pets exist

    // The pop-up forms (modals) for adding and editing pets
    const addPetModal = document.getElementById('add-pet-modal');
    const petProfileForm = document.getElementById('pet-profile-form');
    const editPetModal = document.getElementById('edit-pet-modal');
    const editPetForm = document.getElementById('edit-pet-form');
    const cancelBtns = document.querySelectorAll('.cancel-btn'); // All "Cancel" buttons in the modals


    // =================================================================
    // STATE & DATA: The information our app needs to remember
    // =================================================================
    
    // This array will hold the list of pets for the current user.
    // It starts empty and we'll add to it.
    let userPets = []; 

    // This is our fake user database for the prototype.
    // When the user clicks "Log In", we'll pretend to find this user
    // and use their data to populate the dashboard.
    const mockUserData = {
        name: "Piyush Bhandari",
        pets: [
            { id: 1, name: 'Tommy', breed: 'German Shepherd', age: 5, photo: 'https://placehold.co/400x300/FBBF24/FFFFFF?text=Tommy' },
            { id: 2, name: 'PIRRO', breed: 'Persian Cat', age: 3, photo: 'https://placehold.co/400x300/A78BFA/FFFFFF?text=PIRRO' }
        ]
    };


    // =================================================================
    // CORE FUNCTIONS: The main actions our app can perform
    // =================================================================

    /**
     * Handles switching between the different pages of the app (e.g., from login to dashboard).
     * @param {string} pageIdToShow The ID of the HTML element for the page we want to display.
     */
    function showPage(pageIdToShow) {
        // First, hide all the pages.
        pages.forEach(page => page.classList.remove('active'));
        // Then, show only the one we want.
        document.getElementById(pageIdToShow)?.classList.add('active');
    }

    /**
     * Shows and hides the pop-up forms (modals) with a nice animation.
     * @param {HTMLElement} modal The specific modal element we want to show or hide.
     * @param {boolean} shouldShow True if we want to show the modal, false to hide it.
     */
    function toggleModal(modal, shouldShow) {
        const modalContent = modal.querySelector('.modal-content');
        if (shouldShow) {
            modal.classList.remove('hidden');
            // We use a tiny delay (10ms) to make sure the CSS animation plays correctly.
            setTimeout(() => modalContent.classList.add('active'), 10);
        } else {
            modalContent.classList.remove('active');
            // We wait for the fade-out animation to finish (200ms) before hiding the modal completely.
            setTimeout(() => modal.classList.add('hidden'), 200);
        }
    }

    /**
     * This function builds the pet profile cards and displays them on the dashboard.
     * It reads from our `userPets` array and creates an HTML card for each pet.
     */
    function renderPetProfiles() {
        // Clear out any old pet cards first.
        petProfilesContainer.innerHTML = ''; 
        
        // If there are no pets, show the placeholder message. Otherwise, hide it.
        noPetsPlaceholder.classList.toggle('hidden', userPets.length > 0);

        // Loop through each pet in our `userPets` array.
        userPets.forEach(pet => {
            // This is a template for a pet card. We fill in the details for each pet.
            const petCardHTML = `
                <div class="bg-white rounded-2xl shadow-lg overflow-hidden transform hover:-translate-y-2 transition-transform duration-300" data-pet-id="${pet.id}">
                    <img src="${pet.photo || 'https://placehold.co/400x300/CBD5E1/475569?text=My+Pet'}" alt="Photo of ${pet.name}" class="w-full h-48 object-cover" onerror="this.onerror=null;this.src='https://placehold.co/400x300/CBD5E1/475569?text=Image+Error';">
                    <div class="p-6">
                        <h3 class="text-2xl font-bold text-gray-800">${pet.name}</h3>
                        <p class="text-gray-600">${pet.breed}</p>
                        <div class="mt-4 flex items-center text-gray-500">
                            <i class="fas fa-birthday-cake mr-2 text-blue-500"></i>
                            <span>${pet.age} years old</span>
                        </div>
                        <div class="mt-4 flex justify-end space-x-2">
                            <button class="edit-btn text-sm text-gray-500 hover:text-blue-600 font-semibold py-1 px-3 rounded">Edit</button>
                            <button class="delete-btn text-sm text-red-500 hover:text-red-700 font-semibold py-1 px-3 rounded">Delete</button>
                        </div>
                    </div>
                </div>
            `;
            // Add the newly created card to our container on the webpage.
            petProfilesContainer.innerHTML += petCardHTML;
        });
    }


    // =================================================================
    // EVENT HANDLERS: What to do when the user clicks things
    // =================================================================
    // This is where we make our site interactive. We listen for clicks on
    // buttons and form submissions, and then we call the right function.

    // --- Login & Signup Flow ---

    // When the "Log In" button is clicked...
    loginForm.addEventListener('submit', (event) => {
        event.preventDefault(); // Prevents the page from reloading.
        // We'll simulate a successful login using our mock data.
        userPets = [...mockUserData.pets]; // Make a copy of the mock pets.
        userGreeting.textContent = `Hello, ${mockUserData.name}!`;
        renderPetProfiles();
        showPage('dashboard-page');
    });

    // When the "Create Account" button is clicked...
    signupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = document.getElementById('signup-name').value || "Piyush Bhandari";
        userPets = []; // A new user starts with no pets.
        userGreeting.textContent = `Hello, ${name}!`;
        renderPetProfiles();
        showPage('dashboard-page');
    });
    
    // When the "Logout" button is clicked...
    logoutBtn.addEventListener('click', () => {
        userPets = []; // Clear the pets
        loginForm.reset(); // Clear the form fields
        signupForm.reset();
        showPage('login-page'); // Go back to the login screen
    });

    // When "Sign up" or "Log in" links are clicked to switch forms...
    showSignupBtn.addEventListener('click', (e) => { e.preventDefault(); loginForm.classList.add('hidden'); signupForm.classList.remove('hidden'); });
    showLoginBtn.addEventListener('click', (e) => { e.preventDefault(); signupForm.classList.add('hidden'); loginForm.classList.remove('hidden'); });

    // --- Pet Management Flow ---

    // When the "Add New Pet" button is clicked, show the add pet modal.
    addPetBtn.addEventListener('click', () => toggleModal(addPetModal, true));

    // When the "Save Profile" button in the "Add Pet" modal is clicked...
    petProfileForm.addEventListener('submit', (event) => {
        event.preventDefault();
        // Create a new pet object from the form data.
        const newPet = {
            id: Date.now(), // Use the current time as a simple unique ID.
            name: document.getElementById('pet-name').value,
            breed: document.getElementById('pet-breed').value,
            age: document.getElementById('pet-age').value,
            photo: document.getElementById('pet-photo').value
        };
        userPets.push(newPet); // Add the new pet to our list.
        renderPetProfiles(); // Update the dashboard to show the new pet.
        petProfileForm.reset();
        toggleModal(addPetModal, false); // Hide the modal.
    });

    // This is a clever way to handle clicks on all Edit and Delete buttons,
    // even ones that we add later. It listens for clicks on the whole container.
    petProfilesContainer.addEventListener('click', (event) => {
        const card = event.target.closest('[data-pet-id]');
        if (!card) return; // If the click wasn't inside a pet card, do nothing.

        const petId = Number(card.dataset.petId);

        // If the Delete button was clicked...
        if (event.target.classList.contains('delete-btn')) {
            // Remove the pet from our array.
            userPets = userPets.filter(pet => pet.id !== petId);
            renderPetProfiles(); // Refresh the dashboard.
        }

        // If the Edit button was clicked...
        if (event.target.classList.contains('edit-btn')) {
            const petToEdit = userPets.find(pet => pet.id === petId);
            if (petToEdit) {
                // Fill the edit form with this pet's current details.
                document.getElementById('edit-pet-id').value = petToEdit.id;
                document.getElementById('edit-pet-name').value = petToEdit.name;
                document.getElementById('edit-pet-breed').value = petToEdit.breed;
                document.getElementById('edit-pet-age').value = petToEdit.age;
                document.getElementById('edit-pet-photo').value = petToEdit.photo;
                toggleModal(editPetModal, true); // Show the edit modal.
            }
        }
    });

    // When the "Update Profile" button in the "Edit Pet" modal is clicked...
    editPetForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const petId = Number(document.getElementById('edit-pet-id').value);
        const petIndex = userPets.findIndex(pet => pet.id === petId);

        if (petIndex !== -1) {
            // Update the pet's information in our array.
            userPets[petIndex] = {
                id: petId,
                name: document.getElementById('edit-pet-name').value,
                breed: document.getElementById('edit-pet-breed').value,
                age: document.getElementById('edit-pet-age').value,
                photo: document.getElementById('edit-pet-photo').value,
            };
            renderPetProfiles(); // Refresh the dashboard.
            toggleModal(editPetModal, false); // Hide the modal.
        }
    });

    // When any "Cancel" button is clicked, close both modals just in case.
    cancelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleModal(addPetModal, false);
            toggleModal(editPetModal, false);
        });
    });

    // =================================================================
    // INITIALIZATION: Starting the app
    // =================================================================
    // This is the very first thing that happens. We make sure the app starts
    // on the login page.
    showPage('login-page');
});
