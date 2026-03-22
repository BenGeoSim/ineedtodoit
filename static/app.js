document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('todo-list');
    const rootInput = document.getElementById('new-todo-input');
    const rootTagsInput = document.getElementById('new-todo-tags');
    const addRootBtn = document.getElementById('add-todo-btn');
    const template = document.getElementById('todo-template');
    const filterContainer = document.getElementById('tag-filters');
    const priorityFilterContainer = document.getElementById('priority-filters');

    let todos = [];
    let selectedTag = null;
    let selectedPriority = null;
    let viewingTrash = false;
    let currentSpaceId = null;
    let sharedSpaces = [];
    let currentUserProfile = null;

    // Persist sort preference per space
    const getSortPreference = () => {
        const key = `sort_pref_${currentSpaceId || 'personal'}`;
        return localStorage.getItem(key) || 'created';
    };

    let sortBy = getSortPreference();

    // Theme switcher
    function applyTheme(name) {
        document.documentElement.dataset.theme = name || 'dark';
        localStorage.setItem('theme', name || 'dark');
        document.querySelectorAll('.theme-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.theme === (name || 'dark'));
        });
    }
    applyTheme(localStorage.getItem('theme') || 'dark');
    document.querySelectorAll('.theme-swatch').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyTheme(btn.dataset.theme);
        });
    });

    // Tags visibility toggle
    let tagsHidden = localStorage.getItem('tags_hidden') === 'true';

    function applyTagsVisibility() {
        listEl.classList.toggle('tags-hidden', tagsHidden);
        const btn = document.getElementById('toggle-tags-btn');
        if (btn) {
            btn.classList.toggle('tags-hidden-active', tagsHidden);
            btn.title = tagsHidden ? 'Show tags on tasks' : 'Hide tags on tasks';
        }
    }

    applyTagsVisibility();

    const setSortPreference = (val) => {
        sortBy = val;
        const key = `sort_pref_${currentSpaceId || 'personal'}`;
        localStorage.setItem(key, val);
    };

    function updateGlobalTodo(id, changes) {
        const globalTodo = todos.find(t => t.id === id);
        if (globalTodo) {
            Object.assign(globalTodo, changes);
        }
    }

    // Fetch initial data
    async function loadTodos() {
        try {
            // First check session and get profile
            const authRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
            if (authRes.status === 401) {
                document.getElementById('login-overlay').classList.remove('hidden');
                return;
            }
            if (!authRes.ok) throw new Error('Auth response was not ok');
            const authData = await authRes.json();
            currentUserProfile = authData.user;

            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('user-profile').classList.remove('hidden');
            document.getElementById('logout-btn').classList.remove('hidden');
            document.getElementById('user-name').textContent = currentUserProfile.name || currentUserProfile.email;
            if (currentUserProfile.picture) {
                document.getElementById('user-avatar').src = currentUserProfile.picture;
            }
            if (currentUserProfile.role === 'admin') {
                document.getElementById('admin-dashboard-btn').classList.remove('hidden');
            }

            await fetchSpaces();
            await fetchTodos();
        } catch (e) {
            console.error('Failed to load initial data', e);
        }
    }

    async function fetchSpaces() {
        try {
            const res = await fetch('/api/shared_spaces', { credentials: 'same-origin' });
            if (res.ok) {
                sharedSpaces = await res.json();
                renderSpaceSelector();
            }
        } catch (e) { console.error('Failed to load spaces', e); }
    }

    function updateTagline() {
        const taglineEl = document.getElementById('header-tagline');
        const renameBtn = document.getElementById('rename-space-btn');
        if (!taglineEl) return;

        const addMemberBtn = document.getElementById('add-member-btn');
        if (currentSpaceId === null) {
            taglineEl.textContent = 'Limitless nesting, seamless syncing.';
            if (renameBtn) renameBtn.classList.add('hidden');
            if (addMemberBtn) addMemberBtn.classList.add('hidden');
        } else {
            const space = sharedSpaces.find(s => s.id === currentSpaceId);
            if (space) {
                const members = space.members || [
                    { name: space.user1_name, email: space.user1_email },
                    { name: space.user2_name, email: space.user2_email }
                ];
                const names = members.map(m => m.name || m.email).join(', ');
                taglineEl.textContent = `${space.name} • ${names}`;
                if (renameBtn) renameBtn.classList.remove('hidden');
                if (addMemberBtn) addMemberBtn.classList.remove('hidden');
            }
        }
    }

    function renderSpaceSelector() {
        const spaceList = document.getElementById('space-list');
        const currentSpaceBtn = document.getElementById('space-menu-btn');
        const currentSpaceIcon = document.getElementById('current-space-icon');

        // Update the main toggle button's icon based on current space
        if (currentSpaceId === null) {
            currentSpaceIcon.name = 'person-outline';
        } else {
            currentSpaceIcon.name = 'people-outline';
        }

        // Rebuild space list
        spaceList.innerHTML = '';

        // Personal Tasks option
        const personalBtn = document.createElement('button');
        personalBtn.className = `dropdown-item space-item ${currentSpaceId === null ? 'active' : ''}`;
        personalBtn.dataset.id = 'personal';
        personalBtn.innerHTML = '<ion-icon name="person-outline"></ion-icon> <span>Personal Tasks</span>';
        spaceList.appendChild(personalBtn);

        sharedSpaces.forEach(space => {
            const spaceBtn = document.createElement('button');
            spaceBtn.className = `dropdown-item space-item ${currentSpaceId === space.id ? 'active' : ''}`;
            spaceBtn.dataset.id = space.id;
            spaceBtn.innerHTML = `<ion-icon name="people-outline"></ion-icon> <span>${space.name}</span>`;
            spaceList.appendChild(spaceBtn);
        });

        // Add click listeners to all space items
        const spaceItems = document.querySelectorAll('.space-item');
        spaceItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const val = item.dataset.id;
                currentSpaceId = val === 'personal' ? null : val;
                sortBy = getSortPreference(); // Load preference for new space

                // Close dropdown
                document.getElementById('space-dropdown-menu').classList.remove('show');

                // fetch todos for the new space
                fetchTodos();

                // Update active state in list
                renderSpaceSelector();
            });
        });

        updateTagline();
    }

    // Dropdown toggle logic
    const spaceMenuBtn = document.getElementById('space-menu-btn');
    const spaceDropdownMenu = document.getElementById('space-dropdown-menu');

    spaceMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        spaceDropdownMenu.classList.toggle('show');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!spaceDropdownMenu.contains(e.target) && e.target !== spaceMenuBtn) {
            spaceDropdownMenu.classList.remove('show');
        }
    });

    async function fetchTodos() {
        try {
            const url = currentSpaceId ? `/api/todos?space_id=${currentSpaceId}` : '/api/todos';
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) throw new Error('Todos response was not ok');

            todos = await res.json();
            render();
        } catch (e) {
            console.error('Failed to load todos', e);
        }
    }

    // Sync todos periodically without interrupting user input
    async function syncTodos() {
        try {
            const activeEl = document.activeElement;
            const isEditing = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.isContentEditable
            );

            if (isEditing) return; // Pause sync while user is interacting

            await fetchSpaces();

            const url = currentSpaceId ? `/api/todos?space_id=${currentSpaceId}` : '/api/todos';
            const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
            if (res.status === 401) {
                document.getElementById('login-overlay').classList.remove('hidden');
                document.getElementById('user-profile').classList.add('hidden');
                document.getElementById('logout-btn').classList.add('hidden');
                return;
            }

            const newTodos = await res.json();

            if (JSON.stringify(todos) !== JSON.stringify(newTodos)) {
                todos = newTodos;
                render();
            }
        } catch (e) {
            console.error('Failed to sync todos', e);
        }
    }

    // Start polling every 3 seconds
    setInterval(syncTodos, 3000);

    // Process tags string into array
    function processTags(tagString) {
        if (!tagString || !tagString.trim()) return [];
        return tagString.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }

    // Collect all unique tags from todos
    function getAllUniqueTags() {
        const tagSet = new Set();
        todos.forEach(item => {
            if (!item.deleted && item.tags && Array.isArray(item.tags)) {
                item.tags.forEach(t => tagSet.add(t));
            }
        });
        return Array.from(tagSet).sort();
    }

    // Build hierarchical tree for rendering
    function buildTree(items) {
        const rootItems = [];
        const lut = {};

        items.forEach(item => {
            lut[item.id] = { ...item, children: [] };
        });

        items.forEach(item => {
            if (item.parent_id) {
                if (lut[item.parent_id]) {
                    lut[item.parent_id].children.push(lut[item.id]);
                }
            } else {
                rootItems.push(lut[item.id]);
            }
        });

        // Sort levels
        const sortFn = (a, b) => {
            if (sortBy === 'priority') {
                // Priority ascending (1 is highest), if equal then created
                if (a.priority !== b.priority) {
                    return (a.priority || 3) - (b.priority || 3);
                }
            } else if (sortBy === 'due_date') {
                // Tasks with no due date go to the bottom
                const aDate = a.due_date || null;
                const bDate = b.due_date || null;
                if (aDate && bDate) return aDate.localeCompare(bDate);
                if (aDate) return -1;
                if (bDate) return 1;
            }
            // Default to created_at
            return (a.created_at || '').localeCompare(b.created_at || '');
        };

        const sortItemsRecursive = (list) => {
            list.sort(sortFn);
            list.forEach(i => {
                if (i.children && i.children.length > 0) {
                    sortItemsRecursive(i.children);
                }
            });
        };

        sortItemsRecursive(rootItems);

        return rootItems;
    }

    // Autocomplete Logic
    function setupAutocomplete(inputElement, dropdownElement) {
        inputElement.addEventListener('input', () => {
            const val = inputElement.value;
            const parts = val.split(',');
            const currentPart = parts[parts.length - 1].trimLeft();

            if (!currentPart) {
                dropdownElement.classList.add('hidden');
                return;
            }

            const allTags = getAllUniqueTags();
            // Match substring, avoid exactly matching tags we just typed fully
            const matches = allTags.filter(t => t.toLowerCase().includes(currentPart.toLowerCase()) && t.toLowerCase() !== currentPart.toLowerCase());

            if (matches.length === 0) {
                dropdownElement.classList.add('hidden');
                return;
            }

            dropdownElement.innerHTML = '';
            matches.forEach(match => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.textContent = match;
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // prevent blur
                    parts[parts.length - 1] = (parts.length > 1 ? ' ' : '') + match;
                    inputElement.value = parts.join(',') + ', ';
                    dropdownElement.classList.add('hidden');
                    inputElement.focus();
                });
                dropdownElement.appendChild(item);
            });

            dropdownElement.classList.remove('hidden');
        });

        inputElement.addEventListener('blur', () => {
            dropdownElement.classList.add('hidden');
        });

        inputElement.addEventListener('focus', () => {
            inputElement.dispatchEvent(new Event('input'));
        });
    }

    // Helper to determine if an item matches the tag filter
    // Returns true if the item, any descendant, or any ancestor has the tag
    function passesTagFilter(item, targetTag, matchedAncestor = false) {
        if (!targetTag) return true; // No filter selected

        // 1. If an ancestor has it, then we implicitly show this item (we show the whole sub-tree of a matched item)
        if (matchedAncestor) return true;

        // 2. Does this item have the tag?
        const hasTag = item.tags && Array.isArray(item.tags) && item.tags.includes(targetTag);

        if (hasTag) return true;

        // 3. Does any descendant have the tag? We peek through children recursively.
        if (item.children && item.children.length > 0) {
            return item.children.some(child => passesTagFilter(child, targetTag, false));
        }

        return false;
    }

    function passesPriorityFilter(item, targetPriority, matchedAncestor = false) {
        if (!targetPriority) return true; // No filter selected

        // 1. If an ancestor has it, then we implicitly show this item (we show the whole sub-tree of a matched item)
        if (matchedAncestor) return true;

        // 2. Does this item have the priority?
        if (parseInt(item.priority) === parseInt(targetPriority)) return true;

        // 3. Does any descendant have the priority?
        if (item.children && item.children.length > 0) {
            return item.children.some(child => passesPriorityFilter(child, targetPriority, false));
        }

        return false;
    }

    function renderFilters() {
        const tags = getAllUniqueTags();
        filterContainer.innerHTML = '';

        if (tags.length === 0) {
            filterContainer.style.display = 'none';
            return;
        }

        filterContainer.style.display = 'flex';

        // Add toggle-tags button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'toggle-tags-btn';
        toggleBtn.className = 'action-btn';
        toggleBtn.innerHTML = '<ion-icon name="pricetag-outline"></ion-icon>';
        toggleBtn.style.fontSize = '1.1rem';
        toggleBtn.classList.toggle('tags-hidden-active', tagsHidden);
        toggleBtn.title = tagsHidden ? 'Show tags on tasks' : 'Hide tags on tasks';
        toggleBtn.addEventListener('click', () => {
            tagsHidden = !tagsHidden;
            localStorage.setItem('tags_hidden', tagsHidden);
            applyTagsVisibility();
        });
        filterContainer.appendChild(toggleBtn);

        // Add "All tags" badge
        const allBadge = document.createElement('span');
        allBadge.className = 'filter-badge all-tags-badge';
        if (selectedTag === null) allBadge.classList.add('active');
        allBadge.textContent = 'All tags';
        allBadge.addEventListener('click', () => {
            selectedTag = null;
            rootTagsInput.value = ''; // clear input when deselecting filter
            render();
        });
        filterContainer.appendChild(allBadge);

        // Add dynamic tags
        tags.forEach(tag => {
            const badge = document.createElement('span');
            badge.className = 'filter-badge tag-filter-badge';
            if (selectedTag === tag) badge.classList.add('active');
            badge.textContent = tag;
            badge.addEventListener('click', () => {
                selectedTag = tag;

                // Pre-fill the root input with this tag so new tasks get it automatically
                let currentVal = rootTagsInput.value;
                if (!currentVal) {
                    rootTagsInput.value = tag + ', ';
                } else if (!currentVal.includes(tag)) {
                    rootTagsInput.value = currentVal.endsWith(', ') ? currentVal + tag + ', ' : currentVal + ', ' + tag + ', ';
                }

                render();
            });
            filterContainer.appendChild(badge);
        });
    }

    function renderPriorityFilters() {
        // Build 5 priority filters
        priorityFilterContainer.innerHTML = '';
        priorityFilterContainer.style.display = 'flex';

        // Add "All Priorities" badge
        const allBadge = document.createElement('span');
        allBadge.className = 'filter-badge all-priorities-badge';
        if (selectedPriority === null) allBadge.classList.add('active');
        allBadge.textContent = 'All Priorities';
        allBadge.addEventListener('click', () => {
            selectedPriority = null;
            render();
        });
        priorityFilterContainer.appendChild(allBadge);

        for (let i = 1; i <= 5; i++) {
            const badge = document.createElement('span');
            badge.className = 'filter-badge';
            if (selectedPriority === i) badge.classList.add('active');
            badge.title = `Priority ${i}`;
            badge.style.display = 'flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '6px';

            // tiny dot
            const d = document.createElement('div');
            d.className = `priority-dot priority-${i}`;
            d.dataset.prio = i - 1;
            d.style.marginRight = '0';
            d.style.width = '8px';
            d.style.height = '8px';
            d.style.cursor = 'pointer';

            badge.prepend(d);

            badge.addEventListener('click', () => {
                selectedPriority = i;
                render();
            });
            priorityFilterContainer.appendChild(badge);
        }
    }

    function renderSortFilters() {
        const sortContainer = document.getElementById('sort-filters');
        if (!sortContainer) return;

        sortContainer.innerHTML = '';
        const options = [
            { id: 'created', label: 'Created Date' },
            { id: 'priority', label: 'Priority' },
            { id: 'due_date', label: 'Due Date' }
        ];

        options.forEach(opt => {
            const badge = document.createElement('span');
            badge.className = 'filter-badge sort-filter-badge';
            if (sortBy === opt.id) badge.classList.add('active');
            badge.textContent = opt.label;
            badge.addEventListener('click', () => {
                setSortPreference(opt.id);
                render();
            });
            sortContainer.appendChild(badge);
        });
    }

    function render() {
        listEl.innerHTML = '';
        renderSortFilters();
        renderFilters();
        renderPriorityFilters();

        if (viewingTrash) {
            const trashTodos = todos.filter(t => t.deleted === true);
            trashTodos.forEach(item => {
                listEl.appendChild(createTodoElement(item, false));
            });
            return;
        }

        const activeTodos = todos.filter(t => t.deleted !== true);
        const tree = buildTree(activeTodos);

        tree.forEach(item => {
            if (passesTagFilter(item, selectedTag, false) && passesPriorityFilter(item, selectedPriority, false)) {
                // Pass a generic matchesAncestor flag down
                const isTagMatched = selectedTag && item.tags && Array.isArray(item.tags) && item.tags.includes(selectedTag);
                const isPriorityMatched = selectedPriority && item.priority === selectedPriority;

                listEl.appendChild(createTodoElement(item, isTagMatched, isPriorityMatched));
            }
        });
    }

    function createTodoElement(item, ancestorTagMatched, ancestorPriorityMatched) {
        const clone = template.content.cloneNode(true);
        const li = clone.querySelector('.todo-item');
        li.dataset.id = item.id;

        const textEl = clone.querySelector('.text');
        textEl.textContent = item.text;

        // Render Priority Dot
        const priorityDot = clone.querySelector('.priority-dot');
        const prio = item.priority || 3;
        priorityDot.classList.add(`priority-${prio}`);
        priorityDot.dataset.prio = prio - 1;

        // Render Creator Badge (Initials)
        const creatorBadge = clone.querySelector('.creator-badge');
        let nameToUse = item.creator_name || item.creator_email || '';
        // Fallback for optimistic updates locally
        if (!nameToUse && currentUserProfile) {
            nameToUse = currentUserProfile.name || currentUserProfile.email || '';
        }

        if (nameToUse) {
            // Get up to 2 initials
            const words = nameToUse.split(/[ @.]+/).filter(w => w.trim().length > 0);
            let initials = '';
            if (words.length >= 2) {
                initials = (words[0][0] + words[1][0]).toUpperCase();
            } else if (words.length === 1) {
                initials = words[0].substring(0, 2).toUpperCase();
            }

            if (initials) {
                creatorBadge.textContent = initials;
                creatorBadge.title = `Created by ${nameToUse}`;
                creatorBadge.classList.remove('hidden');
            }
        }

        priorityDot.addEventListener('click', async (e) => {
            e.stopPropagation();
            const currentPrio = item.priority || 3;
            let newPriority = currentPrio + 1;
            if (newPriority > 5) newPriority = 1;

            priorityDot.classList.remove(`priority-${currentPrio}`);
            priorityDot.classList.add(`priority-${newPriority}`);
            priorityDot.dataset.prio = newPriority - 1;

            item.priority = newPriority;
            updateGlobalTodo(item.id, { priority: newPriority });

            try {
                const res = await fetch(`/api/todos/${item.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ priority: newPriority })
                });
                if (res.status === 401) { window.location.reload(); return; }
                if (!res.ok) throw new Error('API failed');
            } catch (err) {
                console.error('Failed to save priority', err);
                // revert
                item.priority = currentPrio;
                updateGlobalTodo(item.id, { priority: currentPrio });
                priorityDot.classList.remove(`priority-${newPriority}`);
                priorityDot.classList.add(`priority-${currentPrio}`);
                priorityDot.dataset.prio = currentPrio - 1;
            }
        });

        // Render Tags
        const tagsContainer = clone.querySelector('.tag-badges');
        if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
            item.tags.forEach(tag => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'item-tag';
                tagSpan.textContent = tag;

                const removeIcon = document.createElement('span');
                removeIcon.className = 'remove-tag';
                removeIcon.innerHTML = '<ion-icon name="close-circle"></ion-icon>';
                removeIcon.title = 'Remove tag';

                removeIcon.addEventListener('click', async (e) => {
                    e.stopPropagation(); // prevent toggling expanded state if we click on it

                    // Filter out this specific tag
                    const newTags = item.tags.filter(t => t !== tag);
                    item.tags = newTags;
                    updateGlobalTodo(item.id, { tags: newTags });

                    // Optimistic update
                    render();

                    try {
                        const res = await fetch(`/api/todos/${item.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ tags: newTags })
                        });
                        if (res.status === 401) window.location.reload();
                    } catch (err) {
                        console.error('Failed to update tags', err);
                    }
                });

                tagSpan.appendChild(removeIcon);
                tagsContainer.appendChild(tagSpan);
            });
        }

        // Due Date
        const dueBadge = clone.querySelector('.due-date-badge');
        const dueDateInput = clone.querySelector('.due-date-input');

        const priorityColors = {
            1: { color: '#ef4444', rgb: '239,68,68' },
            2: { color: '#f97316', rgb: '249,115,22' },
            3: { color: '#eab308', rgb: '234,179,8' },
            4: { color: '#3b82f6', rgb: '59,130,246' },
            5: { color: '#64748b', rgb: '100,116,139' },
        };

        function renderDueBadge() {
            if (!item.due_date) {
                dueBadge.classList.add('hidden');
                return;
            }
            const due = new Date(item.due_date + 'T00:00:00');
            const today = new Date(); today.setHours(0,0,0,0);
            const diffMs = due - today;
            const diffDays = Math.ceil(diffMs / 86400000);

            let label;
            if (diffDays === 0) label = 'Today';
            else if (diffDays === 1) label = 'Tomorrow';
            else if (diffDays === -1) label = 'Yesterday';
            else {
                const opts = { month: 'short', day: 'numeric' };
                if (due.getFullYear() !== today.getFullYear()) opts.year = '2-digit';
                label = due.toLocaleDateString(undefined, opts);
            }

            dueBadge.textContent = label;
            dueBadge.classList.remove('hidden', 'due-urgent', 'due-overdue');
            dueBadge.style.removeProperty('--due-prio-color');
            dueBadge.style.removeProperty('--due-prio-rgb');

            if (diffDays < 0) {
                dueBadge.classList.add('due-overdue');
            } else if (diffDays < 7) {
                const prio = item.priority || 3;
                const pc = priorityColors[prio] || priorityColors[3];
                dueBadge.style.setProperty('--due-prio-color', pc.color);
                dueBadge.style.setProperty('--due-prio-rgb', pc.rgb);
                dueBadge.classList.add('due-urgent');
            }
        }

        renderDueBadge();

        function openDuePicker() {
            dueDateInput.value = item.due_date || '';
            dueDateInput.classList.remove('hidden');
            dueBadge.classList.add('hidden');
            dueDateInput.showPicker?.();
            dueDateInput.focus();
        }

        async function saveDueDate(val) {
            dueDateInput.classList.add('hidden');
            const newDate = val || null;
            item.due_date = newDate;
            updateGlobalTodo(item.id, { due_date: newDate });
            renderDueBadge();
            try {
                const res = await fetch(`/api/todos/${item.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ due_date: newDate || '' })
                });
                if (res.status === 401) window.location.reload();
            } catch (err) { console.error('Failed to save due date', err); }
        }

        dueDateInput.addEventListener('change', (e) => { saveDueDate(e.target.value); });
        dueDateInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { dueDateInput.classList.add('hidden'); renderDueBadge(); }
            if (e.key === 'Enter') { saveDueDate(e.target.value); }
        });

        const setDueDateBtn = clone.querySelector('.action-btn.set-due-date');
        setDueDateBtn.addEventListener('click', (e) => { e.stopPropagation(); openDuePicker(); });

        const moveToSpaceBtn = clone.querySelector('.action-btn.move-to-space');
        moveToSpaceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            taskMenuWrapper.classList.remove('open');
            openMoveSpaceDialog(item);
        });

        const toggleBtn = clone.querySelector('.toggle-children');
        const childList = clone.querySelector('.nested-list');

        if (item.completed) {
            li.classList.add('completed');
        }

        // Check if we matched the filters. If so, descendants are implicit.
        const isSelfTagMatched = selectedTag && item.tags && Array.isArray(item.tags) && item.tags.includes(selectedTag);
        const matchesAncestorTag = ancestorTagMatched || isSelfTagMatched;

        const isSelfPriorityMatched = selectedPriority && item.priority === selectedPriority;
        const matchesAncestorPriority = ancestorPriorityMatched || isSelfPriorityMatched;

        // Handle Children display logic
        if (item.children && item.children.length > 0) {

            let hasVisibleChildren = false;

            item.children.forEach(child => {
                if (passesTagFilter(child, selectedTag, matchesAncestorTag) && passesPriorityFilter(child, selectedPriority, matchesAncestorPriority)) {
                    hasVisibleChildren = true;
                    childList.appendChild(createTodoElement(child, matchesAncestorTag, matchesAncestorPriority));
                }
            });

            if (hasVisibleChildren) {
                toggleBtn.classList.remove('hidden');
                // Expand if not completed or if we are filtering
                if (!item.completed || selectedTag || selectedPriority) {
                    toggleBtn.classList.add('expanded');
                    childList.classList.add('expanded');
                }
            }
        }

        // Toggle Expand
        toggleBtn.addEventListener('click', () => {
            toggleBtn.classList.toggle('expanded');
            childList.classList.toggle('expanded');
        });

        // Completion Toggle
        const checkbox = clone.querySelector('.checkbox');
        checkbox.addEventListener('click', async () => {
            const newCompleted = !item.completed;
            item.completed = newCompleted;
            updateGlobalTodo(item.id, { completed: newCompleted });
            li.classList.toggle('completed', newCompleted);

            try {
                const res = await fetch(`/api/todos/${item.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ completed: newCompleted })
                });
                if (res.status === 401) { window.location.reload(); return; }
                if (!res.ok) throw new Error('API failed');
            } catch (e) {
                console.error(e);
                item.completed = !newCompleted;
                updateGlobalTodo(item.id, { completed: !newCompleted });
                li.classList.toggle('completed', !newCompleted);
                alert('Failed to save completion status.');
            }
        });

        // Task hamburger menu toggle
        const taskMenuWrapper = clone.querySelector('.task-menu-wrapper');
        const taskMenuBtn = clone.querySelector('.task-menu-btn');
        const actionsEl = clone.querySelector('.actions');

        taskMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = taskMenuWrapper.classList.toggle('open');
            if (isOpen) {
                // Close any other open menus
                document.querySelectorAll('.task-menu-wrapper.open').forEach(w => {
                    if (w !== taskMenuWrapper) w.classList.remove('open');
                });
            }
        });

        // Close menu when an action button inside is clicked
        actionsEl.addEventListener('click', () => {
            taskMenuWrapper.classList.remove('open');
        });

        // Close on outside click (delegated at document level, attached per item)
        document.addEventListener('click', (e) => {
            if (!taskMenuWrapper.contains(e.target)) {
                taskMenuWrapper.classList.remove('open');
            }
        });

        // Edit Action
        const editBtn = clone.querySelector('.action-btn.edit');
        editBtn.addEventListener('click', () => {
            textEl.contentEditable = true;
            textEl.focus();

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(textEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        textEl.addEventListener('blur', async () => {
            textEl.contentEditable = false;
            const newText = textEl.textContent.trim();
            if (newText && newText !== item.text) {
                item.text = newText;
                updateGlobalTodo(item.id, { text: newText });
                try {
                    const res = await fetch(`/api/todos/${item.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ text: newText })
                    });
                    if (res.status === 401) window.location.reload();
                } catch (e) { console.error(e) }
            } else {
                textEl.textContent = item.text; // revert
            }
        });

        textEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                textEl.blur();
            }
        });

        // Restore Action
        const restoreBtn = clone.querySelector('.action-btn.restore');
        if (viewingTrash) {
            restoreBtn.classList.remove('hidden');
        }

        restoreBtn.addEventListener('click', async () => {
            li.classList.add('deleting');
            item.deleted = false;
            updateGlobalTodo(item.id, { deleted: false });
            setTimeout(() => { render(); }, 300);
            try {
                const res = await fetch(`/api/todos/${item.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ deleted: false })
                });
                if (res.status === 401) window.location.reload();
            } catch (e) { console.error(e) }
        });

        // Delete Action
        const deleteBtn = clone.querySelector('.action-btn.delete');
        deleteBtn.addEventListener('click', async () => {
            li.classList.add('deleting');

            if (viewingTrash) {
                try {
                    const res = await fetch(`/api/todos/${item.id}`, { method: 'DELETE', credentials: 'same-origin' });
                    if (res.status === 401) window.location.reload();
                    setTimeout(() => {
                        loadTodos();
                    }, 300);
                } catch (e) { console.error(e) }
            } else {
                item.deleted = true;
                updateGlobalTodo(item.id, { deleted: true });
                setTimeout(() => { render(); }, 300);
                try {
                    const res = await fetch(`/api/todos/${item.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ deleted: true })
                    });
                    if (res.status === 401) window.location.reload();
                } catch (e) { console.error(e) }
            }
        });

        // Inline Add Tag Action
        const addTagBtn = clone.querySelector('.action-btn.add-tag');
        const addTagGroup = clone.querySelector('.add-tag-group');
        const inlineTagsInput = clone.querySelector('.inline-tags-input');
        const inlineTagsDropdown = addTagGroup.querySelector('.tag-autocomplete-dropdown');
        const saveTagBtn = clone.querySelector('.save-tag-btn');
        const cancelTagBtn = clone.querySelector('.cancel-tag-btn');

        setupAutocomplete(inlineTagsInput, inlineTagsDropdown);

        addTagBtn.addEventListener('click', () => {
            addTagGroup.classList.remove('hidden');
            inlineTagsInput.focus();
        });

        cancelTagBtn.addEventListener('click', () => {
            addTagGroup.classList.add('hidden');
            inlineTagsInput.value = '';
        });

        async function submitTags() {
            const newTagsInputStr = inlineTagsInput.value.trim();
            if (!newTagsInputStr) {
                cancelTagBtn.click();
                return;
            }

            const newlyParsedTags = processTags(newTagsInputStr);
            const currentObjTags = item.tags || [];

            // Merge and deduplicate
            const tagSet = new Set([...currentObjTags, ...newlyParsedTags]);
            const finalTags = Array.from(tagSet);

            item.tags = finalTags;
            updateGlobalTodo(item.id, { tags: finalTags });
            render(); // optimistic render

            try {
                const res = await fetch(`/api/todos/${item.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ tags: finalTags })
                });
                if (res.status === 401) window.location.reload();
            } catch (e) {
                console.error(e);
            }
        }

        saveTagBtn.addEventListener('click', submitTags);
        inlineTagsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitTags();
            if (e.key === 'Escape') cancelTagBtn.click();
        });

        // Description Panel Logic
        const descToggleBtn = clone.querySelector('.action-btn.description-toggle');
        const descIndicator = clone.querySelector('.description-indicator');
        const descPanel = clone.querySelector('.description-panel');
        const descContent = clone.querySelector('.description-content');
        const descEditBtn = clone.querySelector('.description-edit-btn');
        const descSaveBtn = clone.querySelector('.description-save-btn');
        const descCancelBtn = clone.querySelector('.description-cancel-btn');

        // Set initial content
        const currentDesc = item.description || '';
        descContent.textContent = currentDesc;

        // Highlight button and show indicator if description exists
        if (currentDesc.trim()) {
            descToggleBtn.classList.add('has-description');
            descIndicator.classList.remove('hidden');
        }

        const toggleDesc = (e) => {
            e.stopPropagation();
            descPanel.classList.toggle('hidden');
        };
        descToggleBtn.addEventListener('click', toggleDesc);
        descIndicator.addEventListener('click', toggleDesc);

        descEditBtn.addEventListener('click', () => {
            descContent.contentEditable = true;
            descContent.focus();
            descEditBtn.classList.add('hidden');
            descSaveBtn.classList.remove('hidden');
            descCancelBtn.classList.remove('hidden');

            // Place cursor at end
            const range = document.createRange();
            range.selectNodeContents(descContent);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        descCancelBtn.addEventListener('click', () => {
            descContent.contentEditable = false;
            descContent.textContent = item.description || '';
            descEditBtn.classList.remove('hidden');
            descSaveBtn.classList.add('hidden');
            descCancelBtn.classList.add('hidden');
        });

        async function saveDescription() {
            const newDesc = descContent.textContent.trim();
            descContent.contentEditable = false;
            descEditBtn.classList.remove('hidden');
            descSaveBtn.classList.add('hidden');
            descCancelBtn.classList.add('hidden');

            if (newDesc !== (item.description || '')) {
                item.description = newDesc;
                updateGlobalTodo(item.id, { description: newDesc });

                // Update toggle button highlight and indicator
                if (newDesc) {
                    descToggleBtn.classList.add('has-description');
                    descIndicator.classList.remove('hidden');
                } else {
                    descToggleBtn.classList.remove('has-description');
                    descIndicator.classList.add('hidden');
                }

                try {
                    const res = await fetch(`/api/todos/${item.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ description: newDesc })
                    });
                    if (res.status === 401) window.location.reload();
                } catch (err) {
                    console.error('Failed to save description', err);
                }
            }
        }

        descSaveBtn.addEventListener('click', saveDescription);
        descContent.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') descCancelBtn.click();
        });

        // Add Child Action
        const addChildBtn = clone.querySelector('.action-btn.add-child');
        const childInputGroup = clone.querySelector('.child-input-group');
        const childInput = clone.querySelector('.child-input');
        const childTagsInput = clone.querySelector('.child-tags-input');
        const childDropdown = childInputGroup.querySelector('.tag-autocomplete-dropdown');
        const saveChildBtn = clone.querySelector('.save-child-btn');
        const cancelChildBtn = clone.querySelector('.cancel-child-btn');

        setupAutocomplete(childTagsInput, childDropdown);

        addChildBtn.addEventListener('click', () => {
            childInputGroup.classList.remove('hidden');
            childInput.focus();

            // Expand children if we add a child
            toggleBtn.classList.remove('hidden');
            toggleBtn.classList.add('expanded');
            childList.classList.add('expanded');
        });

        cancelChildBtn.addEventListener('click', () => {
            childInputGroup.classList.add('hidden');
            childInput.value = '';
            childTagsInput.value = '';
        });

        async function submitChild() {
            const text = childInput.value.trim();
            const tags = processTags(childTagsInput.value);
            if (text) {
                const newId = crypto.randomUUID();
                const defaultPrio = selectedPriority || 3;
                const newTodo = { id: newId, parent_id: item.id, text, completed: false, tags, priority: defaultPrio, space_id: currentSpaceId };
                todos.push(newTodo);
                updateGlobalTodo(newTodo.id, newTodo); // Added for consistency
                render(); // optimistic render

                try {
                    const res = await fetch('/api/todos', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify(newTodo)
                    });
                    if (res.status === 401) { window.location.reload(); return; }
                    if (!res.ok) throw new Error('API failed');
                } catch (e) {
                    console.error(e);
                    todos = todos.filter(t => t.id !== newId);
                    render();
                    alert('Failed to save nested todo.');
                }
            }
        }

        saveChildBtn.addEventListener('click', submitChild);
        childInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitChild();
            if (e.key === 'Escape') cancelChildBtn.click();
        });
        childTagsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitChild();
            if (e.key === 'Escape') cancelChildBtn.click();
        });

        return li;
    }

    // Add Root Action
    async function submitRoot() {
        const text = rootInput.value.trim();
        const tags = processTags(rootTagsInput.value);
        if (text) {
            const newId = crypto.randomUUID();
            const defaultPrio = selectedPriority || 3;
            const newTodo = { id: newId, text, parent_id: null, completed: false, tags, priority: defaultPrio, space_id: currentSpaceId };
            todos.push(newTodo);
            updateGlobalTodo(newTodo.id, newTodo);

            // clear selected tag so we see our new item
            selectedTag = null;

            render();
            rootInput.value = '';
            rootTagsInput.value = '';

            try {
                const res = await fetch('/api/todos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(newTodo)
                });
                if (res.status === 401) { window.location.reload(); return; }
                if (!res.ok) throw new Error('API failed');
            } catch (e) {
                console.error(e);
                todos = todos.filter(t => t.id !== newId);
                render();
                rootInput.value = text;
                rootTagsInput.value = tags.join(', ') + (tags.length ? ', ' : '');
                alert('Failed to save todo.');
            }
        }
    }

    addRootBtn.addEventListener('click', submitRoot);
    rootInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitRoot();
    });
    rootTagsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitRoot();
    });

    // Setup Autocomplete for root
    setupAutocomplete(rootTagsInput, document.getElementById('root-tag-dropdown'));

    // Menu & Trash UI Logic
    const toggleTrashBtn = document.getElementById('toggle-trash-btn');
    const trashBtnText = document.getElementById('trash-btn-text');
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const dropdownMenu = document.getElementById('dropdown-menu');

    // Toggle menu
    menuToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdownMenu.contains(e.target) && e.target !== menuToggleBtn) {
            dropdownMenu.classList.remove('show');
        }
    });

    toggleTrashBtn.addEventListener('click', () => {
        viewingTrash = !viewingTrash;
        document.body.classList.toggle('trash-mode', viewingTrash);
        trashBtnText.textContent = viewingTrash ? 'Exit Trash' : 'View Trash';

        if (viewingTrash) {
            selectedTag = null;
            selectedPriority = null;
        }

        dropdownMenu.classList.remove('show'); // close menu
        render();
    });

    // Invite Modal Logic
    const inviteOverlay = document.getElementById('invite-overlay');
    const inviteBtn = document.getElementById('invite-btn');
    const cancelInviteBtn = document.getElementById('cancel-invite-btn');
    const submitInviteBtn = document.getElementById('submit-invite-btn');
    const inviteEmailInput = document.getElementById('invite-email');

    inviteBtn.addEventListener('click', () => {
        inviteOverlay.classList.remove('hidden');
        document.getElementById('invite-name').value = '';
        inviteEmailInput.value = '';
        document.getElementById('invite-name').focus();
    });

    cancelInviteBtn.addEventListener('click', () => {
        inviteOverlay.classList.add('hidden');
        inviteEmailInput.value = '';
    });

    submitInviteBtn.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        const name = document.getElementById('invite-name').value.trim() || 'Shared Space';
        if (!email) return;

        try {
            submitInviteBtn.disabled = true;
            submitInviteBtn.textContent = 'Creating...';
            const res = await fetch('/api/shared_spaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ email, name })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed');

            if (data.status === 'created') {
                await fetchSpaces();
                currentSpaceId = data.id;
                await fetchTodos();
                cancelInviteBtn.click();
            }
        } catch (e) {
            alert(e.message);
        } finally {
            submitInviteBtn.disabled = false;
            submitInviteBtn.textContent = 'Create';
        }
    });

    // Rename Space Logic
    const renameSpaceBtn = document.getElementById('rename-space-btn');
    const renameOverlay = document.getElementById('rename-overlay');
    const renameNameInput = document.getElementById('rename-name');
    const submitRenameBtn = document.getElementById('submit-rename-btn');
    const cancelRenameBtn = document.getElementById('cancel-rename-btn');

    if (renameSpaceBtn) {
        renameSpaceBtn.addEventListener('click', () => {
            // Close the space dropdown immediately
            document.getElementById('space-dropdown-menu').classList.remove('show');

            if (currentSpaceId === null) return;
            const space = sharedSpaces.find(s => s.id === currentSpaceId);
            if (!space) return;

            renameOverlay.classList.remove('hidden');
            renameNameInput.value = space.name;
            renameNameInput.focus();

            // Highlight the text inside so they can start typing right away
            renameNameInput.select();
        });
    }

    if (cancelRenameBtn) {
        cancelRenameBtn.addEventListener('click', () => {
            renameOverlay.classList.add('hidden');
        });
    }

    if (submitRenameBtn) {
        submitRenameBtn.addEventListener('click', async () => {
            if (currentSpaceId === null) return;
            const space = sharedSpaces.find(s => s.id === currentSpaceId);
            if (!space) return;

            const newName = renameNameInput.value.trim();
            if (newName && newName !== space.name) {
                try {
                    submitRenameBtn.disabled = true;
                    submitRenameBtn.textContent = 'Saving...';

                    const res = await fetch(`/api/shared_spaces/${currentSpaceId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ name: newName })
                    });

                    if (!res.ok) {
                        const errorData = await res.json();
                        throw new Error(errorData.detail || 'Failed to rename space');
                    }

                    const data = await res.json();
                    if (data.status === 'success') {
                        space.name = data.name;
                        updateTagline();
                        renderSpaceSelector();
                        renameOverlay.classList.add('hidden');
                    }
                } catch (e) {
                    alert(e.message);
                } finally {
                    submitRenameBtn.disabled = false;
                    submitRenameBtn.textContent = 'Save';
                }
            } else if (newName === space.name) {
                // No changes made, just close
                renameOverlay.classList.add('hidden');
            }
        });

        renameNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitRenameBtn.click();
            if (e.key === 'Escape') cancelRenameBtn.click();
        });
    }

    // Add Member Dialog
    const addMemberOverlay = document.getElementById('add-member-overlay');
    const addMemberBtnEl = document.getElementById('add-member-btn');
    const cancelAddMemberBtn = document.getElementById('cancel-add-member-btn');
    const submitAddMemberBtn = document.getElementById('submit-add-member-btn');
    const addMemberEmailInput = document.getElementById('add-member-email');

    if (addMemberBtnEl) {
        addMemberBtnEl.addEventListener('click', () => {
            document.getElementById('space-dropdown-menu').classList.remove('show');
            addMemberEmailInput.value = '';
            addMemberOverlay.classList.remove('hidden');
            addMemberEmailInput.focus();
        });
    }

    if (cancelAddMemberBtn) {
        cancelAddMemberBtn.addEventListener('click', () => {
            addMemberOverlay.classList.add('hidden');
        });
    }

    if (submitAddMemberBtn) {
        submitAddMemberBtn.addEventListener('click', async () => {
            if (!currentSpaceId) return;
            const email = addMemberEmailInput.value.trim();
            if (!email) return;
            try {
                submitAddMemberBtn.disabled = true;
                submitAddMemberBtn.textContent = 'Adding...';
                const res = await fetch(`/api/shared_spaces/${currentSpaceId}/members`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ email })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Failed');
                await fetchSpaces();
                updateTagline();
                addMemberOverlay.classList.add('hidden');
            } catch (e) {
                alert(e.message);
            } finally {
                submitAddMemberBtn.disabled = false;
                submitAddMemberBtn.textContent = 'Add';
            }
        });

        addMemberEmailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitAddMemberBtn.click();
            if (e.key === 'Escape') cancelAddMemberBtn.click();
        });
    }

    // Move to Space Dialog
    const moveSpaceOverlay = document.getElementById('move-space-overlay');
    const moveSpaceList = document.getElementById('move-space-list');
    const cancelMoveSpaceBtn = document.getElementById('cancel-move-space-btn');

    cancelMoveSpaceBtn.addEventListener('click', () => moveSpaceOverlay.classList.add('hidden'));

    function openMoveSpaceDialog(item) {
        moveSpaceList.innerHTML = '';

        const destinations = [
            { id: null, name: 'Personal Tasks', icon: 'person-outline' },
            ...sharedSpaces.map(s => ({ id: s.id, name: s.name, icon: 'people-outline' }))
        ].filter(d => d.id !== currentSpaceId);

        if (destinations.length === 0) {
            moveSpaceList.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">No other spaces available.</p>';
        } else {
            destinations.forEach(dest => {
                const btn = document.createElement('button');
                btn.className = 'dropdown-item';
                btn.style.cssText = 'width:100%;justify-content:flex-start;gap:10px;padding:10px 14px;border-radius:10px;';
                btn.innerHTML = `<ion-icon name="${dest.icon}"></ion-icon> <span>${dest.name}</span>`;
                btn.addEventListener('click', async () => {
                    moveSpaceOverlay.classList.add('hidden');
                    try {
                        const res = await fetch(`/api/todos/${item.id}/move`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ space_id: dest.id })
                        });
                        if (!res.ok) throw new Error((await res.json()).detail || 'Failed');
                        // Remove from current view
                        todos = todos.filter(t => t.id !== item.id);
                        render();
                    } catch (e) { alert(e.message); }
                });
                moveSpaceList.appendChild(btn);
            });
        }

        moveSpaceOverlay.classList.remove('hidden');
    }

    // XML Export
    const exportXmlBtn = document.getElementById('export-xml-btn');
    exportXmlBtn.addEventListener('click', () => {
        let xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n<todos>\n';

        const activeTodos = todos.filter(t => !t.deleted);

        activeTodos.forEach(item => {
            xmlString += `  <todo id="${item.id}">\n`;

            // Escape special XML characters in text
            const safeText = item.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');

            xmlString += `    <text>${safeText}</text>\n`;
            xmlString += `    <completed>${item.completed}</completed>\n`;
            if (item.parent_id) {
                xmlString += `    <parent_id>${item.parent_id}</parent_id>\n`;
            }
            xmlString += `    <priority>${item.priority || 3}</priority>\n`;
            if (item.tags && item.tags.length > 0) {
                xmlString += `    <tags>\n`;
                item.tags.forEach(tag => {
                    const safeTag = tag
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&apos;');
                    xmlString += `      <tag>${safeTag}</tag>\n`;
                });
                xmlString += `    </tags>\n`;
            }
            xmlString += `  </todo>\n`;
        });

        xmlString += '</todos>';

        const blob = new Blob([xmlString], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'todos.xml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        dropdownMenu.classList.remove('show'); // close menu
    });

    // Auth Logic
    function onLoginSuccess(user) {
        document.getElementById('login-overlay').classList.add('hidden');
        document.getElementById('user-profile').classList.remove('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        document.getElementById('user-name').textContent = user.name || user.email;
        if (user.picture) {
            document.getElementById('user-avatar').src = user.picture;
        }
        if (user.role === 'admin') {
            document.getElementById('admin-dashboard-btn').classList.remove('hidden');
        }
        loadTodos();
    }

    window.handleCredentialResponse = async (response) => {
        try {
            const res = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ credential: response.credential })
            });
            if (res.ok) {
                const data = await res.json();
                onLoginSuccess(data.user);
            } else {
                const errorData = await res.json();
                alert(`Login failed: ${errorData.detail}`);
            }
        } catch (error) {
            console.error('Error during login:', error);
            alert('An error occurred during login. Please try again.');
        }
    };

    // Auth tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.auth-panel').forEach(p => p.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById(`auth-panel-${tab.dataset.tab}`).classList.remove('hidden');
        });
    });

    // Email auth mode toggle (sign in <-> register)
    let authMode = 'login';
    document.getElementById('auth-mode-switch').addEventListener('click', (e) => {
        e.preventDefault();
        authMode = authMode === 'login' ? 'register' : 'login';
        const isRegister = authMode === 'register';
        document.getElementById('auth-mode-label').textContent = isRegister ? 'Create account' : 'Sign in';
        document.getElementById('auth-mode-switch').textContent = isRegister ? 'Already have an account?' : 'Create an account';
        document.getElementById('auth-submit-btn').textContent = isRegister ? 'Create account' : 'Sign in';
        document.getElementById('auth-name-group').style.display = isRegister ? '' : 'none';
        document.getElementById('auth-password').autocomplete = isRegister ? 'new-password' : 'current-password';
        document.getElementById('auth-error').classList.add('hidden');
    });

    document.getElementById('auth-submit-btn').addEventListener('click', async () => {
        const errorEl = document.getElementById('auth-error');
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const name = document.getElementById('auth-name').value.trim();

        if (!email || !password) {
            errorEl.textContent = 'Please enter your email and password.';
            errorEl.classList.remove('hidden');
            return;
        }
        if (authMode === 'register' && !name) {
            errorEl.textContent = 'Please enter your name.';
            errorEl.classList.remove('hidden');
            return;
        }

        const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const body = authMode === 'register' ? { name, email, password } : { email, password };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body)
            });
            if (res.ok) {
                const data = await res.json();
                onLoginSuccess(data.user);
            } else {
                const err = await res.json();
                errorEl.textContent = err.detail || 'Something went wrong.';
                errorEl.classList.remove('hidden');
            }
        } catch {
            errorEl.textContent = 'An error occurred. Please try again.';
            errorEl.classList.remove('hidden');
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
            todos = [];
            render();
            document.getElementById('user-profile').classList.add('hidden');
            document.getElementById('logout-btn').classList.add('hidden');
            document.getElementById('admin-dashboard-btn').classList.add('hidden');
            document.getElementById('login-overlay').classList.remove('hidden');
            document.getElementById('dropdown-menu').classList.remove('show');
        } catch (error) {
            console.error('Error logging out:', error);
        }
    });

    loadTodos();
});
