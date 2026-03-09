document.addEventListener('DOMContentLoaded', () => {
    const usersTbody = document.getElementById('users-tbody');
    const spacesTbody = document.getElementById('spaces-tbody');
    const settingsForm = document.getElementById('settings-form');
    const maxUsersInput = document.getElementById('max-users-input');
    const exportDbBtn = document.getElementById('export-db-btn');
    const importDbForm = document.getElementById('import-db-form');
    const importDbInput = document.getElementById('import-db-input');

    async function loadAdminData() {
        try {
            // Load Settings
            const setRes = await fetch('/api/admin/settings');
            if (setRes.status === 401 || setRes.status === 403) {
                alert("Unauthorized");
                window.location.href = '/';
                return;
            }
            if (!setRes.ok) throw new Error('Failed to load settings');
            const data = await setRes.json();
            maxUsersInput.value = data.max_users;

            // Load Users
            const userRes = await fetch('/api/admin/users');
            if (!userRes.ok) throw new Error('Failed to load users');
            const userData = await userRes.json();
            renderUsers(userData.users);

            // Load Spaces
            const spaceRes = await fetch('/api/admin/spaces');
            if (spaceRes.ok) {
                const spaceData = await spaceRes.json();
                renderSpaces(spaceData.spaces);
            }

        } catch (e) {
            console.error(e);
            alert("Error loading admin dashboard");
        }
    }

    function renderUsers(users) {
        usersTbody.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');

            const profileCell = document.createElement('td');
            profileCell.className = "user-profile-cell";
            const img = document.createElement('img');
            img.src = u.picture || 'https://via.placeholder.com/32';
            img.className = 'user-avatar';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = u.name;
            profileCell.appendChild(img);
            profileCell.appendChild(nameSpan);

            const emailCell = document.createElement('td');
            emailCell.textContent = u.email;

            const roleCell = document.createElement('td');
            roleCell.textContent = u.role === 'admin' ? '⭐ Admin' : 'User';

            const countCell = document.createElement('td');
            countCell.textContent = u.todo_count;

            const actionCell = document.createElement('td');
            if (u.role !== 'admin') {
                const delBtn = document.createElement('button');
                delBtn.className = 'delete-btn';
                delBtn.textContent = 'Delete';
                delBtn.onclick = async () => {
                    if (confirm(`Are you sure you want to permanently delete user ${u.email}? All their tasks will be erased.`)) {
                        try {
                            const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                            if (res.ok) {
                                loadAdminData();
                            } else {
                                alert("Failed to delete user: " + (await res.json()).detail);
                            }
                        } catch (e) {
                            console.error(e);
                        }
                    }
                };
                actionCell.appendChild(delBtn);
            }

            tr.appendChild(profileCell);
            tr.appendChild(emailCell);
            tr.appendChild(roleCell);
            tr.appendChild(countCell);
            tr.appendChild(actionCell);

            usersTbody.appendChild(tr);
        });
    }

    function renderSpaces(spaces) {
        spacesTbody.innerHTML = '';
        spaces.forEach(s => {
            const tr = document.createElement('tr');

            const participantsCell = document.createElement('td');
            participantsCell.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="font-weight: 500; font-size: 1.05em; color: var(--accent); margin-bottom: 4px;">${s.name}</div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <img src="${s.user1_picture || 'https://via.placeholder.com/24'}" style="width: 24px; height: 24px; border-radius: 50%;">
                        <span>${s.user1_name || s.user1_email}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <img src="${s.user2_picture || 'https://via.placeholder.com/24'}" style="width: 24px; height: 24px; border-radius: 50%;">
                        <span>${s.user2_name || s.user2_email}</span>
                    </div>
                </div>
            `;

            const date = new Date(s.created_at + 'Z');
            const createdCell = document.createElement('td');
            createdCell.textContent = date.toLocaleDateString();

            const countCell = document.createElement('td');
            countCell.textContent = s.todo_count;

            const actionCell = document.createElement('td');
            const delBtn = document.createElement('button');
            delBtn.className = 'delete-btn';
            delBtn.textContent = 'Delete Space';
            delBtn.onclick = async () => {
                if (confirm(`Are you sure you want to permanently delete this shared space? All ${s.todo_count} tasks within it will be erased for both users.`)) {
                    try {
                        const res = await fetch(`/api/admin/spaces/${s.id}`, { method: 'DELETE' });
                        if (res.ok) {
                            loadAdminData();
                        } else {
                            alert("Failed to delete space: " + (await res.json()).detail);
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }
            };
            actionCell.appendChild(delBtn);

            tr.appendChild(participantsCell);
            tr.appendChild(createdCell);
            tr.appendChild(countCell);
            tr.appendChild(actionCell);

            spacesTbody.appendChild(tr);
        });
    }

    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const max = parseInt(maxUsersInput.value);
        if (max < 1) return alert("Must be at least 1");

        try {
            const res = await fetch('/api/admin/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ max_users: max })
            });
            if (res.ok) {
                alert("Settings saved successfully!");
            } else {
                alert("Failed to save settings: " + (await res.json()).detail);
            }
        } catch (e) {
            console.error(e);
        }
    });

    exportDbBtn.addEventListener('click', () => {
        window.location.href = '/api/admin/database/export';
    });

    importDbForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!confirm("WARNING: Importing a database will completely overwrite all existing tasks, users, and settings. Are you absolutely sure you want to proceed?")) {
            return;
        }

        const file = importDbInput.files[0];
        if (!file) return alert("Please select a file to import.");

        const formData = new FormData();
        formData.append('file', file);

        try {
            const btn = importDbForm.querySelector('button');
            btn.disabled = true;
            btn.innerHTML = 'Importing...';

            const res = await fetch('/api/admin/database/import', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                alert("Database successfully imported! Reloading data...");
                importDbForm.reset();
                loadAdminData();
            } else {
                const errorData = await res.json();
                alert("Failed to import database: " + errorData.detail);
            }
        } catch (e) {
            console.error(e);
            alert("An error occurred during import.");
        } finally {
            const btn = importDbForm.querySelector('button');
            btn.disabled = false;
            btn.innerHTML = '<ion-icon name="cloud-upload-outline" style="margin-right: 5px; vertical-align: middle;"></ion-icon> Import Database';
        }
    });

    loadAdminData();
});
